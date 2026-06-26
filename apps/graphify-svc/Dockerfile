# graphify-svc — clones repos + runs the graphify extraction pipeline behind HTTP.
# Needs `git` (to clone) at runtime. tree-sitter wheels are prebuilt, so no
# compiler toolchain is required.
FROM python:3.12-slim

# git is required at runtime to clone the target repos.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for layer caching.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./

# Run as non-root.
RUN useradd --create-home --uid 10001 svc \
    && mkdir -p /tmp && chown -R svc /app
USER svc

ENV PORT=3050 \
    PYTHONUNBUFFERED=1 \
    GRAPHIFY_OUT=graphify-out

EXPOSE 3050

# Single worker: extraction is CPU/LLM-bound and writes to a per-request tmpdir;
# concurrency is bounded upstream by Axon (one analysis per project at a time).
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-3050}"]
