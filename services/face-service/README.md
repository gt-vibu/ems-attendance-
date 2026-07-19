# Smart Teams Face Service

A standalone Python microservice that does all face detection, recognition,
and passive-liveness scoring server-side, using [InsightFace](https://github.com/deepinsightface/insightface)
(the `buffalo_l` bundle) over ONNX Runtime — CPU only, no GPU required at
this scale.

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

First run downloads the `buffalo_l` model bundle (~300MB) to
`~/.insightface/models/` — this needs outbound internet access the first
time only; it's cached on disk after that.

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

If this service isn't running, the Node app's KYC/attendance endpoints will
return a clear "face verification service unavailable" error rather than
crashing — but nobody will be able to complete KYC or face-verified
check-in until it's back up.

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
- `POST /verify` — `{ "images": ["<base64 jpeg>", ...], "challengeActions": ["turn_left", "blink"] }`
  → the best frame's identity embedding, a passive liveness score (0–1,
  from landmark movement across the burst), and `actionResults` — whether
  each requested challenge action was actually detected in the burst. This
  is what makes the daily liveness challenge a real check rather than just
  on-screen decoration: the Node app rejects the attempt if any requested
  action wasn't confirmed.
- `GET /health` — `{ "status": "ok", "modelLoaded": true }` once ready.

`POST /verify`'s response also includes `moireScore` (0–1) — see the "Honest
limitations" entry below.

## Honest limitations

- **This code has not been run in this environment.** I don't have Python,
  a webcam, or the ability to install `insightface`/`onnxruntime` here, so
  this has only been checked for valid Python syntax and cross-referenced
  against InsightFace's own source (`model_zoo/landmark.py`) — not actually
  executed against real camera frames. Please run it locally and confirm
  `/health`, a real `/enroll`, and a real `/verify` call work before relying
  on it in production.
- **Head-pose sign convention is unverified against a live camera.**
  `face.pose` from InsightFace's landmark_3d_68 submodel is documented in
  its own source as `[pitch, yaw, roll]` in degrees, but which sign means
  "turned toward the camera's left" vs "right" (and "looking up" vs "down")
  could not be confirmed without a real device here. If `turn_left`/
  `turn_right` or `look_up`/`look_down` come out swapped during your first
  real test, flip `YAW_SIGN` / `PITCH_SIGN` at the top of `main.py` — nothing
  else needs to change.
- The generic liveness score is a passive motion heuristic (landmark
  movement across a few frames), not a certified anti-spoofing model. Combined
  with the per-action challenge-response check, it stops a static printed
  photo (no movement, and can't perform a randomly-chosen action on demand)
  and a naive video replay of the wrong moment; a sophisticated pre-recorded
  video containing every possible challenge action is a harder problem that
  would need a dedicated anti-spoofing model (e.g. Silent-Face-Anti-Spoofing)
  layered on top, which isn't included here.
- Action thresholds (`BLINK_EAR_THRESHOLD`, `OPEN_MOUTH_MAR_THRESHOLD`,
  `SMILE_WIDTH_RATIO_THRESHOLD`, `YAW_TURN_THRESHOLD_DEG`,
  `PITCH_LOOK_THRESHOLD_DEG`) are population-level defaults, not calibrated
  against your specific users/cameras — expect to tune them after real-world
  testing, same as the match threshold below.
- Match threshold tuning: this uses cosine similarity between ArcFace
  embeddings with a starting threshold of `0.36` on the Node side (see
  `server.ts`). This is a commonly-cited InsightFace starting point, not a
  number calibrated against your specific users/cameras — expect to tune it
  after real-world testing.
- **`moireScore` is a diagnostics-only heuristic, not a certified anti-spoof
  signal, and does not gate anything today.** It's a classical frequency-
  domain check (2D FFT of the face crop; a real face's spectrum is dominated
  by smooth low-frequency content, while an LCD/OLED screen re-photographed
  by another camera injects extra energy into the high-frequency bands from
  its own subpixel raster) — see `moire_score()` in `main.py`. The scaling
  constant (`MOIRE_SCALE`) was set from exactly one synthetic sanity check
  (a smooth gradient vs. the same image with a sinusoidal raster pattern
  added), not from real spoof attempts or a real webcam population. Node
  logs it on every attendance check (pass or fail) via `attendance.routes.ts`
  but never rejects a check-in on it — the intent is to review real logged
  values for a while and pick a real threshold before ever wiring it into a
  pass/fail decision, exactly like `matchThreshold`/the liveness threshold
  above needed. It also only catches screen-replay-style spoofing; it says
  nothing about depth, printed-photo texture, or anything else.
