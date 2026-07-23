"""
Smart Teams Face Service
========================
A small, standalone microservice that does all face detection, recognition,
and liveness/action verification server-side, using InsightFace over ONNX
Runtime — a hybrid Buffalo_S + Buffalo_L assembly (see load_model() below),
not a single named pack.

Why this exists as a separate Python service instead of living inside the
Node/Express app:
- InsightFace/ONNX Runtime/OpenCV all ship proper prebuilt wheels for every
  major OS via pip — there's no native addon to compile, which is exactly
  what broke a previous attempt to do this with @tensorflow/tfjs-node
  directly inside the Node process (that requires a platform-specific
  compiled binary and is fragile across machines).
- The browser client only ever needs a camera and the ability to POST a
  JPEG — no ML runtime, no multi-megabyte model download, no WebGL
  requirement. That's what actually makes this "compatible with any
  device" and reduces client-side overhead.
- Node stays responsible for policy (match thresholds, what counts as a
  violation, what to do about it); this service only ever answers "what do
  these pixels contain" — identity embedding, liveness signal, and which
  specific challenge actions (blink, turn head, smile, etc.) were actually
  performed — nothing more. It never sees policy, tenants, or decides
  pass/fail on its own.

Endpoints:
  POST /enroll  — KYC enrollment. One burst of frames per guided pose
                  (look_center, turn_left, turn_right, look_up, look_down,
                  smile, open_mouth, blink) -> face embeddings (one per
                  detected frame, across all poses) + a per-action log of
                  whether that pose was actually detected in its burst.
  POST /verify  — daily attendance check-in. One burst of frames + the list
                  of challenge actions the employee was asked to perform ->
                  identity embedding (best frame) + a passive motion-based
                  liveness score + per-action pass/fail for exactly the
                  actions that were requested.
  GET  /health  — for the Node app / ops tooling to check the model is
                  actually loaded before relying on this service.

Setup:
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8001

First run downloads the buffalo_s AND buffalo_l model bundles (see
load_model() for why both are needed) to ~/.insightface/models/ — this
requires outbound internet access the first time only; after that it's
cached on disk. Only a small subset of each bundle's weights are ever
loaded into memory (~150-200MB total), not the full ~450MB a plain
buffalo_l deployment would use.
"""

import base64
import logging
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("face-service")

app = FastAPI(title="Smart Teams Face Service", version="3.0.0")

# The Node app and this service are expected to run on a private
# network/localhost together, but CORS is opened here in case the Node app
# ever calls this from a different origin during local development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

face_app = None  # lazily set at startup

# ---------------------------------------------------------------------------
# Action-detection thresholds
# ---------------------------------------------------------------------------
# All population-level defaults (not calibrated per-user), tuned for a
# typical webcam/phone-camera capture distance. Adjust per deployment if a
# particular camera setup produces systematically different readings.
#
# Eye Aspect Ratio (EAR) — Soukupová & Čech, "Real-Time Eye Blink Detection
# using Facial Landmarks". Blink is detected as a RELATIVE dip against this
# burst's own peak-open reading rather than fixed population thresholds —
# live-camera calibration showed per-person/camera "open" and "closed"
# baselines vary too much (e.g. one real device measured open ~0.25-0.29 and
# a genuine blink only dipping to ~0.21-0.22) for a single fixed cutoff to
# work reliably across different people, cameras, and lighting.
BLINK_RELATIVE_DROP = 0.90   # eye counted as blinking if it dips to <=90% of this burst's own peak-open EAR
BLINK_EAR_ABS_CEILING = 0.28  # sanity check — the dip must also be a plausibly-low absolute EAR, not just "a bit less wide-eyed than the peak"

# Mouth Aspect Ratio (MAR) — standard open-mouth/yawn heuristic over the
# outer mouth landmarks. Closed/neutral mouth is usually ~0.25-0.45.
OPEN_MOUTH_MAR_THRESHOLD = 0.55

# Smile: distinguished from "open mouth" by mouth WIDTH increasing (relative
# to the stable interocular distance, so it isn't skewed by camera distance)
# while the mouth doesn't also open into a full MAR spike.
SMILE_WIDTH_RATIO_THRESHOLD = 0.52
SMILE_MAX_MAR = OPEN_MOUTH_MAR_THRESHOLD

# Head pose thresholds, in degrees, applied to InsightFace's estimated
# (pitch, yaw, roll). NOTE ON SIGN CONVENTION: confirmed against live-camera
# calibration logs — insightface's raw yaw comes out POSITIVE for turn_left
# and NEGATIVE for turn_right, and raw pitch comes out POSITIVE for look_up
# and NEGATIVE for look_down (the opposite of what the code below assumes
# before the sign flip), so both *_SIGN constants are -1 to normalize into
# "yaw < -threshold means turn_left" / "pitch < -threshold means look_up".
YAW_TURN_THRESHOLD_DEG = 15.0
# Slightly lower than the yaw threshold — live calibration showed people
# tilt less for "look up/down slightly" than they turn for "turn left/right"
# (which asks for a fuller turn), so this needs a smaller bar to reliably
# register without dropping so low it risks matching incidental head-turn
# pitch noise (a real left/right turn showed up to ~14° of incidental pitch
# in the logs — this stays safely above that).
PITCH_LOOK_THRESHOLD_DEG = 9.0
YAW_SIGN = -1
PITCH_SIGN = -1

# For the "look_center" baseline pose captured during enrollment — just
# needs a face detected with a roughly neutral pose, not a hard requirement.
CENTER_YAW_MAX_DEG = 20.0
CENTER_PITCH_MAX_DEG = 20.0

NON_BASELINE_ACTIONS = [
    "turn_left", "turn_right", "look_up", "look_down",
    "smile", "open_mouth", "blink",
]
ALL_ENROLLMENT_ACTIONS = ["look_center"] + NON_BASELINE_ACTIONS


@app.on_event("startup")
def load_model():
    global face_app
    # Imported here (not at module top) so that a syntax/import error in
    # this file can still be caught by simple tools without insightface
    # actually being installed, and so the log line below is the first
    # thing that happens after the real dependency is confirmed importable.
    from insightface.app import FaceAnalysis

    # buffalo_s's zip bundle turns out to ship the SAME landmark_3d_68 model
    # (1k3d68.onnx) buffalo_l does, alongside its own much smaller detector
    # (det_500m) and recognizer (w600k_mbf, a MobileFaceNet) — confirmed from
    # a real build log ("find model: .../buffalo_s/1k3d68.onnx landmark_3d_68").
    # An earlier version of this file assumed buffalo_s lacked that submodel
    # and tried to load it from a second buffalo_l FaceAnalysis instance
    # instead — that not only wasn't necessary, it crashed outright:
    # FaceAnalysis.__init__ hard-asserts a detection model is present
    # regardless of allowed_modules, so a landmark-only instance always
    # raises AssertionError. One buffalo_s pack, all three modules, is both
    # correct and the actual memory win (~150-250MB total vs buffalo_l's
    # ~450-500MB) — no second model download needed at all.
    logger.info("Loading InsightFace buffalo_s (detection + recognition + landmark_3d_68, CPU)...")
    face_app = FaceAnalysis(
        name="buffalo_s",
        providers=["CPUExecutionProvider"],
        allowed_modules=["detection", "recognition", "landmark_3d_68"],
    )
    # det_size: the resolution the detector scans at. 320x320 rather than the
    # 640x640 default — this app's captures are always a single close-up face
    # (a phone/webcam selfie for KYC/attendance), not a crowd photo needing to
    # find small/distant faces, so the accuracy loss from a smaller scan
    # resolution is negligible for this use case, and it cuts memory/latency.
    face_app.prepare(ctx_id=-1, det_size=(320, 320))  # ctx_id=-1 => CPU only, no GPU required

    logger.info("Model loaded. Face service ready (buffalo_s, incl. landmark_3d_68).")


def decode_image(b64_data: str) -> np.ndarray:
    """Decode a base64 (optionally data-URL-prefixed) image into a BGR OpenCV image."""
    if not b64_data:
        raise HTTPException(status_code=400, detail="Empty image data")
    if "," in b64_data[:64] and b64_data.strip().startswith("data:"):
        b64_data = b64_data.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64_data)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image data")
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Could not decode image — is it a valid JPEG/PNG?")
    return img


def get_largest_face(img: np.ndarray):
    """Returns the largest detected face in the frame (the person actually
    in front of the camera, not someone incidentally in the background),
    or None if no face was found. face_app.get() already runs detection,
    recognition, and landmark_3d_68 for every face in one call."""
    if face_app is None:
        raise HTTPException(status_code=503, detail="Model is still loading — try again in a moment.")
    faces = face_app.get(img)
    if not faces:
        return None
    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))


# ---------------------------------------------------------------------------
# Landmark geometry — action detection from a single detected face
# ---------------------------------------------------------------------------
# InsightFace's landmark_3d_68 submodel follows the standard iBUG/300W
# 68-point layout (jaw 0-16, right eyebrow 17-21, left eyebrow 22-26, nose
# 27-35, right eye 36-41, left eye 42-47, mouth 48-67) and automatically
# populates `face.pose` = [pitch, yaw, roll] in degrees (see
# model_zoo/landmark.py — pose is derived by fitting the predicted 3D
# landmarks against a canonical mean-shape template). We use the (x, y)
# projection of these 68 points for all 2D geometric ratios.

RIGHT_EYE = [36, 37, 38, 39, 40, 41]
LEFT_EYE = [42, 43, 44, 45, 46, 47]
MOUTH_LEFT_CORNER = 48
MOUTH_RIGHT_CORNER = 54
MOUTH_TOP_MID_OUTER = [50, 51, 52]
MOUTH_BOTTOM_MID_OUTER = [58, 57, 56]
LEFT_EYE_OUTER = 36
RIGHT_EYE_OUTER = 45


def _dist(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a - b))


def _landmarks_xy(face) -> Optional[np.ndarray]:
    lmk = getattr(face, "landmark_3d_68", None)
    if lmk is None:
        return None
    return np.asarray(lmk)[:, :2]


def _eye_aspect_ratio_one(lm: np.ndarray, idx: List[int]) -> float:
    p1, p2, p3, p4, p5, p6 = (lm[i] for i in idx)
    return (_dist(p2, p6) + _dist(p3, p5)) / (2.0 * _dist(p1, p4) + 1e-6)


def eye_aspect_ratio(lm: np.ndarray) -> float:
    return (_eye_aspect_ratio_one(lm, RIGHT_EYE) + _eye_aspect_ratio_one(lm, LEFT_EYE)) / 2.0


def mouth_aspect_ratio(lm: np.ndarray) -> float:
    width = _dist(lm[MOUTH_LEFT_CORNER], lm[MOUTH_RIGHT_CORNER])
    heights = [
        _dist(lm[top], lm[bottom])
        for top, bottom in zip(MOUTH_TOP_MID_OUTER, MOUTH_BOTTOM_MID_OUTER)
    ]
    return float(np.mean(heights)) / (width + 1e-6)


def mouth_width_ratio(lm: np.ndarray) -> float:
    """Mouth corner-to-corner width normalized by interocular distance, so
    it isn't skewed by how close the camera is."""
    mouth_width = _dist(lm[MOUTH_LEFT_CORNER], lm[MOUTH_RIGHT_CORNER])
    interocular = _dist(lm[LEFT_EYE_OUTER], lm[RIGHT_EYE_OUTER])
    return mouth_width / (interocular + 1e-6)


def get_pose(face) -> Optional[Tuple[float, float, float]]:
    """Returns (pitch, yaw, roll) in degrees, or None if the pose submodel
    didn't produce a result for this frame (e.g. an extreme angle where
    landmark fitting failed)."""
    pose = getattr(face, "pose", None)
    if pose is None:
        return None
    pitch, yaw, roll = (float(v) for v in pose)
    return pitch, yaw, roll


def actions_detected_in_burst(faces: List) -> Dict[str, bool]:
    """Given every successfully-detected face across a capture burst (one
    entry per frame that had a face in it), return which of the 7
    non-baseline challenge actions were exhibited at any point in the
    burst. A live person moving through the requested pose will cross the
    relevant threshold in at least one frame; a static photo held up to the
    camera never will, because every frame reads the same neutral pose."""
    results = {action: False for action in NON_BASELINE_ACTIONS}

    ears: List[float] = []
    for face in faces:
        lm = _landmarks_xy(face)
        if lm is None:
            continue

        ear = eye_aspect_ratio(lm)
        ears.append(ear)

        mar = mouth_aspect_ratio(lm)
        if mar > OPEN_MOUTH_MAR_THRESHOLD:
            results["open_mouth"] = True

        width_ratio = mouth_width_ratio(lm)
        if width_ratio > SMILE_WIDTH_RATIO_THRESHOLD and mar <= SMILE_MAX_MAR:
            results["smile"] = True

        pose = get_pose(face)
        if pose is not None:
            pitch, yaw, _roll = pose
            yaw *= YAW_SIGN
            pitch *= PITCH_SIGN
            if yaw < -YAW_TURN_THRESHOLD_DEG:
                results["turn_left"] = True
            if yaw > YAW_TURN_THRESHOLD_DEG:
                results["turn_right"] = True
            if pitch < -PITCH_LOOK_THRESHOLD_DEG:
                results["look_up"] = True
            if pitch > PITCH_LOOK_THRESHOLD_DEG:
                results["look_down"] = True

    # Blink: a relative dip against this burst's own peak-open EAR, rather
    # than a fixed population threshold (see BLINK_RELATIVE_DROP comment) —
    # requires at least 2 frames with landmarks to have something to compare.
    if len(ears) >= 2:
        max_ear = max(ears)
        min_ear = min(ears)
        if min_ear <= BLINK_EAR_ABS_CEILING and min_ear <= max_ear * BLINK_RELATIVE_DROP:
            results["blink"] = True

    return results


def is_neutral_pose(face) -> bool:
    pose = get_pose(face)
    if pose is None:
        return True  # can't tell — don't block enrollment on a pose-estimation miss
    pitch, yaw, _roll = pose
    return abs(yaw) <= CENTER_YAW_MAX_DEG and abs(pitch) <= CENTER_PITCH_MAX_DEG


# ---------------------------------------------------------------------------
# Moire/screen-replay heuristic (diagnostics-only signal, see README)
# ---------------------------------------------------------------------------
# LCD/OLED screens re-photographed by another camera (the classic "hold a
# phone playing a video up to the webcam" spoof) produce a characteristic
# high-frequency raster/subpixel interference pattern that a 2D FFT of the
# face crop reveals as anomalous energy concentrated in the high-frequency
# bands — well beyond what a real face photographed directly produces (real
# skin/features are dominated by smooth, low-frequency content). This is a
# classical frequency-domain "moire artifact" detector, not a trained model —
# pure NumPy/OpenCV, runs in milliseconds, no new dependency. It is
# deliberately NOT wired into any pass/fail decision here or in Node — see
# the README's "Honest limitations" section for why this ships as a logged
# diagnostic signal only until it's been tuned against a real population of
# check-ins (the same way matchThreshold/LIVENESS_MIN needed real tuning).
MOIRE_HIGH_FREQ_RADIUS_FRACTION = 0.6  # outer 40% of the spectrum radius counts as "high frequency"
# Placeholder scaling, set from one synthetic sanity check (a smooth
# gradient crop vs. the same crop with a sinusoidal screen-raster pattern
# added scored ~0.17 vs ~0.33 raw high-frequency-energy ratio at this
# radius fraction — this scale maps that pair to roughly 0.4 vs 0.8 instead
# of letting real-world frames pin at the 1.0 ceiling immediately, which is
# what an earlier, more aggressive scale did). Still NOT calibrated against
# real spoof attempts or a real webcam population — tune once real
# diagnostics data is logged, same as matchThreshold/LIVENESS_MIN needed.
MOIRE_SCALE = 2.5


def moire_score(img: np.ndarray, face) -> float:
    """0-1 heuristic screen-replay score for the given face's crop in `img`
    (higher = more moire-like/suspicious). Returns 0.0 if the crop is
    degenerate (e.g. a face right at the frame edge)."""
    x1, y1, x2, y2 = (int(v) for v in face.bbox)
    x1, y1 = max(0, x1), max(0, y1)
    crop = img[y1:y2, x1:x2]
    if crop.size == 0:
        return 0.0

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    # Fixed size so the frequency bands mean the same thing regardless of
    # how close the face was to the camera.
    gray = cv2.resize(gray, (256, 256))

    spectrum = np.fft.fftshift(np.fft.fft2(gray))
    magnitude = np.abs(spectrum)

    h, w = magnitude.shape
    cy, cx = h // 2, w // 2
    y_idx, x_idx = np.ogrid[:h, :w]
    radius = np.sqrt((x_idx - cx) ** 2 + (y_idx - cy) ** 2)
    max_radius = min(cx, cy)

    high_freq_mask = radius >= (MOIRE_HIGH_FREQ_RADIUS_FRACTION * max_radius)
    total_energy = magnitude.sum() + 1e-6
    high_freq_energy = magnitude[high_freq_mask].sum()
    return float(min(1.0, (high_freq_energy / total_energy) * MOIRE_SCALE))


# ---------------------------------------------------------------------------
# /enroll — KYC guided enrollment
# ---------------------------------------------------------------------------

class EnrollRequest(BaseModel):
    # One burst of base64 frames per guided pose, e.g.
    # {"look_center": [...], "turn_left": [...], ..., "blink": [...]}
    actions: Dict[str, List[str]]


class ActionLogEntry(BaseModel):
    framesSubmitted: int
    framesWithFace: int
    verified: bool


class EnrollResponse(BaseModel):
    embeddings: List[List[float]]
    actionLog: Dict[str, ActionLogEntry]
    failedActions: List[str]


@app.post("/enroll", response_model=EnrollResponse)
def enroll(req: EnrollRequest):
    if not req.actions:
        raise HTTPException(status_code=400, detail="At least one action burst is required")

    embeddings: List[List[float]] = []
    action_log: Dict[str, ActionLogEntry] = {}
    failed_actions: List[str] = []

    for action, images in req.actions.items():
        if not images:
            failed_actions.append(action)
            action_log[action] = ActionLogEntry(framesSubmitted=0, framesWithFace=0, verified=False)
            continue

        detected_faces = []
        for b64 in images:
            img = decode_image(b64)
            face = get_largest_face(img)
            if face is not None:
                detected_faces.append(face)
                embeddings.append(face.normed_embedding.tolist())

        if action == "look_center":
            verified = any(is_neutral_pose(f) for f in detected_faces)
        elif action in NON_BASELINE_ACTIONS:
            verified = actions_detected_in_burst(detected_faces).get(action, False)
        else:
            # Unknown action name — still record frames/embeddings, but
            # don't claim to have verified something we don't recognize.
            verified = False

        if not detected_faces or not verified:
            failed_actions.append(action)

        action_log[action] = ActionLogEntry(
            framesSubmitted=len(images),
            framesWithFace=len(detected_faces),
            verified=bool(detected_faces) and verified,
        )

    if not embeddings:
        raise HTTPException(
            status_code=422,
            detail="No face detected in any submitted frame. Ensure good lighting and look directly at the camera.",
        )

    return EnrollResponse(embeddings=embeddings, actionLog=action_log, failedActions=failed_actions)


# ---------------------------------------------------------------------------
# /verify — attendance / break check-in
# ---------------------------------------------------------------------------

class VerifyRequest(BaseModel):
    images: List[str]  # base64 frames from a short check-in burst
    challengeActions: List[str] = []  # the specific actions this attempt was asked to perform


class VerifyResponse(BaseModel):
    embedding: Optional[List[float]] = None
    livenessScore: float
    faceDetected: bool
    framesWithFace: int
    framesSubmitted: int
    actionResults: Dict[str, bool] = {}
    moireScore: float = 0.0  # diagnostics-only screen-replay signal — see moire_score() above, not currently gated on by any caller


@app.post("/verify", response_model=VerifyResponse)
def verify(req: VerifyRequest):
    if not req.images:
        raise HTTPException(status_code=400, detail="At least one image is required")

    detected: List[Tuple[np.ndarray, Any]] = []  # (source image, face) pairs — kept together so the moire check can crop from the same frame the identity embedding came from
    for b64 in req.images:
        img = decode_image(b64)
        face = get_largest_face(img)
        if face is not None:
            detected.append((img, face))

    detected_faces = [f for _, f in detected]

    if not detected_faces:
        return VerifyResponse(
            embedding=None,
            livenessScore=0.0,
            faceDetected=False,
            framesWithFace=0,
            framesSubmitted=len(req.images),
            actionResults={a: False for a in req.challengeActions},
            moireScore=0.0,
        )

    # Use the largest/most frontal face across the burst for the actual
    # identity embedding (and the moire check, so both signals come from the
    # same frame).
    best_img, best_face = max(detected, key=lambda pair: (pair[1].bbox[2] - pair[1].bbox[0]) * (pair[1].bbox[3] - pair[1].bbox[1]))

    # --- Passive liveness: landmark movement across the burst. ---
    # A live person shows natural micro-movement (even just holding a phone
    # steady involves tiny hand tremor, plus blinking); a printed photo or a
    # frozen video replay does not. Movement is normalized by face width so
    # distance-to-camera doesn't skew the score. Kept as a secondary signal
    # alongside the action-specific checks below — a photo held up to the
    # camera fails both; a video replay that happens to jiggle still has to
    # separately match whatever specific actions were just randomly asked
    # for.
    if len(detected_faces) >= 2:
        movements = []
        for i in range(1, len(detected_faces)):
            prev_kps = detected_faces[i - 1].kps
            curr_kps = detected_faces[i].kps
            box_width = max(detected_faces[i].bbox[2] - detected_faces[i].bbox[0], 1.0)
            movement = float(np.mean(np.linalg.norm(curr_kps - prev_kps, axis=1))) / box_width
            movements.append(movement)
        liveness_score = min(1.0, max(movements) * 40.0)
    else:
        # A single frame gives no way to check motion at all — score this
        # conservatively rather than assume it's fine.
        liveness_score = 0.3

    # --- Challenge-response: did the burst actually contain the specific
    # dynamically-requested action(s)? This is what makes the on-screen
    # instruction ("turn right", "blink", ...) something that's actually
    # checked, rather than just displayed as text while any frame gets
    # accepted underneath it. ---
    detected_actions = actions_detected_in_burst(detected_faces)
    action_results = {a: detected_actions.get(a, False) for a in req.challengeActions}

    return VerifyResponse(
        embedding=best_face.normed_embedding.tolist(),
        livenessScore=liveness_score,
        faceDetected=True,
        framesWithFace=len(detected_faces),
        framesSubmitted=len(req.images),
        actionResults=action_results,
        moireScore=moire_score(best_img, best_face),
    )


@app.get("/health")
def health():
    return {"status": "ok", "modelLoaded": face_app is not None}
