"""
Smart Teams Face Service
========================
A small, standalone microservice that does all face detection, recognition,
and liveness/action verification server-side, using InsightFace's buffalo_s
pack over ONNX Runtime — loaded manually (see load_model() below) rather
than through InsightFace's FaceAnalysis convenience class, specifically to
control ONNX Runtime's memory settings. This matters more than it sounds:
FaceAnalysis's defaults (a growing memory arena, plus a thread pool sized to
every CPU core the host reports) measurably OOM'd a real 512MB container
that ran the exact same three models fine unconstrained — see load_model()'s
comments for the actual before/after numbers this was tuned against.

Uses landmark_2d_106 (2d106det.onnx, ~5MB), not landmark_3d_68 (1k3d68.onnx,
143MB) — that swap is what actually made a 512MB container survive loading
at all (see load_model()'s comments: the 143MB model's own one-time parse
transiently spikes well past what any session/thread tuning can fix). The
tradeoff: landmark_3d_68 gave a head pose (pitch/yaw/roll) for free;
landmark_2d_106 doesn't, so this file estimates it itself via cv2.solvePnP
against a generic 3D face reference — see the "Landmark geometry" section.

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

First run downloads the buffalo_s model bundle to ~/.insightface/models/ —
this requires outbound internet access the first time only; after that it's
cached on disk. Steady-state memory after all three models are loaded is
~160-165MB (measured), comfortably under a 512MB container limit — see
load_model() for the full story of what didn't fit before this (~544MB with
FaceAnalysis's defaults, then ~412MB after tuning ONNX Runtime's session
settings — still using landmark_3d_68 at that point, whose own 143MB load
transiently exceeded 512MB independent of any of those settings; switching
to the much smaller landmark_2d_106 is what actually solved it).
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

app = FastAPI(title="Smart Teams Face Service", version="3.1.0")

# The Node app and this service are expected to run on a private
# network/localhost together, but CORS is opened here in case the Node app
# ever calls this from a different origin during local development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Action-detection thresholds
# ---------------------------------------------------------------------------
# All population-level defaults (not calibrated per-user), tuned for a
# typical webcam/phone-camera capture distance. Adjust per deployment if a
# particular camera setup produces systematically different readings.
#
# IMPORTANT — these are placeholder starting points, not yet verified against
# a real camera. The eye/mouth "openness ratio" thresholds below replace an
# earlier version of this file's classic 6-point EAR/MAR formulas (Soukupová
# & Čech-style), which assumed the 68-point iBUG layout's specific point
# roles (exact upper-lid/lower-lid pairs, exact mouth corner indices).
# landmark_2d_106's per-point roles aren't officially documented (confirmed
# by generating an annotated visualization against a real test image and
# reading off index ranges directly — see the "Landmark geometry" section
# below) — rather than guess at fragile point-role pairings that could be
# subtly wrong with no way to notice, these use each region's bounding-box
# height/width ratio instead: self-normalizing, only depends on getting the
# INDEX RANGE for each region right (which was verified empirically), not
# which exact point is "upper lid, second from the corner". Same relative-
# dip-against-this-burst's-own-peak approach for blink either way.
BLINK_RELATIVE_DROP = 0.90   # eye counted as blinking if it dips to <=90% of this burst's own peak-open ratio
BLINK_OPENNESS_ABS_CEILING = 0.60  # sanity check — the dip must also be a plausibly-closed absolute ratio, not just "a bit less wide-eyed than the peak". UNVERIFIED against a live camera — bounding-box height/width lands in a different numeric range than classic EAR.

# Mouth "openness ratio" (bounding-box height/width over the whole 20-point
# mouth region) — open-mouth/yawn heuristic. UNVERIFIED against a live
# camera; tune after real testing, same as every other threshold here.
OPEN_MOUTH_RATIO_THRESHOLD = 0.55

# Smile: distinguished from "open mouth" by mouth WIDTH increasing (relative
# to the stable interocular distance, so it isn't skewed by camera distance)
# while the mouth doesn't also open into a full openness-ratio spike.
SMILE_WIDTH_RATIO_THRESHOLD = 0.52
SMILE_MAX_OPENNESS = OPEN_MOUTH_RATIO_THRESHOLD

# Head pose thresholds, in degrees, applied to this file's own solvePnP-
# estimated (pitch, yaw, roll) — see estimate_pose() below. NOTE ON SIGN
# CONVENTION: UNVERIFIED against a live camera. The previous version of this
# file (using InsightFace's own landmark_3d_68-derived pose) had confirmed,
# calibrated signs from real testing; solvePnP against a different (self-
# supplied) generic 3D reference model is NOT guaranteed to produce the same
# sign convention, even though the underlying idea (positive/negative yaw
# meaning left/right turn) is the same in spirit. Confirm turn_left/
# turn_right and look_up/look_down against a real camera before relying on
# this — flip YAW_SIGN/PITCH_SIGN below if they come out backwards, exactly
# as the previous version's own honest-limitations note already flagged for
# its own (different) pose source.
YAW_TURN_THRESHOLD_DEG = 15.0
PITCH_LOOK_THRESHOLD_DEG = 9.0
YAW_SIGN = 1
PITCH_SIGN = 1

# For the "look_center" baseline pose captured during enrollment — just
# needs a face detected with a roughly neutral pose, not a hard requirement.
CENTER_YAW_MAX_DEG = 20.0
CENTER_PITCH_MAX_DEG = 20.0

NON_BASELINE_ACTIONS = [
    "turn_left", "turn_right", "look_up", "look_down",
    "smile", "open_mouth", "blink",
]
ALL_ENROLLMENT_ACTIONS = ["look_center"] + NON_BASELINE_ACTIONS


det_model = None       # RetinaFace (det_500m.onnx) — lazily set at startup
rec_model = None       # ArcFaceONNX (w600k_mbf.onnx) — lazily set at startup
landmark_model = None  # Landmark (2d106det.onnx) — lazily set at startup


@app.on_event("startup")
def load_model():
    global det_model, rec_model, landmark_model
    # Imported here (not at module top) so that a syntax/import error in
    # this file can still be caught by simple tools without insightface
    # actually being installed, and so the log lines below are the first
    # thing that happens after the real dependency is confirmed importable.
    import os
    import onnxruntime as ort
    from insightface.utils import ensure_available
    from insightface.model_zoo.retinaface import RetinaFace
    from insightface.model_zoo.arcface_onnx import ArcFaceONNX
    from insightface.model_zoo.landmark import Landmark

    # buffalo_s's zip bundle ships both landmark models — 1k3d68.onnx
    # (landmark_3d_68, 143MB) AND 2d106det.onnx (landmark_2d_106, ~5MB) —
    # alongside its own much smaller detector (det_500m, ~2.5MB) and
    # recognizer (w600k_mbf, a MobileFaceNet, ~13MB). This service uses the
    # 106-point model: loading 1k3d68.onnx's 143MB was confirmed (via
    # `docker run --memory=512m` reproducing the exact OOM Render reported)
    # to transiently exceed 512MB during its own one-time parse/graph-
    # construction step alone — independent of every session-level memory
    # setting below, which only affects steady-state/thread memory, not that
    # spike. 2d106det.onnx doesn't have this problem at ~5MB. The tradeoff:
    # it doesn't produce a pose (pitch/yaw/roll) the way landmark_3d_68 did
    # for free — see estimate_pose() in the "Landmark geometry" section for
    # how this file computes that itself via cv2.solvePnP instead.
    #
    # These three models are loaded WITHOUT InsightFace's FaceAnalysis
    # convenience class — deliberately, because FaceAnalysis's defaults
    # don't leave enough headroom for a real 512MB container even with the
    # smaller landmark model:
    #   - FaceAnalysis(name='buffalo_s', ...) via ort.InferenceSession
    #     defaults: settled at ~544MB RSS after all three models loaded
    #     (measured with landmark_3d_68 still in the mix), no requests
    #     served yet.
    #   - Same models, loaded manually via onnxruntime.InferenceSession
    #     directly so a custom SessionOptions can be supplied: ~412MB RSS
    #     with landmark_3d_68, comfortably under 512MB with the much
    #     smaller landmark_2d_106. Numerically identical embedding/landmark
    #     output either way — verified against the FaceAnalysis path on the
    #     same test image before switching.
    # The two settings that actually mattered:
    #   - intra_op_num_threads=1 / inter_op_num_threads=1 — ONNX Runtime's
    #     default sizes its thread pool to every CPU core the HOST reports,
    #     not the container's actual CPU allocation, and each thread carries
    #     its own scratch buffers across all 3 sessions. A single-worker,
    #     low-QPS attendance check-in service doesn't need intra-request
    #     parallelism to begin with.
    #   - enable_cpu_mem_arena=False / enable_mem_pattern=False — this was
    #     the single biggest lever (~100MB of the ~130MB total reduction).
    #     ONNX Runtime's memory arena pre-reserves and grows speculatively
    #     to avoid repeated malloc/free during heavy inference throughput;
    #     for a service that verifies one short camera burst at a time, the
    #     small per-call allocator overhead this trades away is irrelevant
    #     next to actually fitting in a free-tier container.
    sess_options = ort.SessionOptions()
    sess_options.intra_op_num_threads = 1
    sess_options.inter_op_num_threads = 1
    sess_options.enable_cpu_mem_arena = False
    sess_options.enable_mem_pattern = False

    providers = ["CPUExecutionProvider"]
    # arena_extend_strategy only matters if enable_cpu_mem_arena is ever
    # turned back on for a deployment with more memory to spare — kept here
    # so that reverting the two flags above doesn't silently regress this too.
    provider_options = [{"arena_extend_strategy": "kSameAsRequested"}]

    logger.info("Loading InsightFace buffalo_s (detection + recognition + landmark_2d_106, CPU)...")
    model_dir = ensure_available("models", "buffalo_s", root="~/.insightface")

    def make_session(filename: str) -> ort.InferenceSession:
        path = os.path.join(model_dir, filename)
        return ort.InferenceSession(path, sess_options=sess_options, providers=providers, provider_options=provider_options)

    det_model = RetinaFace(model_file=os.path.join(model_dir, "det_500m.onnx"), session=make_session("det_500m.onnx"))
    rec_model = ArcFaceONNX(model_file=os.path.join(model_dir, "w600k_mbf.onnx"), session=make_session("w600k_mbf.onnx"))
    landmark_model = Landmark(model_file=os.path.join(model_dir, "2d106det.onnx"), session=make_session("2d106det.onnx"))

    # det_size: the resolution the detector scans at. 320x320 rather than the
    # 640x640 default — this app's captures are always a single close-up face
    # (a phone/webcam selfie for KYC/attendance), not a crowd photo needing to
    # find small/distant faces, so the accuracy loss from a smaller scan
    # resolution is negligible for this use case, and it cuts memory/latency.
    det_model.prepare(-1, input_size=(320, 320), det_thresh=0.5)  # ctx_id=-1 => CPU only, no GPU required
    rec_model.prepare(-1)
    landmark_model.prepare(-1)

    logger.info("Model loaded. Face service ready (buffalo_s, incl. landmark_2d_106).")


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
    or None if no face was found. Runs detection, then enriches every
    detected face with the recognition embedding and landmark_2d_106 — the
    same per-face pipeline FaceAnalysis.get() would run, just against the
    three manually-loaded models above instead of through that class."""
    if det_model is None or rec_model is None or landmark_model is None:
        raise HTTPException(status_code=503, detail="Model is still loading — try again in a moment.")

    from insightface.app.common import Face

    bboxes, kpss = det_model.detect(img, max_num=0, metric="default")
    if bboxes.shape[0] == 0:
        return None

    faces = []
    for i in range(bboxes.shape[0]):
        kps = kpss[i] if kpss is not None else None
        face = Face(bbox=bboxes[i, 0:4], kps=kps, det_score=bboxes[i, 4])
        rec_model.get(img, face)
        landmark_model.get(img, face)
        # landmark_2d_106 has no built-in pose estimate the way
        # landmark_3d_68 did — estimate_pose() below needs the frame's
        # dimensions to build an approximate camera matrix, so stash them
        # on the face rather than threading img through every downstream
        # geometry function's signature.
        face["img_shape"] = img.shape[:2]  # (height, width)
        faces.append(face)

    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))


# ---------------------------------------------------------------------------
# Landmark geometry — action detection from a single detected face
# ---------------------------------------------------------------------------
# landmark_2d_106's per-point layout isn't published by InsightFace anywhere
# citable — the index ranges below were derived empirically, not copied from
# documentation: ran the model against a real test photo, rendered each of
# the 106 points with its index number overlaid, and read off where each
# region's points actually land. That gave a clean, self-consistent
# breakdown (all 7 regions sum to exactly 106, which a wrong split wouldn't):
#   0-32    face contour / jaw     (33 points)
#   33-42   right eye              (10 points)
#   43-51   right eyebrow          (9 points, unused)
#   52-71   mouth (outer + inner)  (20 points)
#   72-86   nose                   (15 points)
#   87-96   left eye               (10 points)
#   97-105  left eyebrow           (9 points, unused)
# "left"/"right" are the subject's own left/right, not image left/right.
#
# What ISN'T empirically confirmed: the exact ROLE of each point within a
# region (which specific index is "upper eyelid, 2nd from corner" vs "lower
# eyelid, middle") — the two eyes' corner points didn't even land in
# matching relative index positions when checked (e.g. the right eye's
# widest-separated points weren't the same relative index as the left eye's),
# so hand-picking point PAIRS the way the classic 6-point EAR/MAR formulas
# do would be guessing. Instead, every ratio below uses each region's
# bounding-box height/width — self-normalizing, and only needs the INDEX
# RANGE to be right (which was verified), not which exact point plays which
# specific role.
JAW = list(range(0, 33))
EYE_RIGHT = list(range(33, 43))
EYEBROW_RIGHT = list(range(43, 52))
MOUTH = list(range(52, 72))
NOSE = list(range(72, 87))
EYE_LEFT = list(range(87, 97))
EYEBROW_LEFT = list(range(97, 106))
NOSE_TIP_INDEX = 79  # bottom-center of the nose (columella) — confirmed visually in the same test render


def _dist(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a - b))


def _landmarks_xy(face) -> Optional[np.ndarray]:
    lmk = getattr(face, "landmark_2d_106", None)
    if lmk is None:
        return None
    return np.asarray(lmk)[:, :2]


def _region_openness_ratio(lm: np.ndarray, region: List[int]) -> float:
    """Bounding-box height/width for the given region's points — used for
    both eye-openness (blink) and mouth-openness (open_mouth), since both
    are fundamentally "how tall is this region relative to how wide"."""
    pts = lm[region]
    width = pts[:, 0].max() - pts[:, 0].min()
    height = pts[:, 1].max() - pts[:, 1].min()
    return float(height) / (float(width) + 1e-6)


def eye_openness_ratio(lm: np.ndarray) -> float:
    return (_region_openness_ratio(lm, EYE_RIGHT) + _region_openness_ratio(lm, EYE_LEFT)) / 2.0


def mouth_openness_ratio(lm: np.ndarray) -> float:
    return _region_openness_ratio(lm, MOUTH)


def mouth_width_ratio(lm: np.ndarray) -> float:
    """Mouth width (widest horizontal span across the 20 mouth points)
    normalized by interocular distance (between the two eyes' own centers),
    so it isn't skewed by how close the camera is."""
    mouth_pts = lm[MOUTH]
    mouth_width = float(mouth_pts[:, 0].max() - mouth_pts[:, 0].min())
    eye_right_center = lm[EYE_RIGHT].mean(axis=0)
    eye_left_center = lm[EYE_LEFT].mean(axis=0)
    interocular = _dist(eye_right_center, eye_left_center)
    return mouth_width / (interocular + 1e-6)


# ---------------------------------------------------------------------------
# Head pose via solvePnP — landmark_2d_106 doesn't produce pose the way
# landmark_3d_68 did, so this estimates it the standard OpenCV way: match a
# handful of 2D landmark points against their approximate positions on a
# generic (not person-specific) 3D face, and let solvePnP recover the
# rotation that would produce that projection. This is the same "6-point
# head pose" technique commonly used with dlib/OpenCV — not novel, but ALSO
# not verified yet against this specific pipeline's landmark points or a
# live camera (see the YAW_SIGN/PITCH_SIGN note near the thresholds above).
# ---------------------------------------------------------------------------

# Generic 3D reference face (arbitrary units, roughly millimeters, centered
# near the nose tip) — the standard reference points used across most
# OpenCV/dlib head-pose-estimation writeups, not measured from any real
# person or from this app's own users.
_GENERIC_3D_FACE = np.array([
    [0.0, 0.0, 0.0],           # nose tip
    [0.0, -330.0, -65.0],      # chin
    [-225.0, 170.0, -135.0],   # subject's right eye, outer corner
    [225.0, 170.0, -135.0],    # subject's left eye, outer corner
    [-150.0, -150.0, -125.0],  # subject's right mouth corner
    [150.0, -150.0, -125.0],   # subject's left mouth corner
], dtype=np.float64)


def estimate_pose(face) -> Optional[Tuple[float, float, float]]:
    """Returns (pitch, yaw, roll) in degrees via solvePnP, or None if the
    face has no landmarks/image context to work from, or solvePnP itself
    fails to converge (rare, but possible at extreme angles)."""
    lm = _landmarks_xy(face)
    if lm is None:
        return None
    img_shape = getattr(face, "img_shape", None)
    if img_shape is None:
        return None

    # Corners are found dynamically (min/max x within each region) rather
    # than by a hardcoded index — see the module-level comment on why exact
    # per-point roles within a region aren't assumed anywhere in this file.
    eye_right_pts, eye_left_pts = lm[EYE_RIGHT], lm[EYE_LEFT]
    mouth_pts = lm[MOUTH]
    nose_tip = lm[NOSE_TIP_INDEX]
    chin = lm[JAW][np.argmax(lm[JAW][:, 1])]  # lowest (largest y) jaw point
    eye_right_outer = eye_right_pts[np.argmin(eye_right_pts[:, 0])]  # away from nose bridge = smallest x on this side
    eye_left_outer = eye_left_pts[np.argmax(eye_left_pts[:, 0])]
    mouth_right_corner = mouth_pts[np.argmin(mouth_pts[:, 0])]
    mouth_left_corner = mouth_pts[np.argmax(mouth_pts[:, 0])]

    image_points = np.array([
        nose_tip, chin, eye_right_outer, eye_left_outer, mouth_right_corner, mouth_left_corner,
    ], dtype=np.float64)

    h, w = img_shape
    focal_length = w  # standard approximation absent real camera calibration
    camera_matrix = np.array([
        [focal_length, 0, w / 2],
        [0, focal_length, h / 2],
        [0, 0, 1],
    ], dtype=np.float64)
    dist_coeffs = np.zeros((4, 1))  # assume no lens distortion

    ok, rvec, _tvec = cv2.solvePnP(_GENERIC_3D_FACE, image_points, camera_matrix, dist_coeffs, flags=cv2.SOLVEPNP_ITERATIVE)
    if not ok:
        return None

    rotation_matrix, _ = cv2.Rodrigues(rvec)
    # Standard rotation-matrix -> Euler angle decomposition (X=pitch,
    # Y=yaw, Z=roll), matching the convention this file's thresholds assume.
    sy = np.sqrt(rotation_matrix[0, 0] ** 2 + rotation_matrix[1, 0] ** 2)
    singular = sy < 1e-6
    if not singular:
        pitch = np.arctan2(rotation_matrix[2, 1], rotation_matrix[2, 2])
        yaw = np.arctan2(-rotation_matrix[2, 0], sy)
        roll = np.arctan2(rotation_matrix[1, 0], rotation_matrix[0, 0])
    else:
        pitch = np.arctan2(-rotation_matrix[1, 2], rotation_matrix[1, 1])
        yaw = np.arctan2(-rotation_matrix[2, 0], sy)
        roll = 0.0

    return float(np.degrees(pitch)), float(np.degrees(yaw)), float(np.degrees(roll))


def actions_detected_in_burst(faces: List) -> Dict[str, bool]:
    """Given every successfully-detected face across a capture burst (one
    entry per frame that had a face in it), return which of the 7
    non-baseline challenge actions were exhibited at any point in the
    burst. A live person moving through the requested pose will cross the
    relevant threshold in at least one frame; a static photo held up to the
    camera never will, because every frame reads the same neutral pose."""
    results = {action: False for action in NON_BASELINE_ACTIONS}

    openness_ratios: List[float] = []
    for face in faces:
        lm = _landmarks_xy(face)
        if lm is None:
            continue

        eye_ratio = eye_openness_ratio(lm)
        openness_ratios.append(eye_ratio)

        mouth_ratio = mouth_openness_ratio(lm)
        if mouth_ratio > OPEN_MOUTH_RATIO_THRESHOLD:
            results["open_mouth"] = True

        width_ratio = mouth_width_ratio(lm)
        if width_ratio > SMILE_WIDTH_RATIO_THRESHOLD and mouth_ratio <= SMILE_MAX_OPENNESS:
            results["smile"] = True

        pose = estimate_pose(face)
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

    # Blink: a relative dip against this burst's own peak-open ratio, rather
    # than a fixed population threshold (see BLINK_RELATIVE_DROP comment) —
    # requires at least 2 frames with landmarks to have something to compare.
    if len(openness_ratios) >= 2:
        max_ratio = max(openness_ratios)
        min_ratio = min(openness_ratios)
        if min_ratio <= BLINK_OPENNESS_ABS_CEILING and min_ratio <= max_ratio * BLINK_RELATIVE_DROP:
            results["blink"] = True

    return results


def is_neutral_pose(face) -> bool:
    pose = estimate_pose(face)
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
    return {"status": "ok", "modelLoaded": det_model is not None and rec_model is not None and landmark_model is not None}
