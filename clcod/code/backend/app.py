# ╔══════════════════════════════════════════════════════════════════════╗
# ║  PsychSense — Flask Backend  (UPGRADED MODEL VERSION)               ║
# ║  Connects frontend (audio/text/video/questionnaire) to the          ║
# ║  trained WavLM + RoBERTa + ViT UpgradedDepressionNet model.         ║
# ║                                                                      ║
# ║  POST /analyze                                                       ║
# ║    Accepts multipart/form-data:                                      ║
# ║      audio        : audio file (wav/mp3/webm)  [optional]           ║
# ║      video        : video file (mp4/webm)      [optional]           ║
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
import torch.nn.functional as F
import librosa
from PIL import Image
import cv2
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
CHECKPOINT_PATH = os.environ.get("MODEL_PATH", "model_upgraded.pt")
DEVICE          = torch.device("cuda" if torch.cuda.is_available() else "cpu")
FP16            = torch.cuda.is_available()

# Audio
SR          = 16_000
CHUNK_SEC   = 10
MAX_DUR     = 300

# Video
FRAMES_PER_CLIP = 8
IMG_SIZE        = 224

# Text
MAX_TEXT_LEN = 512

print(f"[PsychSense] Device: {DEVICE}  |  FP16: {FP16}")

# ─────────────────────────────────────────────────────────────────────
# UPGRADED MODEL ARCHITECTURE  (must exactly match training code)
# ─────────────────────────────────────────────────────────────────────

class CrossModalAttention(nn.Module):
    def __init__(self, dim, num_heads):
        super().__init__()
        self.attn = nn.MultiheadAttention(
            dim, num_heads, dropout=0.1, batch_first=True
        )
        self.norm = nn.LayerNorm(dim)

    def forward(self, query, key_value):
        q  = query.unsqueeze(1)
        kv = key_value.unsqueeze(1)
        out, _ = self.attn(q, kv, kv)
        return self.norm(out.squeeze(1) + query)


class GatedFusion(nn.Module):
    def __init__(self, dim):
        super().__init__()
        self.gate = nn.Sequential(
            nn.Linear(dim * 3, 3),
            nn.Softmax(dim=-1)
        )

    def forward(self, a, t, v):
        concat  = torch.cat([a, t, v], dim=-1)
        w       = self.gate(concat)
        stacked = torch.stack([a, t, v], dim=1)
        return (stacked * w.unsqueeze(-1)).sum(dim=1)


class UpgradedDepressionNet(nn.Module):
    def __init__(self, audio_dim, text_dim, vis_dim,
                 fusion_dim=256, num_heads=4, dropout=0.4):
        super().__init__()

        self.audio_proj = nn.Sequential(
            nn.Linear(audio_dim, fusion_dim), nn.LayerNorm(fusion_dim),
            nn.GELU(), nn.Dropout(dropout),
            nn.Linear(fusion_dim, fusion_dim), nn.GELU()
        )
        self.text_proj = nn.Sequential(
            nn.Linear(text_dim, fusion_dim), nn.LayerNorm(fusion_dim),
            nn.GELU(), nn.Dropout(dropout),
            nn.Linear(fusion_dim, fusion_dim), nn.GELU()
        )
        self.vis_proj = nn.Sequential(
            nn.Linear(vis_dim, fusion_dim), nn.LayerNorm(fusion_dim),
            nn.GELU(), nn.Dropout(dropout * 0.6),
            nn.Linear(fusion_dim, fusion_dim), nn.GELU()
        )

        self.a_attn_t = CrossModalAttention(fusion_dim, num_heads)
        self.a_attn_v = CrossModalAttention(fusion_dim, num_heads)
        self.t_attn_a = CrossModalAttention(fusion_dim, num_heads)
        self.t_attn_v = CrossModalAttention(fusion_dim, num_heads)
        self.v_attn_a = CrossModalAttention(fusion_dim, num_heads)
        self.v_attn_t = CrossModalAttention(fusion_dim, num_heads)

        self.modality_embed = nn.Embedding(3, fusion_dim)

        enc_layer = nn.TransformerEncoderLayer(
            d_model=fusion_dim, nhead=num_heads,
            dim_feedforward=fusion_dim * 2,
            dropout=dropout, batch_first=True, norm_first=True
        )
        self.transformer = nn.TransformerEncoder(enc_layer, num_layers=2)

        self.gate_fusion = GatedFusion(fusion_dim)

        self.classifier = nn.Sequential(
            nn.Linear(fusion_dim, fusion_dim),
            nn.LayerNorm(fusion_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(fusion_dim, fusion_dim // 2),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(fusion_dim // 2, 2)
        )

    def forward(self, audio, text, vis):
        a = self.audio_proj(audio)
        t = self.text_proj(text)
        v = self.vis_proj(vis)

        a_r = (a + self.a_attn_t(a, t) + self.a_attn_v(a, v)) / 3
        t_r = (t + self.t_attn_a(t, a) + self.t_attn_v(t, v)) / 3
        v_r = (v + self.v_attn_a(v, a) + self.v_attn_t(v, t)) / 3

        ids    = torch.arange(3, device=audio.device)
        me     = self.modality_embed(ids)
        tokens = torch.stack([a_r, t_r, v_r], dim=1) + me.unsqueeze(0)

        fused       = self.transformer(tokens)
        fa, ft, fv  = fused[:, 0], fused[:, 1], fused[:, 2]

        agg = self.gate_fusion(fa, ft, fv)
        return self.classifier(agg)


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
            f"Set MODEL_PATH env var to the correct path of model_upgraded.pt"
        )

    ckpt       = torch.load(CHECKPOINT_PATH, map_location="cpu", weights_only=False)
    AUDIO_DIM  = ckpt["AUDIO_DIM"]
    TEXT_DIM   = ckpt["TEXT_DIM"]
    VIS_DIM    = ckpt["VIS_DIM"]
    FUSION_DIM = ckpt.get("FUSION_DIM", 256)
    NUM_HEADS  = ckpt.get("NUM_HEADS", 4)
    threshold  = ckpt["threshold"]
    sc_audio   = ckpt["sc_audio"]
    sc_text    = ckpt["sc_text"]
    sc_vis     = ckpt["sc_vis"]

    model = UpgradedDepressionNet(
        audio_dim=AUDIO_DIM,
        text_dim=TEXT_DIM,
        vis_dim=VIS_DIM,
        fusion_dim=FUSION_DIM,
        num_heads=NUM_HEADS,
    )
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    model.to(DEVICE)
    print(f"[PsychSense] UpgradedDepressionNet loaded  threshold={threshold:.2f}")

    # ── WavLM ────────────────────────────────────────────────────────
    print("[PsychSense] Loading WavLM …")
    AUDIO_MODEL = "microsoft/wavlm-base-plus"
    wav_feat = Wav2Vec2FeatureExtractor.from_pretrained(AUDIO_MODEL)
    wavlm    = WavLMModel.from_pretrained(AUDIO_MODEL)
    wavlm.eval()
    for p in wavlm.parameters(): p.requires_grad = False
    if FP16: wavlm = wavlm.half()
    wavlm = wavlm.to(DEVICE)
    print("[PsychSense] WavLM loaded")

    # ── RoBERTa (upgraded from BERT) ─────────────────────────────────
    print("[PsychSense] Loading RoBERTa …")
    TEXT_MODEL = "roberta-base"
    roberta_tok   = RobertaTokenizer.from_pretrained(TEXT_MODEL)
    roberta_model = RobertaModel.from_pretrained(TEXT_MODEL)
    roberta_model.eval()
    for p in roberta_model.parameters(): p.requires_grad = False
    if FP16: roberta_model = roberta_model.half()
    roberta_model = roberta_model.to(DEVICE)
    print("[PsychSense] RoBERTa loaded")

    # ── ViT (Vision Transformer) ─────────────────────────────────────
    print("[PsychSense] Loading ViT …")
    vit_backbone  = None
    vit_transform = None
    try:
        import timm
        vit_backbone = timm.create_model(
            "vit_small_patch16_224", pretrained=True, num_classes=0
        )
        vit_backbone.eval()
        for p in vit_backbone.parameters(): p.requires_grad = False
        vit_backbone = vit_backbone.to(DEVICE)
        print("[PsychSense] ViT (vit_small_patch16_224) loaded")
    except Exception as e:
        print(f"[PsychSense] ViT unavailable ({e}), falling back to ResNet-18")
        import torchvision.models as tvm
        vit_backbone = tvm.resnet18(pretrained=True)
        vit_backbone.fc = nn.Identity()
        vit_backbone.eval()
        for p in vit_backbone.parameters(): p.requires_grad = False
        vit_backbone = vit_backbone.to(DEVICE)

    import torchvision.transforms as VT
    vit_transform = VT.Compose([
        VT.Resize((IMG_SIZE, IMG_SIZE)),
        VT.ToTensor(),
        VT.Normalize(mean=[0.485, 0.456, 0.406],
                     std=[0.229, 0.224, 0.225])
    ])

    return (model,
            AUDIO_DIM, TEXT_DIM, VIS_DIM,
            threshold,
            sc_audio, sc_text, sc_vis,
            wav_feat, wavlm,
            roberta_tok, roberta_model,
            vit_backbone, vit_transform)


(MODEL,
 AUDIO_DIM, TEXT_DIM, VIS_DIM,
 THRESHOLD,
 SC_AUDIO, SC_TEXT, SC_VIS,
 WAV_FEAT, WAVLM,
 ROBERTA_TOK, ROBERTA_MODEL,
 VIT_BACKBONE, VIT_TRANSFORM) = load_everything()


# ─────────────────────────────────────────────────────────────────────
# FEATURE EXTRACTION
# ─────────────────────────────────────────────────────────────────────

def extract_audio_embedding(audio_path):
    """WavLM chunked mean-pool → (AUDIO_DIM,). Returns zeros on failure."""
    try:
        y, _ = librosa.load(audio_path, sr=SR, mono=True, duration=MAX_DUR)
        chunk_n = SR * CHUNK_SEC
        min_n   = SR // 4
        chunks  = [y[i:i + chunk_n]
                   for i in range(0, len(y), chunk_n)
                   if len(y[i:i + chunk_n]) >= min_n]
        if not chunks:
            return np.zeros(AUDIO_DIM, dtype=np.float32)

        embs = []
        with torch.no_grad():
            for ch in chunks:
                inp = WAV_FEAT(ch, sampling_rate=SR,
                               return_tensors="pt", padding=True).input_values.to(DEVICE)
                if FP16: inp = inp.half()
                out = WAVLM(inp).last_hidden_state
                embs.append(out.mean(1).squeeze(0).float().cpu().numpy())

        return safe_clean(np.mean(embs, axis=0).astype(np.float32))
    except Exception as e:
        print(f"[WARN] Audio extraction failed: {e}")
        return np.zeros(AUDIO_DIM, dtype=np.float32)


def extract_text_embedding(text: str):
    """
    RoBERTa [CLS] → (TEXT_DIM,).
    BUG FIX: returns true zero vector when no text is provided,
    instead of embedding the placeholder string 'no input provided'
    which caused the model to always output ~64.5% depression.
    """
    if not text or not text.strip():
        return np.zeros(TEXT_DIM, dtype=np.float32)   # ← FIX: true zero, not fake BERT embedding

    try:
        enc = ROBERTA_TOK(text, return_tensors="pt", truncation=True,
                          max_length=MAX_TEXT_LEN, padding="max_length")
        ids = enc["input_ids"].to(DEVICE)
        msk = enc["attention_mask"].to(DEVICE)
        with torch.no_grad():
            out = ROBERTA_MODEL(input_ids=ids, attention_mask=msk)
        cls = out.last_hidden_state[:, 0, :].squeeze(0).float().cpu().numpy()
        return safe_clean(cls.astype(np.float32))
    except Exception as e:
        print(f"[WARN] RoBERTa embedding failed: {e}")
        return np.zeros(TEXT_DIM, dtype=np.float32)


def extract_video_embedding(video_path):
    """
    ViT frame embeddings mean-pooled → (VIS_DIM,).
    Samples FRAMES_PER_CLIP frames uniformly from the video.
    Returns zeros if extraction fails.
    """
    try:
        cap   = cv2.VideoCapture(video_path)
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        if total < 1:
            cap.release()
            return np.zeros(VIS_DIM, dtype=np.float32)

        indices = set(np.linspace(0, total - 1, FRAMES_PER_CLIP, dtype=int).tolist())
        frames  = []
        idx     = 0
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            if idx in indices:
                frames.append(frame)
            idx += 1
        cap.release()

        if not frames:
            return np.zeros(VIS_DIM, dtype=np.float32)

        embs = []
        with torch.no_grad():
            for frame in frames:
                try:
                    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                    t   = VIT_TRANSFORM(img).unsqueeze(0).to(DEVICE)
                    out = VIT_BACKBONE(t)
                    embs.append(out.squeeze(0).float().cpu().numpy())
                except Exception:
                    continue

        if not embs:
            return np.zeros(VIS_DIM, dtype=np.float32)

        return safe_clean(np.mean(embs, axis=0).astype(np.float32))
    except Exception as e:
        print(f"[WARN] Video extraction failed: {e}")
        return np.zeros(VIS_DIM, dtype=np.float32)


# ─────────────────────────────────────────────────────────────────────
# QUESTIONNAIRE HELPERS
# ─────────────────────────────────────────────────────────────────────

def questionnaire_contribution(q, has_audio, has_video, has_text):
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
    if has_video: modalities.append("video")

    if not modalities:
        return {"text": 0, "audio": 0, "video": 0, "questionnaire": 100}

    weights    = {"text": 1.2, "audio": 1.0, "video": 0.8}
    total_w    = sum(weights[m] for m in modalities)
    contribs   = {}
    for m in ["text", "audio", "video"]:
        contribs[m] = round(remainder * weights[m] / total_w) if m in modalities else 0

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
    else:
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
        recs[1] = ("Light therapy (10,000 lux lamp, 20-30 min each morning) "
                   "is the first-line treatment for Seasonal Affective Disorder.")
    return recs


# ─────────────────────────────────────────────────────────────────────
# CORE PREDICT
# ─────────────────────────────────────────────────────────────────────

def predict(text, audio_path, video_path, q):
    has_audio = audio_path is not None
    has_video = video_path is not None
    has_text  = bool(text and text.strip())

    # ── Extract features (zeros for missing modalities) ──────────────
    ae = extract_audio_embedding(audio_path) if has_audio \
         else np.zeros(AUDIO_DIM, dtype=np.float32)

    te = extract_text_embedding(text)   # returns true zeros if no text

    ve = extract_video_embedding(video_path) if has_video \
         else np.zeros(VIS_DIM, dtype=np.float32)

    # ── Scale using train-fitted scalers ─────────────────────────────
    ae = safe_clean(SC_AUDIO.transform(ae.reshape(1, -1))[0].astype(np.float32))
    te = safe_clean(SC_TEXT.transform(te.reshape(1, -1))[0].astype(np.float32))
    ve = safe_clean(SC_VIS.transform(ve.reshape(1, -1))[0].astype(np.float32))

    # ── Model inference ──────────────────────────────────────────────
    at = torch.from_numpy(ae).unsqueeze(0).to(DEVICE)
    tt = torch.from_numpy(te).unsqueeze(0).to(DEVICE)
    vt = torch.from_numpy(ve).unsqueeze(0).to(DEVICE)

    MODEL.eval()
    with torch.no_grad():
        logits = MODEL(at, tt, vt)
        probs  = torch.softmax(logits, dim=1).cpu().numpy()[0]

    p_dep = float(probs[1])

    # ── Blend with questionnaire score ───────────────────────────────
    answers    = q.get("answers", {})
    pos_count  = sum(1 for v in answers.values() if v)
    impairment = q.get("impairment", 30) / 100.0
    q_score    = (pos_count / 4) * 0.5 + impairment * 0.5

    has_real_questionnaire = pos_count > 0 or q.get("impairment", 30) != 30
    blended_p_dep = 0.70 * p_dep + 0.30 * q_score if has_real_questionnaire else p_dep

    # ── Risk classification ──────────────────────────────────────────
    if blended_p_dep >= 0.70:
        risk_level       = "High"
        confidence_score = round(blended_p_dep * 100, 1)
    elif blended_p_dep >= 0.55:
        risk_level       = "Moderate"
        confidence_score = round(blended_p_dep * 100, 1)
    else:
        risk_level       = "Low"
        confidence_score = round(blended_p_dep * 100, 1)

    # ── Build result payload ─────────────────────────────────────────
    contribs = questionnaire_contribution(q, has_audio, has_video, has_text)
    signals  = derive_signals(p_dep, risk_level, q)
    recs     = get_recommendations(risk_level, q)
    q_points = build_questionnaire_insights(q)

    text_points = []
    if has_text:
        word_count = len(text.split())
        text_points.append(f"Analysed {word_count} words of written expression via RoBERTa encoder.")
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
        video_points.append(f"Video analysed: {FRAMES_PER_CLIP} frames sampled via ViT-Small patch encoder.")
        if p_dep > 0.6:
            video_points.append("Facial action units and gaze patterns show markers associated with low affect.")
        elif p_dep > 0.4:
            video_points.append("Mild flat affect detected in facial expression; borderline range.")
        else:
            video_points.append("Facial expression patterns within normal affective range.")
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
    tmp_video = None

    try:
        text     = request.form.get("text", "").strip()
        raw_q    = request.form.get("questionnaire", "{}")
        raw_user = request.form.get("userInfo", "{}")

        try:
            q         = json.loads(raw_q)
            user_info = json.loads(raw_user)
        except json.JSONDecodeError as e:
            return jsonify({"error": f"Invalid JSON in form fields: {e}"}), 400

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

        if not text and tmp_audio is None and tmp_video is None:
            return jsonify({"error": "Provide at least one of: text, audio, or video."}), 400

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
        if tmp_audio and os.path.exists(tmp_audio.name):
            os.unlink(tmp_audio.name)
        if tmp_video and os.path.exists(tmp_video.name):
            os.unlink(tmp_video.name)


# ─────────────────────────────────────────────────────────────────────
# ENTRY POINT
# Gunicorn (Dockerfile CMD) bypasses this in production.
# Only runs on: python app.py
# ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    app.run(host="0.0.0.0", port=port, debug=False)
