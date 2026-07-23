# Smart Teams Face Service

A standalone Python microservice that does all face detection, recognition,
and passive-liveness scoring server-side, using [InsightFace](https://github.com/deepinsightface/insightface)
over ONNX Runtime — CPU only, no GPU required at this scale.

## Model: buffalo_s, not buffalo_l

This service loads a single InsightFace pack, `buffalo_s`, with
`allowed_modules=['detection', 'recognition', 'landmark_3d_68']`. An earlier
version of this file assumed buffalo_s didn't ship a landmark_3d_68 submodel
and tried to load it from a second `buffalo_l` FaceAnalysis instance instead
— that turned out to be both unnecessary (buffalo_s's own zip bundle
includes the same `1k3d68.onnx` landmark model buffalo_l does) and broken
(`FaceAnalysis.__init__` hard-asserts a detection model is present
regardless of `allowed_modules`, so a landmark-only instance always raised
`AssertionError` on startup). One pack, all three modules, is simpler and
correct.

buffalo_s's detector (`det_500m`) and recognizer (`w600k_mbf`, a
MobileFaceNet) are both dramatically smaller than buffalo_l's
(`det_10g`/`w600k_r50`) — that's the actual memory win requested: loaded
weights land around ~150-250MB total, comfortably smaller than a plain
buffalo_l deployment's ~450-500MB. See `load_model()` in `main.py`.

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

- `POST /enroll` — `{ "actions": { "look_center": ["<base64 jpeg>", ...], "turn_left": [...], "turn_right": [...], "look_up": [...], "look_down": [...], "smile": [...], "open_mouth": [...], "blink": [...] } }`
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

- **Head-pose sign convention is unverified against a live camera on
  buffalo_s's landmark_3d_68.** The EAR/MAR/pose thresholds and the
  `YAW_SIGN`/`PITCH_SIGN` normalization were calibrated against buffalo_l's
  copy of this submodel in an earlier version of this service; buffalo_s
  ships the same `1k3d68.onnx` file, so this should still hold, but confirm
  `/enroll` and `/verify` against a real camera before relying on it in
  production — flip `YAW_SIGN`/`PITCH_SIGN` at the top of `main.py` if
  `turn_left`/`turn_right` or `look_up`/`look_down` come out swapped.
- The generic liveness score is a passive motion heuristic (landmark
  movement across a few frames), not a certified anti-spoofing model. Combined
  with the per-action challenge-response check, it stops a static printed
  photo (no movement, and can't perform a randomly-chosen action on demand)
  and a naive video replay of the wrong moment; a sophisticated pre-recorded
  video containing every possible challenge action is a harder problem that
  would need a dedicated anti-spoofing model (e.g. Silent-Face-Anti-Spoofing)
  layered on top, which isn't included here.
- Action thresholds (`BLINK_EAR_ABS_CEILING`, `OPEN_MOUTH_MAR_THRESHOLD`,
  `SMILE_WIDTH_RATIO_THRESHOLD`, `YAW_TURN_THRESHOLD_DEG`,
  `PITCH_LOOK_THRESHOLD_DEG`) are population-level defaults, not calibrated
  against your specific users/cameras — expect to tune them after real-world
  testing, same as the match threshold below.
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
