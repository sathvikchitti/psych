---
title: PsychSense Backend
emoji: 🧠
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# PsychSense — AI Mental Health Analysis Backend

Flask + PyTorch backend for PsychSense.  
Exposes three endpoints consumed by the frontend (Vercel/static host):

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness check |
| `/analyze` | POST | Multipart — audio + text + questionnaire → risk JSON |
| `/generate-pdf` | POST | JSON payload → styled A4 PDF report (binary) |

## Deployment on HuggingFace Spaces

1. Create a new Space → **Docker** SDK
2. Upload the contents of the `backend/` folder to the Space repo root
3. Upload `model_new_feature.pt` to the Space repo (or set `MODEL_PATH` secret)
4. Set these **Space Secrets** (Settings → Variables and secrets):

| Secret | Value |
|---|---|
| `ALLOWED_ORIGIN` | Your frontend URL e.g. `https://psychsense.vercel.app` |
| `MODEL_PATH` | `/app/model_new_feature.pt` (default, change if needed) |

5. The Space will build automatically. Check the **Logs** tab — you should see:
```
[ManoDhwani] PDF engine: WeasyPrint ✓
[ManoDhwani] Device: cpu  |  FP16: False
[ManoDhwani] AudioTextFusionNet v4 loaded
```

## Local Development (Windows)

```powershell
# Inside backend/
pip install -r requirements.txt

# Delete stale cache first
Remove-Item -Recurse -Force __pycache__

python app.py
```

> **PDF on Windows:** WeasyPrint needs GTK3.  
> Download & install from: https://github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer/releases  
> Then restart your terminal and run again. PDF will work automatically.

## Frontend connection

In your frontend JS, set:
```js
const FLASK_API_URL = 'https://<your-hf-username>-psychsense-backend.hf.space';
```