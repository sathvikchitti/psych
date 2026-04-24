# 🧠 ManoDhwani — Multimodal Depression Detection Platform

> *ManoDhwani* (మనోధ్వని) — "Sound of the Mind" in Telugu.  
> An AI-powered mental health screening tool that analyses voice, language, and questionnaire responses to assess depression risk.

---

## Abstract

ManoDhwani is a full-stack multimodal depression detection system designed for accessible, privacy-aware mental health screening. It fuses three input modalities — **audio (voice biomarkers)**, **text (natural language)**, and **structured questionnaire responses** — through a custom deep learning model (`AudioTextFusionNet v4`) built on WavLM and RoBERTa, trained to classify depressive risk across Low, Moderate, and High categories.

The platform is built for real-world clinical adjacency: every session produces a clinician-readable PDF report with a probability score, depression subtype classification, personalised recommendations, and a longitudinal trajectory chart tracking the user's mental health over time. User data is stored securely per-session in Firebase Firestore, gated behind Google OAuth, and all AI inference runs on a containerised Flask backend hosted on Hugging Face Spaces.

ManoDhwani is not a diagnostic tool — it is a screening aid intended to lower the barrier to mental health awareness and encourage timely professional consultation.

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│              Frontend (Static)              │
│  HTML · Tailwind CSS · Vanilla JS           │
│  Hosted on Vercel                           │
│                                             │
│  Pages: Landing → Login → User Info →      │
│         Analysis → Synthesizing →          │
│         Results → Profile                  │
└────────────────┬────────────────────────────┘
                 │  REST API (CORS)
                 ▼
┌─────────────────────────────────────────────┐
│           Backend (Flask + PyTorch)         │
│  Hosted on Hugging Face Spaces (Docker)     │
│                                             │
│  POST /analyze   → risk JSON               │
│  POST /generate-pdf → styled PDF (binary)  │
│  GET  /health    → liveness check          │
│                                             │
│  Model: AudioTextFusionNet v4              │
│    Audio encoder  : WavLM-base             │
│    Text encoder   : RoBERTa-base           │
│    Fusion         : Cross-attention + MLP  │
└────────────────┬────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────┐
│              Firebase                       │
│  Auth     : Google OAuth (sign-in)         │
│  Firestore: User profiles + report history │
└─────────────────────────────────────────────┘
```

---

## Features

- **Multimodal analysis** — optional audio recording + free-text input + PHQ-style questionnaire, all fused into a single risk score
- **Depression subtype classification** — MDD, Postpartum, SAD, Atypical, Dysthymia, or general Depressive Episode
- **Longitudinal trajectory chart** — tracks probability scores across sessions over time
- **PDF report generation** — server-side WeasyPrint rendering; downloadable from results and profile history
- **Session history** — every assessment saved to Firestore; viewable and re-downloadable from the profile page
- **Google OAuth** — secure, passwordless authentication
- **Fully responsive** — works on desktop and mobile

---

## Repository Structure

```
/
├── index.html              # Landing page
├── login.html              # Google OAuth sign-in
├── user-info.html          # Demographics collection (age, gender)
├── analysis.html           # Audio recording + text input
├── questionnaire.html      # PHQ-style questionnaire
├── synthesizing.html       # Loading/processing screen
├── results.html            # Results, trajectory chart, PDF download
├── profile.html            # Session history, longitudinal chart
├── error.html              # Error fallback page
├── vercel.json             # Vercel routing rewrites
│
├── js/
│   ├── firebase-config.js  # Firebase init, auth helpers, Firestore CRUD
│   ├── storage-helper.js   # SessionStorage utilities
│   └── backgrounds.js      # Animated silk background
│
├── assets/
│   ├── hero_silk_bg.png
│   ├── brain_nbg.png
│   └── animation.mp4
│
└── backend/
    ├── app.py              # Flask app — /analyze, /generate-pdf, /health
    ├── requirements.txt
    ├── Dockerfile
    └── model_new_feature.pt  # PyTorch checkpoint (AudioTextFusionNet v4)
```

---

## Installation & Setup

### Prerequisites

- Python 3.10+
- Node.js (only needed if you use a local dev server — otherwise the frontend is plain HTML)
- A Firebase project with Firestore + Google Auth enabled
- Git

---

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/manodhwani.git
cd manodhwani
```

---

### 2. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com) → **Add project**
2. Enable **Authentication** → Sign-in method → **Google**
3. Enable **Firestore Database** → Start in production mode
4. Go to Project Settings → **Your apps** → Add a Web app → copy the config object
5. Replace the config in `js/firebase-config.js`:

```js
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

6. In Firestore, add this security rule to allow only authenticated users to access their own data:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

### 3. Backend — Local Development

```bash
cd backend
pip install -r requirements.txt
```

**Windows only — PDF support (WeasyPrint needs GTK3):**
Download and install the GTK3 runtime from:
https://github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer/releases

Then restart your terminal before running the server.

```bash
python app.py
```

The backend starts on `http://localhost:7860`.

---

### 4. Backend — Deploy to Hugging Face Spaces

1. Create a new Space at [huggingface.co/spaces](https://huggingface.co/spaces) → choose **Docker** SDK
2. Upload all files inside the `backend/` folder to the Space repo root
3. Upload `model_new_feature.pt` to the Space repo root (it's large — use Git LFS or the web uploader)
4. Set the following **Space Secrets** (Settings → Variables and secrets):

| Secret | Value |
|---|---|
| `ALLOWED_ORIGIN` | Your frontend URL, e.g. `https://manodhwani.vercel.app` |
| `MODEL_PATH` | `/app/model_new_feature.pt` |

5. The Space builds automatically. In the **Logs** tab you should see:
```
[ManoDhwani] PDF engine: WeasyPrint ✓
[ManoDhwani] Device: cpu  |  FP16: False
[ManoDhwani] AudioTextFusionNet v4 loaded
```

6. Copy your Space URL (e.g. `https://your-username-psychsense.hf.space`) and update it in `results.html`:

```js
const FLASK_API_URL = 'https://your-username-psychsense.hf.space';
```

---

### 5. Frontend — Deploy to Vercel

1. Push the repository root (everything outside `backend/`) to GitHub
2. Go to [vercel.com](https://vercel.com) → **New Project** → import your repo
3. No build step needed — set **Output Directory** to `.` (root)
4. Deploy. Vercel will use `vercel.json` to handle clean URL routing automatically.

To run the frontend locally without Vercel, any static file server works:

```bash
# Python
python -m http.server 8080

# Node
npx serve .
```

Then open `http://localhost:8080`.

---

## Environment Variables

All configuration lives in source files (no `.env` needed for the frontend). The only runtime secrets are the **Hugging Face Space Secrets** listed above.

| Variable | Location | Purpose |
|---|---|---|
| `ALLOWED_ORIGIN` | HF Space Secret | CORS allowed origin for the Flask API |
| `MODEL_PATH` | HF Space Secret | Path to the PyTorch checkpoint inside the container |
| Firebase config | `js/firebase-config.js` | Client-side Firebase project credentials |
| `FLASK_API_URL` | `results.html` | Backend URL called by the frontend |

---

## API Reference

### `POST /analyze`

Accepts `multipart/form-data`:

| Field | Type | Required | Description |
|---|---|---|---|
| `audio` | File (wav/mp3/webm) | No | Voice recording |
| `text` | String | No | Free-text input |
| `questionnaire` | JSON string | Yes | PHQ-style answers |
| `userInfo` | JSON string | Yes | `{name, age, gender}` |

Returns JSON with `riskLevel`, `modelProb`, `depressionType`, `recommendations`, `insights`, and `contributions`.

### `POST /generate-pdf`

Accepts a JSON payload matching the report schema. Returns a binary PDF stream (`application/pdf`).

### `GET /health`

Returns `{"status": "ok"}`. Used for liveness checks.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, Tailwind CSS, Vanilla JS, Firebase JS SDK v11 |
| Auth & Database | Firebase Authentication (Google OAuth), Cloud Firestore |
| Backend | Python, Flask, Flask-CORS, Gunicorn |
| AI Model | PyTorch, WavLM (audio), RoBERTa (text), custom fusion network |
| Audio Processing | librosa, soundfile |
| PDF Generation | WeasyPrint (primary), pdfkit/wkhtmltopdf (fallback) |
| Hosting — Frontend | Vercel |
| Hosting — Backend | Hugging Face Spaces (Docker) |

---

## Disclaimer

ManoDhwani is a research and screening tool. It is **not a medical device** and its output should not be used as a clinical diagnosis. If you or someone you know is experiencing mental health difficulties, please contact a qualified mental health professional.

**India crisis support:** Tele MANAS — `14416` or `1800-89-14416` (free, 24/7)
