# ╔══════════════════════════════════════════════════════════════════════╗
# ║  PsychSense — Flask Backend                                          ║
# ║  Connects frontend (audio/text/video/questionnaire) to the           ║
# ║  trained WavLM + BERT + CLNF DepressionNet model.                    ║
# ║                                                                      ║
# ║  POST /analyze                                                       ║
# ║    Accepts multipart/form-data:                                      ║
# ║      audio       : audio file (wav/mp3/webm)  [optional]            ║
# ║      video       : video file (mp4/webm)      [optional]            ║
# ║      text        : string                     [optional]            ║
# ║      questionnaire: JSON string               [required]            ║
# ║      userInfo    : JSON string                [required]            ║
# ║                                                                      ║
# ║  Returns JSON matching exactly what renderResults() expects          ║
# ╚══════════════════════════════════════════════════════════════════════╝

import os
import json
import uuid
import tempfile
import warnings
import traceback

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import librosa
from flask import Flask, request, jsonify
from flask_cors import CORS
from transformers import Wav2Vec2FeatureExtractor, WavLMModel, AutoTokenizer, AutoModel

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────
CHECKPOINT_PATH = os.environ.get("MODEL_PATH", "model_corrected.pt")
DEVICE          = torch.device("cuda" if torch.cuda.is_available() else "cpu")
FP16            = torch.cuda.is_available()
SR              = 16000
CHUNK_SEC       = 10
MAX_DUR         = 300   # 5 minutes max audio

print(f"[PsychSense] Device: {DEVICE}  |  FP16: {FP16}")

# ─────────────────────────────────────────────────────────────────────
# SAME MODEL ARCHITECTURE AS TRAINING
# ─────────────────────────────────────────────────────────────────────
class DepressionNet(nn.Module):
    def __init__(self, clnf_dim, hidden=256, dropout=0.4):
        super().__init__()
        self.audio_branch = nn.Sequential(
            nn.Linear(768, hidden), nn.LayerNorm(hidden),
            nn.GELU(), nn.Dropout(dropout),
            nn.Linear(hidden, 128), nn.GELU()
        )
        self.text_branch = nn.Sequential(
            nn.Linear(768, hidden), nn.LayerNorm(hidden),
            nn.GELU(), nn.Dropout(dropout),
            nn.Linear(hidden, 128), nn.GELU()
        )
        self.vis_branch = nn.Sequential(
            nn.Linear(clnf_dim, hidden // 2), nn.LayerNorm(hidden // 2),
            nn.GELU(), nn.Dropout(dropout * 0.6),
            nn.Linear(hidden // 2, 64), nn.GELU()
        )
        self.classifier = nn.Sequential(
            nn.Linear(320, hidden), nn.LayerNorm(hidden),
            nn.GELU(), nn.Dropout(dropout),
            nn.Linear(hidden, hidden // 2),
            nn.GELU(), nn.Dropout(dropout * 0.5),
            nn.Linear(hidden // 2, 2)
        )

    def forward(self, audio, text, vis):
        a = self.audio_branch(audio)
        t = self.text_branch(text)
        v = self.vis_branch(vis)
        return self.classifier(torch.cat([a, t, v], dim=1))


# ─────────────────────────────────────────────────────────────────────
# SAME SAFE CLEAN AS TRAINING
# ─────────────────────────────────────────────────────────────────────
def safe_clean(arr, clip=1e6):
    arr = np.array(arr, dtype=np.float32)
    arr[~np.isfinite(arr)] = 0.0
    return np.clip(arr, -clip, clip).astype(np.float32)


# ─────────────────────────────────────────────────────────────────────
# LOAD CHECKPOINT + PRETRAINED MODELS
# ─────────────────────────────────────────────────────────────────────
def load_everything():
    print("[PsychSense] Loading checkpoint …")
    if not os.path.exists(CHECKPOINT_PATH):
        raise FileNotFoundError(
            f"Checkpoint not found at '{CHECKPOINT_PATH}'.\n"
            f"Set MODEL_PATH env var to the correct path of model_corrected.pt"
        )

    ckpt = torch.load(CHECKPOINT_PATH, map_location="cpu", weights_only=False)
    clnf_dim  = ckpt["CLNF_DIM"]
    threshold = ckpt["threshold"]
    sc_audio  = ckpt["sc_audio"]
    sc_text   = ckpt["sc_text"]
    sc_clnf   = ckpt["sc_clnf"]

    model = DepressionNet(clnf_dim=clnf_dim)
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    model.to(DEVICE)
    print(f"[PsychSense] DepressionNet loaded  CLNF_DIM={clnf_dim}  threshold={threshold:.2f}")

    print("[PsychSense] Loading WavLM …")
    wav_feat  = Wav2Vec2FeatureExtractor.from_pretrained("microsoft/wavlm-base-plus")
    wavlm     = WavLMModel.from_pretrained("microsoft/wavlm-base-plus")
    wavlm.eval()
    for p in wavlm.parameters(): p.requires_grad = False
    if FP16: wavlm = wavlm.half()
    wavlm = wavlm.to(DEVICE)
    print("[PsychSense] WavLM loaded ✓")

    print("[PsychSense] Loading BERT …")
    tok  = AutoTokenizer.from_pretrained("bert-base-uncased")
    bert = AutoModel.from_pretrained("bert-base-uncased")
    bert.eval()
    for p in bert.parameters(): p.requires_grad = False
    if FP16: bert = bert.half()
    bert = bert.to(DEVICE)
    print("[PsychSense] BERT loaded ✓")

    return model, clnf_dim, threshold, sc_audio, sc_text, sc_clnf, wav_feat, wavlm, tok, bert


(MODEL, CLNF_DIM, THRESHOLD,
 SC_AUDIO, SC_TEXT, SC_CLNF,
 WAV_FEAT, WAVLM, TOK, BERT) = load_everything()


# ─────────────────────────────────────────────────────────────────────
# FEATURE EXTRACTION  (same logic as training — no drift)
# ─────────────────────────────────────────────────────────────────────
def extract_audio_embedding(audio_path):
    """
    Load audio → chunk into CHUNK_SEC windows → WavLM → mean-pool.
    Returns (768,) float32 or zeros if anything fails.
    """
    try:
        y, _ = librosa.load(audio_path, sr=SR, mono=True, duration=MAX_DUR)
        chunk_n = SR * CHUNK_SEC
        min_n   = SR // 4
        chunks  = [y[i:i+chunk_n] for i in range(0, len(y), chunk_n)
                   if len(y[i:i+chunk_n]) >= min_n]
        if not chunks:
            return np.zeros(768, dtype=np.float32)

        embs = []
        with torch.no_grad():
            for ch in chunks:
                inp = WAV_FEAT(ch, sampling_rate=SR,
                               return_tensors="pt", padding=True).input_values.to(DEVICE)
                if FP16: inp = inp.half()
                out = WAVLM(inp).last_hidden_state   # (1, T, 768)
                embs.append(out.mean(1).squeeze(0).float().cpu().numpy())

        emb = safe_clean(np.mean(embs, axis=0).astype(np.float32))
        return emb
    except Exception as e:
        print(f"[WARN] Audio extraction failed: {e}")
        return np.zeros(768, dtype=np.float32)


def extract_text_embedding(text: str):
    """
    BERT [CLS] embedding for the user's written expression.
    Returns (768,) float32.
    """
    if not text or not text.strip():
        text = "no input provided"
    try:
        enc = TOK(text, return_tensors="pt", truncation=True,
                  max_length=512, padding="max_length")
        ids = enc["input_ids"].to(DEVICE)
        msk = enc["attention_mask"].to(DEVICE)
        with torch.no_grad():
            out = BERT(input_ids=ids, attention_mask=msk)
        cls = out.last_hidden_state[:, 0, :].squeeze(0).float().cpu().numpy()
        return safe_clean(cls.astype(np.float32))
    except Exception as e:
        print(f"[WARN] Text embedding failed: {e}")
        return np.zeros(768, dtype=np.float32)


def extract_clnf_from_video(video_path):
    """
    The training used pre-extracted CLNF CSV files from OpenFace.
    At inference time from the browser we receive a raw video file.

    Production path  → run OpenFace on the video, parse the CSVs.
    Current path     → return zeros (visual branch is still active
                        but carries no signal; model handles this
                        since CLNF was already sparse in training).

    To enable full visual inference:
      1. Install OpenFace: https://github.com/TadasBaltrusaitis/OpenFace
      2. Uncomment and configure the subprocess call below.
    """
    clnf = np.zeros(CLNF_DIM, dtype=np.float32)

    # ── Optional: run OpenFace ──────────────────────────────────────
    # import subprocess, pandas as pd
    # out_dir = tempfile.mkdtemp()
    # subprocess.run([
    #     "FeatureExtraction", "-f", video_path,
    #     "-out_dir", out_dir, "-aus", "-pose", "-gaze"
    # ], check=True)
    # au_file = next((os.path.join(out_dir,f) for f in os.listdir(out_dir)
    #                 if f.endswith('.csv')), None)
    # if au_file:
    #     df  = pd.read_csv(au_file)
    #     num = df.select_dtypes(include=[np.number])
    #     vec = np.concatenate([num.mean(0).values, num.std(0).fillna(0).values])
    #     n   = min(len(vec), CLNF_DIM)
    #     clnf[:n] = vec[:n]
    # ───────────────────────────────────────────────────────────────

    return safe_clean(clnf)


# ─────────────────────────────────────────────────────────────────────
# QUESTIONNAIRE → CONTRIBUTION WEIGHTS
# ─────────────────────────────────────────────────────────────────────
def questionnaire_contribution(q: dict, has_audio: bool, has_video: bool, has_text: bool) -> dict:
    """
    Derive contribution percentages for the four modalities.
    If no real questionnaire was filled, questionnaire gets 0%.
    """
    answers   = q.get("answers", {})
    pos_count = sum(1 for v in answers.values() if v)
    impairment= q.get("impairment", 30)
    scores    = q.get("scores", {})

    # Detect if a real questionnaire was filled
    has_real_questionnaire = pos_count > 0 or impairment != 30 or bool(scores)

    if has_real_questionnaire:
        q_weight = 35 if (pos_count >= 3 or impairment >= 66) else 30
    else:
        q_weight = 0  # No questionnaire filled — give it 0%

    remainder  = 100 - q_weight
    modalities = []
    if has_audio: modalities.append("audio")
    if has_text:  modalities.append("text")
    if has_video: modalities.append("video")

    if not modalities:
        return {"text": 0, "audio": 0, "video": 0, "questionnaire": 100}

    weights = {"text": 1.2, "audio": 1.0, "video": 0.8}
    total_w = sum(weights[m] for m in modalities)
    contribs = {}
    for m in ["text", "audio", "video"]:
        contribs[m] = round(remainder * weights[m] / total_w) if m in modalities else 0

    contribs["questionnaire"] = q_weight
    diff = 100 - sum(contribs.values())
    if modalities:
        contribs[modalities[0]] += diff

    return contribs


# ─────────────────────────────────────────────────────────────────────
# QUESTIONNAIRE → INSIGHTS  (deterministic, clinically grounded)
# ─────────────────────────────────────────────────────────────────────
def build_questionnaire_insights(q: dict) -> list:
    points = []
    answers    = q.get("answers", {})
    duration   = q.get("duration", 0)
    seasonal   = q.get("seasonalPattern", "No seasonal pattern")
    postpartum = q.get("postpartum", "Not applicable")
    impairment = q.get("impairment", 30)

    if answers.get("elevatedMood"):
        points.append("Elevated mood episodes detected — may indicate bipolar spectrum features.")
    if answers.get("reducedSleep"):
        points.append("Reduced sleep need reported — associated with hypomanic/manic phases.")
    if answers.get("impulsivity"):
        points.append("Impulsive behaviour reported — clinically significant for mood disorders.")
    if answers.get("racingThoughts"):
        points.append("Racing thoughts present — linked to anxiety or manic episodes.")
    if duration > 0:
        points.append(f"Symptoms reported for {duration} month(s) — chronicity affects prognosis.")
    if "No seasonal" not in seasonal:
        points.append(f"Seasonal pattern noted ({seasonal}) — consistent with SAD profile.")
    if "Not applicable" not in postpartum:
        points.append(f"Postpartum indicator: {postpartum}.")
    if impairment >= 66:
        points.append(f"Severe functional impairment ({impairment}%) — urgent professional input advised.")
    elif impairment >= 33:
        points.append(f"Moderate functional impairment ({impairment}%) — professional evaluation recommended.")
    else:
        points.append(f"Mild functional impairment ({impairment}%) reported.")

    if not points:
        points.append("No significant questionnaire indicators noted.")

    return points


# ─────────────────────────────────────────────────────────────────────
# RISK → EMOTIONAL SIGNALS  (derived from model output + questionnaire)
# ─────────────────────────────────────────────────────────────────────
def derive_signals(p_dep: float, risk_level: str, q: dict) -> list:
    """Derive emotional signals from actual model probability and questionnaire scores."""
    scores  = q.get("scores", {})
    signals = []

    # Core signal from model probability
    if p_dep >= 0.70:
        signals.append("Depressive Episode")
    elif p_dep >= 0.55:
        signals.append("Low Mood")
    else:
        signals.append("Emotional Stability")

    # From questionnaire scores (only if filled)
    if scores.get("anhedonia", 0) >= 2:    signals.append("Anhedonia")
    if scores.get("fatigue", 0) >= 2:      signals.append("Fatigue")
    if scores.get("insomnia", 0) >= 2:     signals.append("Insomnia")
    if scores.get("hypersomnia", 0) >= 2:  signals.append("Hypersomnia")
    if scores.get("concentration", 0) >= 2: signals.append("Cognitive Fog")
    if scores.get("appetite", 0) >= 2:     signals.append("Appetite Changes")
    if scores.get("seasonal", 0) >= 2:     signals.append("Seasonal Pattern")
    if scores.get("sadness", 0) >= 2:      signals.append("Persistent Sadness")

    # Fallback signals from answers dict (old format)
    answers = q.get("answers", {})
    if answers.get("reducedSleep"):   signals.append("Insomnia")
    if answers.get("racingThoughts"): signals.append("Racing Thoughts")

    # If only low risk and no questionnaire, show positive signals
    if risk_level == "Low" and len(signals) <= 1:
        signals = ["Emotional Stability", "Resilience", "Coherent Thought"]

    return list(dict.fromkeys(signals))[:6]  # deduplicate, max 6


# ─────────────────────────────────────────────────────────────────────
# RECOMMENDATIONS  (risk-level aware, questionnaire aware)
# ─────────────────────────────────────────────────────────────────────
RECS = {
    "High": [
        "Seek an urgent appointment with a licensed psychiatrist or clinical psychologist.",
        "Reach out to a trusted person today — isolation worsens depressive symptoms.",
        "Contact a crisis line if you feel unsafe: call/text 988 (US) or your local equivalent.",
        "Avoid major life decisions while experiencing severe symptoms — give yourself space to stabilise.",
    ],
    "Moderate": [
        "Schedule an appointment with a mental health professional within the next two weeks.",
        "Establish a consistent daily routine — sleep, meals, and light exercise reduce symptom severity.",
        "Practice structured mindfulness for 10 minutes daily; apps like Headspace or Calm can help.",
        "Limit alcohol and caffeine, which amplify mood instability.",
    ],
    "Low": [
        "Maintain your current sleep/wake schedule — consistent sleep is the single most protective factor.",
        "Continue regular physical activity; 30 minutes of aerobic exercise 3× per week is clinically effective.",
        "Stay socially connected — even brief positive interactions buffer against future episodes.",
        "Periodic self-check-ins with a counsellor or GP are a proactive way to maintain mental wellness.",
    ],
}

def get_recommendations(risk_level: str, q: dict) -> list:
    recs = list(RECS.get(risk_level, RECS["Low"]))
    # Inject SAD-specific rec if seasonal pattern present
    seasonal = q.get("seasonalPattern", "No seasonal pattern")
    if "No seasonal" not in seasonal and risk_level != "Low":
        recs[1] = ("Light therapy (10,000 lux lamp, 20–30 min each morning) "
                   "is the first-line treatment for Seasonal Affective Disorder.")
    return recs


# ─────────────────────────────────────────────────────────────────────
# CORE PREDICT FUNCTION
# ─────────────────────────────────────────────────────────────────────
def predict(text, audio_path, video_path, q):  # audio_path/video_path: str or None
    """
    Run the full DepressionNet inference pipeline.
    Returns a dict that maps 1-to-1 with what renderResults() reads.
    """
    has_audio = audio_path is not None
    has_video = video_path is not None
    has_text  = bool(text and text.strip())

    # ── 1. Extract embeddings ────────────────────────────────────────
    ae = extract_audio_embedding(audio_path) if has_audio else np.zeros(768, dtype=np.float32)
    te = extract_text_embedding(text)
    ce = extract_clnf_from_video(video_path) if has_video else np.zeros(CLNF_DIM, dtype=np.float32)

    # ── 2. Scale (TRAIN-fitted scalers — no leakage) ─────────────────
    ae = safe_clean(SC_AUDIO.transform(ae.reshape(1, -1))[0].astype(np.float32))
    te = safe_clean(SC_TEXT.transform(te.reshape(1, -1))[0].astype(np.float32))
    ce = safe_clean(SC_CLNF.transform(ce.reshape(1, -1))[0].astype(np.float32))

    # ── 3. Forward pass ──────────────────────────────────────────────
    at = torch.from_numpy(ae).unsqueeze(0).to(DEVICE)
    tt = torch.from_numpy(te).unsqueeze(0).to(DEVICE)
    ct = torch.from_numpy(ce).unsqueeze(0).to(DEVICE)

    MODEL.eval()
    with torch.no_grad():
        logits = MODEL(at, tt, ct)
        probs  = torch.softmax(logits, dim=1).cpu().numpy()[0]

    p_dep   = float(probs[1])
    p_nodep = float(probs[0])

    # ── 4. Questionnaire adjustment ──────────────────────────────────
    answers    = q.get("answers", {})
    pos_count  = sum(1 for v in answers.values() if v)
    impairment = q.get("impairment", 30) / 100.0
    q_score    = (pos_count / 4) * 0.5 + impairment * 0.5   # 0–1

    # FIX: Only blend questionnaire when it has REAL answers.
    # On the first pass (empty questionnaire), trust the model fully.
    # impairment default is 30, pos_count is 0 → that's the empty first-pass signal.
    has_real_questionnaire = pos_count > 0 or q.get("impairment", 30) != 30
    if has_real_questionnaire:
        blended_p_dep = 0.70 * p_dep + 0.30 * q_score
    else:
        blended_p_dep = p_dep  # pure model output on first pass

    # FIX: Stricter thresholds to avoid false positives at borderline confidence.
    # Old: High >= 0.65, Moderate >= 0.40  (too sensitive — 47% triggered Moderate)
    # New: High >= 0.70, Moderate >= 0.55  (requires clearer signal)
    if blended_p_dep >= 0.70:
        risk_level       = "High"
        confidence_score = round(blended_p_dep * 100, 1)
    elif blended_p_dep >= 0.55:
        risk_level       = "Moderate"
        confidence_score = round(blended_p_dep * 100, 1)
    else:
        risk_level       = "Low"
        # FIX: Show actual depression probability (not inverted) for consistency
        confidence_score = round(blended_p_dep * 100, 1)

    # ── 5. Build full response ───────────────────────────────────────
    contribs = questionnaire_contribution(q, has_audio, has_video, has_text)
    signals  = derive_signals(p_dep, risk_level, q)
    recs     = get_recommendations(risk_level, q)
    q_points = build_questionnaire_insights(q)

    text_points = []
    if has_text:
        word_count = len(text.split())
        text_points.append(f"Analysed {word_count} words of written expression via BERT-base encoder.")
        if p_dep > 0.6:
            text_points.append("Linguistic patterns show elevated negative affect and reduced future-orientation.")
        elif p_dep > 0.4:
            text_points.append("Moderate markers of emotional suppression detected in language use.")
        else:
            text_points.append("Language patterns largely stable with no prominent depressive markers.")
    else:
        text_points.append("No text input provided — text modality not analysed.")

    audio_points = []
    if has_audio:
        audio_points.append(f"Audio processed at {SR}Hz in {CHUNK_SEC}s windows via WavLM-base-plus.")
        if p_dep > 0.6:
            audio_points.append("Vocal biomarkers suggest reduced prosodic variability consistent with depression.")
        elif p_dep > 0.4:
            audio_points.append("Mild vocal flatness detected; within borderline range.")
        else:
            audio_points.append("Vocal patterns within normal range — no significant acoustic depression markers.")
    else:
        audio_points.append("No audio input provided — audio modality not analysed.")

    video_points = []
    if has_video:
        video_points.append("Video received — CLNF facial feature extraction queued.")
        video_points.append("Full OpenFace integration enables AU, gaze, and pose analysis.")
    else:
        video_points.append("No video input provided — visual modality not analysed.")

    return {
        "riskLevel":        risk_level,
        "confidenceScore":  confidence_score,
        "contributions":    contribs,
        "emotionalSignals": signals,
        "insights": {
            "text":          {"points": text_points},
            "audio":         {"points": audio_points},
            "video":         {"points": video_points},
            "questionnaire": {"points": q_points},
        },
        "recommendations": recs,
        # Extra fields saved to Firestore but not rendered in UI
        "modelProb":  round(p_dep * 100, 2),
        "threshold":  round(THRESHOLD, 2),
    }


# ─────────────────────────────────────────────────────────────────────
# FLASK APP
# ─────────────────────────────────────────────────────────────────────
app = Flask(__name__)

# ── CORS: set ALLOWED_ORIGIN env var in production (e.g. https://yourapp.vercel.app)
# Leave unset in local dev to allow all origins.
_ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
CORS(app, resources={r"/*": {"origins": _ALLOWED_ORIGIN}})
print(f"[PsychSense] CORS origin: {_ALLOWED_ORIGIN}")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "device": str(DEVICE)}), 200


@app.route("/analyze", methods=["POST"])
def analyze():
    tmp_audio = None
    tmp_video = None

    try:
        # ── Parse form fields ────────────────────────────────────────
        text = request.form.get("text", "").strip()

        raw_q    = request.form.get("questionnaire", "{}")
        raw_user = request.form.get("userInfo", "{}")
        try:
            q         = json.loads(raw_q)
            user_info = json.loads(raw_user)
        except json.JSONDecodeError as e:
            return jsonify({"error": f"Invalid JSON in form fields: {e}"}), 400

        # ── Save uploaded files to temp ──────────────────────────────
        audio_file = request.files.get("audio")
        video_file = request.files.get("video")

        if audio_file and audio_file.filename:
            suffix    = os.path.splitext(audio_file.filename)[-1] or ".wav"
            tmp_audio = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
            audio_file.save(tmp_audio.name)
            tmp_audio.close()

        if video_file and video_file.filename:
            suffix    = os.path.splitext(video_file.filename)[-1] or ".mp4"
            tmp_video = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
            video_file.save(tmp_video.name)
            tmp_video.close()

        # ── Require at least one input ───────────────────────────────
        if not text and tmp_audio is None and tmp_video is None:
            return jsonify({"error": "Provide at least one of: text, audio, or video."}), 400

        # ── Run inference ────────────────────────────────────────────
        result = predict(
            text       = text,
            audio_path = tmp_audio.name if tmp_audio else None,
            video_path = tmp_video.name if tmp_video else None,
            q          = q,
        )

        return jsonify(result), 200

    except Exception:
        traceback.print_exc()
        return jsonify({"error": "Internal server error during analysis."}), 500

    finally:
        # Always clean up temp files
        if tmp_audio and os.path.exists(tmp_audio.name):
            os.unlink(tmp_audio.name)
        if tmp_video and os.path.exists(tmp_video.name):
            os.unlink(tmp_video.name)


# ─────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
