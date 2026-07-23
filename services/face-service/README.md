# Smart Teams Face Service

A standalone Python microservice that does all face detection, recognition,
and passive-liveness scoring server-side, using [InsightFace](https://github.com/deepinsightface/insightface)
over ONNX Runtime — CPU only, no GPU required at this scale.

## Model: buffalo_s, with landmark_2d_106 (not landmark_3d_68)

This service loads a single InsightFace pack, `buffalo_s` — detection
(`det_500m`), recognition (`w600k_mbf`, a MobileFaceNet), and 2D 106-point
landmarks (`2d106det.onnx`, ~5MB). All three models are constructed manually
via `onnxruntime.InferenceSession` directly (see `load_model()` in
`main.py`) rather than through InsightFace's `FaceAnalysis` convenience
class, specifically to control ONNX Runtime's memory settings —
`FaceAnalysis`'s defaults (a growing memory arena, a thread pool sized to
every CPU core the host reports) settled at ~544MB RSS for these same three
models, which OOM'd a real 512MB container. The manual + tuned-session
version settles at ~160-410MB depending on which landmark model is loaded
(measured; see `load_model()`'s comments for the full before/after numbers).

**Why `landmark_2d_106` and not `landmark_3d_68`:** buffalo_s's zip bundle
actually ships both — `1k3d68.onnx` (143MB) and `2d106det.onnx` (~5MB).
`1k3d68.onnx`'s own one-time parse/graph-construction step transiently
exceeds 512MB by itself, independent of every session/thread setting above
(confirmed by reproducing the exact same OOM Render reported, locally, with
`docker run --memory=512m`). `2d106det.onnx` doesn't have this problem. The
tradeoff: `landmark_3d_68` produced a head pose (pitch/yaw/roll) for free;
`landmark_2d_106` doesn't, so `main.py` estimates it itself via
`cv2.solvePnP` against a generic 3D face reference — see the "Landmark
geometry" section in `main.py` and the sign-convention caveat below.

**Also worth knowing:** `landmark_2d_106`'s per-point layout isn't published
by InsightFace anywhere citable. The index ranges used in `main.py` (which
points belong to which eye, the mouth, etc.) were derived empirically —
rendering the model's output against a real test photo with each point's
index number overlaid, then reading off where each region actually lands —
not copied from documentation. The eye/mouth "openness" checks deliberately
use each region's bounding-box height/width instead of hand-picked point
pairs (like the classic 6-point EAR/MAR formulas do), specifically because
the *exact role* of each point within a region isn't confirmed the way the
region boundaries are.

## Why a separate service instead of doing this in the Node app

InsightFace/ONNX Runtime/OpenCV all ship proper prebuilt wheels for every
major OS via `pip` — there's no native addon to compile. That's the opposite
of what happens if you try to run `@tensorflow/tfjs-node` directly inside a
Node process: that needs a platform-specific compiled binary and is exactly
what caused a full server crash in an earlier version of this project on a
Windows machine (`tfjs_binding.node` could not be found). Python's ML
ecosystem is simply far more mature and portable for this specific job.

The Node app (`apps/admin/server.ts`) calls this service over plain HTTP and
never touches an ML runtime itself — it only ever gets back a face embedding
(a list of numbers) and a liveness score, and decides what to do with those
numbers (match threshold, policy, rejection reasons) itself.

## Setup

```bash
cd services/face-service
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

First run downloads the `buffalo_s` model bundle to `~/.insightface/models/`
— this needs outbound internet access the first time only; it's cached on
disk after that.

### Windows + Python 3.13: `pip install -r requirements.txt` fails on numpy

If `pip install` fails trying to **compile numpy from source** (a Meson/GCC
error mentioning `NumPy requires GCC >= 8.4`), it's because `numpy==1.26.4`
has no prebuilt wheel for Python 3.13 (that only started with numpy 2.x),
so pip falls back to a source build — which needs a modern C compiler most
Windows machines don't have installed.

Don't "fix" this by bumping numpy to 2.x: `insightface==0.7.3` uses numpy
APIs (`np.float` and similar) that were **removed** in numpy 1.24+ and
break outright under numpy 2.x — you'd trade this error for a runtime
`AttributeError` inside insightface later.

The actual fix is to create this venv with **Python 3.11 or 3.12** instead
of 3.13 (both have official numpy 1.26.4 wheels — no compiling), and
install insightface from a prebuilt wheel so its own C/Cython extensions
don't need compiling either:

```powershell
python -m venv venv
venv\Scripts\activate
pip install fastapi==0.115.6 "uvicorn[standard]==0.32.1" pydantic==2.10.3 onnxruntime==1.20.1 opencv-python-headless==4.10.0.84 numpy==1.26.4
pip install https://github.com/Gourieff/Assets/raw/main/Insightface/insightface-0.7.3-cp311-cp311-win_amd64.whl
```

Swap `cp311` for `cp312` in that last URL if your venv is Python 3.12. The
wheel is from the ComfyUI-ReActor project's asset mirror, which publishes
prebuilt Windows wheels for insightface 0.7.3 across Python 3.9–3.13 since
upstream insightface only ships a source distribution.

Then set in the Node app's `.env`:

```
FACE_SERVICE_URL=http://127.0.0.1:8001
```

If this service isn't running, the Node app's face enroll/verify endpoints
will return a clear "face verification service unavailable" error rather
than crashing — but nobody will be able to complete enrollment or a
face-verified check-in until it's back up. Employees can still use the
WebAuthn device-verification fallback in that case.

## Docker

```bash
docker build -t smart-teams-face-service .
docker run -p 8001:8001 smart-teams-face-service
```

## Endpoints

- `POST /enroll` — `{ "actions": { "look_center": ["<base64 jpeg>", ...], "turn_left": [...], "turn_right": [...], "look_up": [...], "smile": [...], "open_mouth": [...], "blink": [...] } }`
  → one burst of frames per guided KYC pose. Returns `{ embeddings, actionLog, failedActions }`:
  an embedding per detected frame (across all poses, for identity matching),
  a per-action `{framesSubmitted, framesWithFace, verified}` log, and the
  list of actions (if any) that weren't actually detected in their burst —
  the Node app turns a non-empty `failedActions` into a 422 asking the
  employee to redo just those steps.
- `POST /verify` — `{ "images": ["<base64 jpeg>", ...], "challengeActions": ["turn_left"] }`
  → the best frame's identity embedding, a passive liveness score (0–1,
  from landmark movement across the burst), and `actionResults` — whether
  each requested challenge action was actually detected in the burst.
  Daily attendance calls this twice at most: first with `challengeActions: []`
  for a fast passive-only check (~2-3s capture, no action needed), and only
  if that's not convincing, a second time with exactly one action drawn
  from the employee's own enrollment log — this is what makes the
  occasional on-screen instruction a real check rather than decoration.
- `GET /health` — `{ "status": "ok", "modelLoaded": true }` once both the
  detection/recognition and landmark models are ready.

`POST /verify`'s response also includes `moireScore` (0–1) — see the "Honest
limitations" entry below.

## Honest limitations

- **Head-pose sign convention is UNVERIFIED against a live camera.** Unlike
  an earlier version of this service (which used InsightFace's own
  `landmark_3d_68`-derived pose and had real calibration logs behind its
  sign convention), the current `estimate_pose()` in `main.py` computes pose
  itself via `cv2.solvePnP` against a self-supplied generic 3D face
  reference — a standard, widely-used technique, but not one that's been
  run against this pipeline's actual landmark points on a real camera yet.
  Confirm `turn_left`/`turn_right` and `look_up` against a real camera
  before relying on this in production — flip `YAW_SIGN`/`PITCH_SIGN` at
  the top of `main.py` if they come out backwards. (`look_down` was dropped
  from the enrollment/challenge vocabulary entirely — its threshold never
  reliably passed against a real camera.)
- **The eye/mouth "openness ratio" thresholds are also unverified**, for a
  related reason: they're bounding-box height/width ratios over
  `landmark_2d_106`'s points (see the model section above for why exact
  point-role pairing isn't assumed), which land in a different numeric range
  than the classic Eye Aspect Ratio formula an earlier version of this
  service used and had real calibration data for. Test `/enroll` and
  `/verify` against a real camera and adjust `BLINK_RELATIVE_DROP`,
  `BLINK_OPENNESS_ABS_CEILING`, `OPEN_MOUTH_RATIO_THRESHOLD`, and
  `SMILE_WIDTH_RATIO_THRESHOLD` in `main.py` if blink/smile/open_mouth don't
  trigger reliably.
- The generic liveness score is a passive motion heuristic (landmark
  movement across a few frames), not a certified anti-spoofing model. Combined
  with the per-action challenge-response check, it stops a static printed
  photo (no movement, and can't perform a randomly-chosen action on demand)
  and a naive video replay of the wrong moment; a sophisticated pre-recorded
  video containing every possible challenge action is a harder problem that
  would need a dedicated anti-spoofing model (e.g. Silent-Face-Anti-Spoofing)
  layered on top, which isn't included here.
- `YAW_TURN_THRESHOLD_DEG` and `PITCH_LOOK_THRESHOLD_DEG` are population-
  level defaults, not calibrated against your specific users/cameras —
  expect to tune them after real-world testing, same as everything else here.
- Match threshold tuning: this uses cosine similarity between ArcFace
  embeddings, gated by `FACE_MATCH_THRESHOLD` on the Node side (see
  `apps/admin/api/services/face.ts`), currently `0.5`. See that constant's
  own comment for the real same-person/different-person score data behind
  the current value, and why threshold tuning alone can't catch every case —
  a same-person-range false match between two genuinely different people
  needs re-enrollment (a fresh, more varied capture burst), not a threshold
  change.
- **`moireScore` is a diagnostics-only heuristic, not a certified anti-spoof
  signal, and does not gate anything today.** It's a classical frequency-
  domain check (2D FFT of the face crop) — see `moire_score()` in `main.py`.
  The scaling constant (`MOIRE_SCALE`) was set from one synthetic sanity
  check, not real spoof attempts. Node logs it on every attendance check
  (pass or fail) but never rejects a check-in on it.
