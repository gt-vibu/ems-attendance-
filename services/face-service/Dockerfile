FROM python:3.11-slim

WORKDIR /app

# libgl1/libglib2.0-0: required shared libraries for opencv-python-headless
# on Debian-based images (not needed with a full desktop image, but this is
# a minimal one).
# build-essential: some transitive dependencies (e.g. insightface -> stringzilla)
# ship no prebuilt wheel for every platform/Python combo and fall back to
# compiling a C extension from source at install time — without a compiler
# present, that install fails with "gcc: No such file or directory". Slim
# base images don't include one by default.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Pre-download the InsightFace buffalo_s bundle at build time instead of on
# first request, so the container's first real request isn't slow and so
# deployment fails fast (at build time) if there's no internet access for
# the download rather than failing at first use in production. One pack
# only — buffalo_s ships detection, recognition, AND landmark_2d_106 (see
# load_model() in main.py), so nothing else needs downloading. Loading via
# allowed_modules=['detection','recognition','landmark_2d_106'] here (rather
# than the full FaceAnalysis default) keeps this build-time sanity check
# consistent with what actually loads at runtime — the zip still extracts
# every file in the pack regardless (including the unused 1k3d68.onnx and
# genderage.onnx), but this avoids loading the 143MB landmark_3d_68 model
# into memory for a check that doesn't need it.
RUN python -c "from insightface.app import FaceAnalysis; f = FaceAnalysis(name='buffalo_s', providers=['CPUExecutionProvider'], allowed_modules=['detection', 'recognition', 'landmark_2d_106']); f.prepare(ctx_id=-1, det_size=(320,320))"

EXPOSE 8001

# Single worker by default — safest choice, since each additional uvicorn
# worker is a separate OS process that independently loads its own copy of
# the models into RAM on startup. Raise FACE_SERVICE_WORKERS only if the
# deployment box has the spare RAM/cores to trade for real concurrent
# throughput; shell-form CMD so the env var is substituted at container
# start.
ENV FACE_SERVICE_WORKERS=1
# Honor a platform-injected PORT (Google Cloud Run / Render set this), else 8001
# so local Docker/compose is unchanged. Shell-form CMD so the vars substitute at
# container start.
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001} --workers ${FACE_SERVICE_WORKERS}
