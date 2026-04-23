# ╔══════════════════════════════════════════════════════════════════╗
# ║  PsychSense Backend — HuggingFace Spaces / Docker               ║
# ║  Port 7860 (HF Spaces standard)                                 ║
# ╚══════════════════════════════════════════════════════════════════╝

FROM python:3.11-slim

# ── System deps ────────────────────────────────────────────────────
# WeasyPrint needs GTK3/Pango/GLib (all available on Debian/Ubuntu).
# libsndfile1   → soundfile / librosa audio decoding
# ffmpeg        → librosa mp3/webm support
RUN apt-get update && apt-get install -y --no-install-recommends \
      # WeasyPrint GTK stack
      libpango-1.0-0 \
      libpangoft2-1.0-0 \
      libpangocairo-1.0-0 \
      libcairo2 \
      libgdk-pixbuf-2.0-0 \
      libffi-dev \
      libglib2.0-0 \
      # Audio
      libsndfile1 \
      ffmpeg \
      # Fonts (so PDF text renders correctly)
      fonts-liberation \
      fonts-dejavu-core \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── App user (HF Spaces runs as uid 1000) ─────────────────────────
RUN useradd -m -u 1000 appuser
WORKDIR /app

# ── Python deps ────────────────────────────────────────────────────
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── App code + model ───────────────────────────────────────────────
COPY . .
RUN chown -R appuser:appuser /app
USER appuser

# HuggingFace Spaces requires port 7860
EXPOSE 7860

# gunicorn: single worker (model is large), 2 threads so /health
# responds while /analyze is running, 180s timeout for inference.
CMD ["gunicorn", \
     "--bind", "0.0.0.0:7860", \
     "--timeout", "180", \
     "--workers", "1", \
     "--threads", "2", \
     "app:app"]