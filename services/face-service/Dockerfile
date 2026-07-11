FROM python:3.11-slim

WORKDIR /app

# libgl1/libglib2.0-0: required shared libraries for opencv-python-headless
# on Debian-based images (not needed with a full desktop image, but this is
# a minimal one).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Pre-download the InsightFace model bundle at build time instead of on
# first request, so the container's first real request isn't slow and so
# deployment fails fast (at build time) if there's no internet access for
# the download rather than failing at first use in production.
RUN python -c "from insightface.app import FaceAnalysis; f = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider']); f.prepare(ctx_id=-1, det_size=(640,640))"

EXPOSE 8001

# Single worker by default — safest choice, since each additional uvicorn
# worker is a separate OS process that independently loads its own full copy
# of the buffalo_l model bundle into RAM on startup (measured ~1GB+ per
# process here), so raising this multiplies memory use. Load-tested at 1
# worker: a single /verify call takes ~1.5s, but 10 concurrent calls each
# took 6.5-8.4s (serialized on the one process's CPU-bound inference) —
# no crash, just proportionally slower under concurrent check-ins (e.g. a
# 9am rush). If the deployment box has the spare RAM and CPU cores, raise
# FACE_SERVICE_WORKERS (e.g. to the number of physical cores) to trade that
# memory for real concurrent throughput; shell-form CMD so the env var is
# substituted at container start.
ENV FACE_SERVICE_WORKERS=1
# Honor a platform-injected PORT (Google Cloud Run / Render set this), else 8001
# so local Docker/compose is unchanged. Shell-form CMD so the vars substitute at
# container start.
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001} --workers ${FACE_SERVICE_WORKERS}
