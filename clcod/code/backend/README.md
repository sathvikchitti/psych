---
title: PsychSense
colorFrom: blue
colorTo: purple
sdk: docker
pinned: false
app_port: 7860
---

---
title: PsychSense
emoji: ??
colorFrom: blue
colorTo: purple
sdk: docker
pinned: false
app_port: 7860
---

# PsychSense — Setup Guide

## Folder structure after setup
```
psychsense/
  backend/
    app.py               ← Flask server  (this file)
    requirements.txt
    model_corrected.pt   ← YOUR trained checkpoint (copy here)
  code/
    index.html
    js/app.js            ← already patched to call Flask
    js/firebase-config.js
    js/backgrounds.js
    css/style.css
    package.json
```

---

## Step 1 — Copy your model checkpoint

Copy `model_corrected.pt` (saved by your training script) into the `backend/` folder:

```
backend/model_corrected.pt
```

If you saved it somewhere else, set the env var instead:
```bash
export MODEL_PATH=/path/to/model_corrected.pt
```

---

## Step 2 — Install Python dependencies

```bash
cd backend
pip install -r requirements.txt
```

If you have a GPU, install the CUDA version of PyTorch first:
```bash
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

---

## Step 3 — Start the Flask backend

```bash
cd backend
python app.py
```

You should see:
```
[PsychSense] Device: cuda  (or cpu)
[PsychSense] DepressionNet loaded  CLNF_DIM=...  threshold=...
[PsychSense] WavLM loaded ✓
[PsychSense] BERT loaded ✓
 * Running on http://0.0.0.0:5000
```

Verify it's alive:
```bash
curl http://127.0.0.1:5000/health
# → {"device":"cpu","status":"ok"}
```

---

## Step 4 — Start the frontend

In a second terminal:
```bash
cd code
npm start
```

Open http://127.0.0.1:3000 in your browser.

---

## How the connection works

```
Browser (port 3000)
  └─ POST /analyze  (multipart/form-data)
        ├─ text          : written expression string
        ├─ audio         : wav/mp3 file  (optional)
        ├─ video         : mp4/webm file (optional)
        ├─ questionnaire : JSON string
        └─ userInfo      : JSON string

Flask (port 5000)
  └─ Extracts:
        ├─ WavLM embedding from audio  (768-d)
        ├─ BERT [CLS] embedding from text  (768-d)
        └─ CLNF zeros if no OpenFace  (CLNF_DIM-d)
  └─ Runs DepressionNet forward pass
  └─ Returns JSON:
        riskLevel, confidenceScore, contributions,
        emotionalSignals, insights, recommendations
```

---

## Deploying to Production

Before going live, make two changes:

**1. Set your backend URL in `js/app.js`:**
```js
const FLASK_API_URL = 'https://your-backend.railway.app';
```

**2. Set the `ALLOWED_ORIGIN` env var when running Flask:**
```bash
export ALLOWED_ORIGIN=https://your-frontend.vercel.app
python app.py
```
This locks CORS to your production frontend. In local dev, leave it unset (defaults to `*`).

---



The visual branch currently uses zero vectors because OpenFace
cannot run inside a browser. To enable it:

1. Install OpenFace: https://github.com/TadasBaltrusaitis/OpenFace
2. Uncomment the subprocess block inside `extract_clnf_from_video()`
   in `backend/app.py`

---

## Common errors

| Error | Fix |
|---|---|
| `Checkpoint not found` | Copy `model_corrected.pt` into `backend/` |
| `Cannot reach the Flask backend` | Make sure `python app.py` is running |
| `CORS error in browser console` | Flask already has CORS enabled — check you're on port 3000 |
| `torch not found` | Run `pip install -r requirements.txt` |
| `WavLM download slow` | First run downloads ~360MB — normal, cached after that |


