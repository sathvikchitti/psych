FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 7860

# Use gunicorn instead of Flask dev server:
#   --timeout 120  → gives model inference up to 120s before giving up
#   --workers 1    → single worker (CPU-only, models are huge — don't fork)
#   --threads 2    → allows health-check to respond while /analyze is running
CMD ["gunicorn", "--bind", "0.0.0.0:7860", "--timeout", "120", "--workers", "1", "--threads", "2", "app:app"]
