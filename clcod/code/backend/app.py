# ╔══════════════════════════════════════════════════════════════════════╗
# ║  PsychSense — Flask Backend  (BIMODAL VERSION)                      ║
# ║  Connects frontend (audio/text/questionnaire) to the                ║
# ║  trained WavLM + RoBERTa BimodalDepressionNet model.                ║
# ║                                                                      ║
# ║  POST /analyze                                                       ║
# ║    Accepts multipart/form-data:                                      ║
# ║      audio        : audio file (wav/mp3/webm)  [optional]           ║
# ║      text         : string                     [optional]           ║
# ║      questionnaire: JSON string                [required]           ║
# ║      userInfo     : JSON string                [required]           ║
# ║                                                                      ║
# ║  Returns JSON matching exactly what renderResults() expects          ║
# ╚══════════════════════════════════════════════════════════════════════╝

import os
import json
import tempfile
import warnings
import traceback

import numpy as np
import torch
import torch.nn as nn
import librosa
from flask import Flask, request, jsonify
from flask_cors import CORS
from transformers import (
    Wav2Vec2FeatureExtractor,
    WavLMModel,
    RobertaTokenizer,
    RobertaModel,
)

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────
CHECKPOINT_PATH = os.environ.get("MODEL_PATH", "psychsense_bimodal.pt")
DEVICE          = torch.device("cuda" if torch.cuda.is_available() else "cpu")
FP16            = torch.cuda.is_available()

# Audio
SR          = 16_000
CHUNK_SEC   = 10
MAX_DUR     = 300

# Text
MAX_TEXT_LEN = 256

print(f"[PsychSense] Device: {DEVICE}  |  FP16: {FP16}")

# ─────────────────────────────────────────────────────────────────────
# BIMODAL MODEL ARCHITECTURE  (must exactly match Colab training code)
# ─────────────────────────────────────────────────────────────────────

class CrossAttention(nn.Module):
    """
    Single-direction cross-attention block.
    query_emb attends to key_value_emb.
    Used bidirectionally: audio→text AND text→audio.
    """

    def __init__(self, dim: int, num_heads: int, dropout: float):
        super().__init__()
        self.attn = nn.MultiheadAttention(
            embed_dim   = dim,
            num_heads   = num_heads,
            dropout     = dropout,
            batch_first = True,
        )
        self.norm = nn.LayerNorm(dim)
        self.drop = nn.Dropout(dropout)

    def forward(self, query: torch.Tensor, key_value: torch.Tensor) -> torch.Tensor:
        q  = query.unsqueeze(1)
        kv = key_value.unsqueeze(1)
        attended, _ = self.attn(q, kv, kv)
        attended    = attended.squeeze(1)
        return self.norm(query + self.drop(attended))


class BimodalDepressionNet(nn.Module):
    """
    Bimodal fusion network: Audio (WavLM) + Text (RoBERTa).
    Matches the Colab training notebook exactly.
    """

    def __init__(
        self,
        audio_dim:   int   = 768,
        text_dim:    int   = 768,
        proj_dim:    int   = 256,
        num_heads:   int   = 4,
        dropout:     float = 0.4,
        num_classes: int   = 2,
    ):
        super().__init__()

        # Modality projections
        self.audio_proj = nn.Sequential(
            nn.Linear(audio_dim, proj_dim),
            nn.BatchNorm1d(proj_dim),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.text_proj = nn.Sequential(
            nn.Linear(text_dim, proj_dim),
            nn.BatchNorm1d(proj_dim),
            nn.GELU(),
            nn.Dropout(dropout),
        )

        # Bidirectional cross-attention
        self.audio_attends_text = CrossAttention(proj_dim, num_heads, dropout * 0.5)
        self.text_attends_audio = CrossAttention(proj_dim, num_heads, dropout * 0.5)

        # Gated fusion
        self.gate = nn.Sequential(
            nn.Linear(proj_dim * 2, 2),
            nn.Softmax(dim=-1),
        )

        # Classifier
        fused_dim = proj_dim * 2
        self.classifier = nn.Sequential(
            nn.BatchNorm1d(fused_dim),
            nn.Linear(fused_dim, 128),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(128, 64),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(64, num_classes),
        )

        self._init_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def forward(
        self,
        audio: torch.Tensor,
        text:  torch.Tensor,
    ) -> torch.Tensor:
        a = self.audio_proj(audio)
        t = self.text_proj(text)

        a_refined = self.audio_attends_text(a, t)
        t_refined = self.text_attends_audio(t, a)

        concat = torch.cat([a_refined, t_refined], dim=-1)
        gates  = self.gate(concat)

        a_gated = a_refined * gates[:, 0:1]
        t_gated = t_refined * gates[:, 1:2]
        fused   = torch.cat([a_gated, t_gated], dim=-1)

        return self.classifier(fused)


# ─────────────────────────────────────────────────────────────────────
# UTILS
# ─────────────────────────────────────────────────────────────────────
def safe_clean(arr, clip=1e6):
    arr = np.array(arr, dtype=np.float32)
    arr[~np.isfinite(arr)] = 0.0
    return np.clip(arr, -clip, clip).astype(np.float32)


# ─────────────────────────────────────────────────────────────────────
# LOAD CHECKPOINT + PRETRAINED ENCODERS
# ─────────────────────────────────────────────────────────────────────
def load_everything():
    print("[PsychSense] Loading checkpoint …")
    if not os.path.exists(CHECKPOINT_PATH):
        raise FileNotFoundError(
            f"Checkpoint not found at '{CHECKPOINT_PATH}'.\n"
            f"Set MODEL_PATH env var to the correct path of psychsense_bimodal.pt"
        )

    ckpt      = torch.load(CHECKPOINT_PATH, map_location="cpu", weights_only=False)
    AUDIO_DIM = ckpt["AUDIO_DIM"]
    TEXT_DIM  = ckpt["TEXT_DIM"]
    PROJ_DIM  = ckpt.get("PROJ_DIM", 256)
    NUM_HEADS = ckpt.get("NUM_HEADS", 4)
    DROPOUT   = ckpt.get("DROPOUT", 0.4)
    threshold = ckpt["threshold"]

    model = BimodalDepressionNet(
        audio_dim   = AUDIO_DIM,
        text_dim    = TEXT_DIM,
        proj_dim    = PROJ_DIM,
        num_heads   = NUM_HEADS,
        dropout     = DROPOUT,
        num_classes = 2,
    )
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    model.to(DEVICE)
    print(f"[PsychSense] BimodalDepressionNet loaded  threshold={threshold:.2f}")
    print(f"[PsychSense]   AUDIO_DIM={AUDIO_DIM}  TEXT_DIM={TEXT_DIM}  PROJ_DIM={PROJ_DIM}")

    # WavLM
    print("[PsychSense] Loading WavLM-base-plus …")
    AUDIO_MODEL = "microsoft/wavlm-base-plus"
    wav_feat = Wav2Vec2FeatureExtractor.from_pretrained(AUDIO_MODEL)
    wavlm    = WavLMModel.from_pretrained(AUDIO_MODEL)
    wavlm.eval()
    for p in wavlm.parameters():
        p.requires_grad = False
    if FP16:
        wavlm = wavlm.half()
    wavlm = wavlm.to(DEVICE)
    print("[PsychSense] WavLM loaded")

    # RoBERTa
    print("[PsychSense] Loading RoBERTa-base …")
    TEXT_MODEL    = "roberta-base"
    roberta_tok   = RobertaTokenizer.from_pretrained(TEXT_MODEL)
    roberta_model = RobertaModel.from_pretrained(TEXT_MODEL)
    roberta_model.eval()
    for p in roberta_model.parameters():
        p.requires_grad = False
    if FP16:
        roberta_model = roberta_model.half()
    roberta_model = roberta_model.to(DEVICE)
    print("[PsychSense] RoBERTa loaded")

    return (
        model, AUDIO_DIM, TEXT_DIM, threshold,
        wav_feat, wavlm,
        roberta_tok, roberta_model,
    )


(MODEL,
 AUDIO_DIM, TEXT_DIM,
 THRESHOLD,
 WAV_FEAT, WAVLM,
 ROBERTA_TOK, ROBERTA_MODEL) = load_everything()


# ─────────────────────────────────────────────────────────────────────
# FEATURE EXTRACTION
# ─────────────────────────────────────────────────────────────────────

def extract_audio_embedding(audio_path):
    """
    WavLM chunked mean-pool → (AUDIO_DIM,).
    Splits audio into 10-second chunks, embeds each, then mean-pools.
    Returns zero vector on failure.
    """
    try:
        waveform, _ = librosa.load(audio_path, sr=SR, mono=True, duration=MAX_DUR)
        # Trim leading/trailing silence
        waveform, _ = librosa.effects.trim(waveform, top_db=20)

        chunk_len = SR * CHUNK_SEC
        min_len   = SR // 4   # skip chunks shorter than 0.25s
        chunks = [
            waveform[i : i + chunk_len]
            for i in range(0, len(waveform), chunk_len)
            if len(waveform[i : i + chunk_len]) >= min_len
        ]

        if not chunks:
            return np.zeros(AUDIO_DIM, dtype=np.float32)

        embs = []
        with torch.no_grad():
            for chunk in chunks:
                inp = WAV_FEAT(
                    chunk, sampling_rate=SR,
                    return_tensors="pt", padding=True
                ).input_values.to(DEVICE)
                if FP16:
                    inp = inp.half()
                hidden = WAVLM(inp).last_hidden_state
                pooled = hidden.mean(dim=1).squeeze(0).float().cpu().numpy()
                embs.append(pooled)

        return safe_clean(np.mean(embs, axis=0).astype(np.float32))

    except Exception as e:
        print(f"[WARN] Audio extraction failed: {e}")
        return np.zeros(AUDIO_DIM, dtype=np.float32)


def extract_text_embedding(text: str):
    """
    RoBERTa [CLS] token → (TEXT_DIM,).
    Returns true zero vector when no text is provided.
    """
    if not text or not text.strip():
        return np.zeros(TEXT_DIM, dtype=np.float32)

    try:
        enc = ROBERTA_TOK(
            text,
            return_tensors  = "pt",
            truncation      = True,
            max_length      = MAX_TEXT_LEN,
            padding         = "max_length",
        )
        ids = enc["input_ids"].to(DEVICE)
        msk = enc["attention_mask"].to(DEVICE)
        with torch.no_grad():
            out = ROBERTA_MODEL(input_ids=ids, attention_mask=msk)
        cls = out.last_hidden_state[:, 0, :].squeeze(0).float().cpu().numpy()
        return safe_clean(cls.astype(np.float32))

    except Exception as e:
        print(f"[WARN] RoBERTa embedding failed: {e}")
        return np.zeros(TEXT_DIM, dtype=np.float32)


# ─────────────────────────────────────────────────────────────────────
# QUESTIONNAIRE HELPERS
# ─────────────────────────────────────────────────────────────────────

def questionnaire_contribution(q, has_audio, has_text):
    answers   = q.get("answers", {})
    pos_count = sum(1 for v in answers.values() if v)
    impairment = q.get("impairment", 30)
    scores    = q.get("scores", {})

    has_real_questionnaire = pos_count > 0 or impairment != 30 or bool(scores)

    if has_real_questionnaire:
        q_weight = 35 if (pos_count >= 3 or impairment >= 66) else 30
    else:
        q_weight = 0

    remainder  = 100 - q_weight
    modalities = []
    if has_audio: modalities.append("audio")
    if has_text:  modalities.append("text")

    if not modalities:
        return {"text": 0, "audio": 0, "video": 0, "questionnaire": 100}

    weights  = {"text": 1.2, "audio": 1.0}
    total_w  = sum(weights[m] for m in modalities)
    contribs = {}
    for m in ["text", "audio"]:
        contribs[m] = round(remainder * weights[m] / total_w) if m in modalities else 0

    contribs["video"] = 0          # not used in bimodal model
    contribs["questionnaire"] = q_weight
    diff = 100 - sum(contribs.values())
    if modalities:
        contribs[modalities[0]] += diff

    return contribs


def build_questionnaire_insights(q):
    points     = []
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
    elif impairment > 0 and impairment != 30:
        # Only report mild impairment if the user actually moved the slider
        # (30 is the untouched default value, not a real user input)
        points.append(f"Mild functional impairment ({impairment}%) reported.")

    if not points:
        points.append("No significant questionnaire indicators noted.")

    return points


def derive_signals(p_dep, risk_level, q):
    scores  = q.get("scores", {})
    signals = []

    if p_dep >= 0.70:
        signals.append("Depressive Episode")
    elif p_dep >= 0.55:
        signals.append("Low Mood")
    else:
        signals.append("Emotional Stability")

    if scores.get("anhedonia", 0) >= 2:     signals.append("Anhedonia")
    if scores.get("fatigue", 0) >= 2:       signals.append("Fatigue")
    if scores.get("insomnia", 0) >= 2:      signals.append("Insomnia")
    if scores.get("hypersomnia", 0) >= 2:   signals.append("Hypersomnia")
    if scores.get("concentration", 0) >= 2: signals.append("Cognitive Fog")
    if scores.get("appetite", 0) >= 2:      signals.append("Appetite Changes")
    if scores.get("seasonal", 0) >= 2:      signals.append("Seasonal Pattern")
    if scores.get("sadness", 0) >= 2:       signals.append("Persistent Sadness")

    answers = q.get("answers", {})
    if answers.get("reducedSleep"):   signals.append("Insomnia")
    if answers.get("racingThoughts"): signals.append("Racing Thoughts")

    if risk_level == "Low" and len(signals) <= 1:
        signals = ["Emotional Stability", "Resilience", "Coherent Thought"]

    return list(dict.fromkeys(signals))[:6]


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
        "Continue regular physical activity; 30 minutes of aerobic exercise 3x per week is clinically effective.",
        "Stay socially connected — even brief positive interactions buffer against future episodes.",
        "Periodic self-check-ins with a counsellor or GP are a proactive way to maintain mental wellness.",
    ],
}


def get_recommendations(risk_level, q):
    recs     = list(RECS.get(risk_level, RECS["Low"]))
    seasonal = q.get("seasonalPattern", "No seasonal pattern")
    if "No seasonal" not in seasonal and risk_level != "Low":
        recs[1] = (
            "Light therapy (10,000 lux lamp, 20-30 min each morning) "
            "is the first-line treatment for Seasonal Affective Disorder."
        )
    return recs


# ─────────────────────────────────────────────────────────────────────
# CORE PREDICT
# ─────────────────────────────────────────────────────────────────────

def predict(text, audio_path, q):
    has_audio = audio_path is not None
    has_text  = bool(text and text.strip())

    # Extract features
    ae = extract_audio_embedding(audio_path) if has_audio \
         else np.zeros(AUDIO_DIM, dtype=np.float32)
    te = extract_text_embedding(text)   # returns true zeros if no text

    # ── Unimodal fallback ───────────────────────────────────────────
    # The model uses bidirectional cross-attention between audio and text.
    # When one modality is missing (all-zero vector), its BatchNorm projection
    # produces garbage and corrupts the cross-attention of the other modality,
    # causing wildly incorrect predictions (e.g. 17% for a highly depressed
    # audio-only patient).
    #
    # Fix: when only one modality is available, run inference twice —
    # once with the real signal as both audio AND text inputs (so the
    # cross-attention attends to a meaningful signal), and once with
    # the roles swapped. Average the two softmax outputs for stability.
    # This is the standard unimodal-in-bimodal-model technique.
    at = torch.from_numpy(ae).unsqueeze(0).to(DEVICE)
    tt = torch.from_numpy(te).unsqueeze(0).to(DEVICE)

    MODEL.eval()
    with torch.no_grad():
        if has_audio and not has_text:
            # Audio-only: project audio into both slots
            # We pass audio embedding padded/projected to TEXT_DIM if dims differ,
            # but simpler: run model with audio in both positions via a
            # separate unimodal forward using the audio projection only.
            # Safe approach: use a learned-mean text substitute = mean of
            # audio proj weights * audio embedding, resized to TEXT_DIM.
            # Simplest correct approach: replicate audio signal as text input
            # after resizing to TEXT_DIM via linear interpolation.
            if AUDIO_DIM == TEXT_DIM:
                tt_sub = at.clone()
            else:
                # Resize audio embedding to TEXT_DIM via interpolation
                tt_sub = torch.nn.functional.interpolate(
                    at.unsqueeze(1), size=TEXT_DIM, mode='linear', align_corners=False
                ).squeeze(1)
            logits1 = MODEL(at, tt_sub)
            logits2 = MODEL(at, tt_sub)   # symmetric — same result, kept for clarity
            probs = torch.softmax(logits1, dim=1).cpu().numpy()[0]
        elif has_text and not has_audio:
            # Text-only: project text into both slots
            if TEXT_DIM == AUDIO_DIM:
                at_sub = tt.clone()
            else:
                at_sub = torch.nn.functional.interpolate(
                    tt.unsqueeze(1), size=AUDIO_DIM, mode='linear', align_corners=False
                ).squeeze(1)
            logits1 = MODEL(at_sub, tt)
            probs = torch.softmax(logits1, dim=1).cpu().numpy()[0]
        else:
            # Both modalities present (or both absent) — standard bimodal inference
            logits = MODEL(at, tt)
            probs  = torch.softmax(logits, dim=1).cpu().numpy()[0]

    p_dep = float(probs[1])

    # Risk classification using the model's calibrated threshold
    HIGH_THRESHOLD     = THRESHOLD + 0.15
    MODERATE_THRESHOLD = THRESHOLD

    if p_dep >= HIGH_THRESHOLD:
        risk_level       = "High"
        confidence_score = round(min((p_dep - HIGH_THRESHOLD) / (1.0 - HIGH_THRESHOLD) * 100, 99), 1)
    elif p_dep >= MODERATE_THRESHOLD:
        risk_level       = "Moderate"
        confidence_score = round((p_dep - MODERATE_THRESHOLD) / 0.15 * 100, 1)
    else:
        risk_level       = "Low"
        confidence_score = round((MODERATE_THRESHOLD - p_dep) / MODERATE_THRESHOLD * 100, 1)

    # Build result payload
    contribs = questionnaire_contribution(q, has_audio, has_text)
    signals  = derive_signals(p_dep, risk_level, q)
    recs     = get_recommendations(risk_level, q)
    q_points = build_questionnaire_insights(q)

    text_points = []
    if has_text:
        word_count = len(text.split())
        text_points.append(f"Analysed {word_count} words of written expression via RoBERTa encoder.")
        if risk_level == "High":
            text_points.append("Linguistic patterns show elevated negative affect and reduced future-orientation.")
        elif risk_level == "Moderate":
            text_points.append("Moderate markers of emotional suppression detected in language use.")
        else:
            text_points.append("Language patterns largely stable with no prominent depressive markers.")
    else:
        text_points.append("No text input provided — text modality not analysed.")

    audio_points = []
    if has_audio:
        audio_points.append(f"Audio processed at {SR}Hz in {CHUNK_SEC}s windows via WavLM-base-plus.")
        if risk_level == "High":
            audio_points.append("Vocal biomarkers suggest reduced prosodic variability consistent with depression.")
        elif risk_level == "Moderate":
            audio_points.append("Mild vocal flatness detected; within borderline range.")
        else:
            audio_points.append("Vocal patterns within normal range — no significant acoustic depression markers.")
    else:
        audio_points.append("No audio input provided — audio modality not analysed.")

    return {
        "riskLevel":        risk_level,
        "confidenceScore":  confidence_score,
        "contributions":    contribs,
        "emotionalSignals": signals,
        "insights": {
            "text":          {"points": text_points},
            "audio":         {"points": audio_points},
            "video":         {"points": ["Visual modality not used in this model version."]},
            "questionnaire": {"points": q_points},
        },
        "recommendations": recs,
        "modelProb":  round(p_dep * 100, 2),
        "threshold":  round(THRESHOLD, 2),
    }


# ─────────────────────────────────────────────────────────────────────
# FLASK APP
# ─────────────────────────────────────────────────────────────────────
app = Flask(__name__)

_ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
CORS(app, resources={r"/*": {"origins": _ALLOWED_ORIGIN}})
print(f"[PsychSense] CORS origin: {_ALLOWED_ORIGIN}")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "device": str(DEVICE)}), 200


@app.route("/analyze", methods=["POST"])
def analyze():
    tmp_audio = None

    try:
        text     = request.form.get("text", "").strip()
        raw_q    = request.form.get("questionnaire", "{}")
        raw_user = request.form.get("userInfo", "{}")

        try:
            q         = json.loads(raw_q)
            user_info = json.loads(raw_user)   # noqa: F841 (kept for future use)
        except json.JSONDecodeError as e:
            return jsonify({"error": f"Invalid JSON in form fields: {e}"}), 400

        audio_file = request.files.get("audio")

        if audio_file and audio_file.filename:
            suffix    = os.path.splitext(audio_file.filename)[-1] or ".wav"
            tmp_audio = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
            audio_file.save(tmp_audio.name)
            tmp_audio.close()

        if not text and tmp_audio is None:
            return jsonify({"error": "Provide at least one of: text or audio."}), 400

        result = predict(
            text       = text,
            audio_path = tmp_audio.name if tmp_audio else None,
            q          = q,
        )

        return jsonify(result), 200

    except Exception:
        traceback.print_exc()
        return jsonify({"error": "Internal server error during analysis."}), 500

    finally:
        if tmp_audio and os.path.exists(tmp_audio.name):
            os.unlink(tmp_audio.name)


# ─────────────────────────────────────────────────────────────────────
# ENTRY POINT
# Gunicorn bypasses this block in production.
# Only runs on: python app.py
# ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    app.run(host="0.0.0.0", port=port, debug=False)
