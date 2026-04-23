# ╔══════════════════════════════════════════════════════════════════════╗
# ║  ManoDhwani Simplified Backend (v4 — Audio + Text)                   ║
# ║  Model : AudioTextFusionNet (WavLM + RoBERTa)                        ║
# ║  Checkpoint : model_new_feature.pt (v4 architecture)                 ║
# ║                                                                      ║
# ║  TEXT_DIM = 768 (Pure RoBERTa vectors, no cognitive features)        ║
# ║                                                                      ║
# ║  POST /analyze                                                       ║
# ║    Accepts multipart/form-data:                                      ║
# ║      audio        : audio file (wav/mp3/webm)  [optional]           ║
# ║      text         : string                     [optional]           ║
# ║      questionnaire: JSON string                [required]           ║
# ║      userInfo     : JSON string                [required]           ║
# ╚══════════════════════════════════════════════════════════════════════╝

# ── Suppress HuggingFace / threading noise BEFORE any HF imports ──────
import os
import re
import threading

os.environ.setdefault("TRANSFORMERS_VERBOSITY",        "error")
os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM",        "false")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS",  "0")

_original_excepthook = threading.excepthook
def _quiet_hf_thread_excepthook(args):
    name = type(args.exc_value).__name__
    if name in {"HfHubHTTPError", "HTTPStatusError", "RepositoryNotFoundError"}:
        return
    _original_excepthook(args)
threading.excepthook = _quiet_hf_thread_excepthook

import json
import tempfile
import warnings
import traceback

warnings.filterwarnings("ignore")

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import librosa
import nltk
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import io
import datetime
import random
import string

# ── PDF engine selection ──────────────────────────────────────────────
# Priority: WeasyPrint (best CSS fidelity) → pdfkit (wkhtmltopdf) → disabled
# WeasyPrint requires GTK3/GLib on Windows; on Linux/Docker it just works.
# pdfkit requires wkhtmltopdf binary: https://wkhtmltopdf.org/downloads.html
_PDF_ENGINE = None  # 'weasyprint' | 'pdfkit' | None

try:
    from weasyprint import HTML as _WP_HTML
    _PDF_ENGINE = 'weasyprint'
    print("[ManoDhwani] PDF engine: WeasyPrint ✓")
except (ImportError, OSError, Exception):
    pass  # GTK/GLib not available (common on Windows without GTK runtime)

if _PDF_ENGINE is None:
    try:
        import pdfkit as _pdfkit
        import subprocess as _subprocess

        # Common install locations for wkhtmltopdf on Windows
        _WKHTML_CANDIDATES = [
            r"C:\Program Files\wkhtmltopdf\bin\wkhtmltopdf.exe",
            r"C:\Program Files (x86)\wkhtmltopdf\bin\wkhtmltopdf.exe",
        ]
        _wkhtml_path = None

        # First try PATH
        try:
            _subprocess.run(
                ["wkhtmltopdf", "--version"],
                stdout=_subprocess.DEVNULL,
                stderr=_subprocess.DEVNULL,
                check=True,
            )
            _wkhtml_path = "wkhtmltopdf"
        except Exception:
            pass

        # Then try known Windows locations
        if _wkhtml_path is None:
            for _candidate in _WKHTML_CANDIDATES:
                if os.path.isfile(_candidate):
                    _wkhtml_path = _candidate
                    break

        if _wkhtml_path:
            _pdfkit_config = _pdfkit.configuration(wkhtmltopdf=_wkhtml_path)
            _PDF_ENGINE = "pdfkit"
            print(f"[ManoDhwani] PDF engine: pdfkit (wkhtmltopdf) ✓  [{_wkhtml_path}]")
    except Exception:
        pass  # pdfkit not installed, or wkhtmltopdf binary not found

_WEASYPRINT_OK = _PDF_ENGINE is not None
if not _WEASYPRINT_OK:
    print(
        "[ManoDhwani] WARNING: No PDF engine available. PDF export disabled.\n"
        "  Option A (Linux/Docker): pip install weasyprint  — works out of the box.\n"
        "  Option B (Windows):      Install GTK3 runtime from https://github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer/releases\n"
        "                           then: pip install weasyprint\n"
        "  Option C (any OS):       pip install pdfkit  +  install wkhtmltopdf from https://wkhtmltopdf.org/downloads.html"
    )


def _render_pdf(html_str: str) -> bytes:
    """Render HTML → PDF bytes using whichever engine is available."""
    if _PDF_ENGINE == 'weasyprint':
        return _WP_HTML(string=html_str, base_url=".").write_pdf()
    elif _PDF_ENGINE == 'pdfkit':
        options = {
            'page-size': 'A4',
            'encoding': 'UTF-8',
            'enable-local-file-access': '',
            'print-media-type': '',
            'no-outline': None,
        }
        return _pdfkit.from_string(html_str, False, options=options, configuration=_pdfkit_config)
    raise RuntimeError("No PDF engine available.")
from transformers import (
    Wav2Vec2FeatureExtractor,
    WavLMModel,
    RobertaTokenizer,
    RobertaModel,
    logging as hf_logging,
)

hf_logging.set_verbosity_error()

import logging
logging.getLogger("huggingface_hub").setLevel(logging.ERROR)
logging.getLogger("transformers").setLevel(logging.ERROR)

nltk.download("punkt",     quiet=True)
nltk.download("punkt_tab", quiet=True)
nltk.download("stopwords", quiet=True)

# ─────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────
CHECKPOINT_PATH = os.environ.get("MODEL_PATH", "model_new_feature.pt")
DEVICE          = torch.device("cuda" if torch.cuda.is_available() else "cpu")
FP16            = torch.cuda.is_available()

# Config (Simplified v4)
SR        = 16_000
CHUNK_SEC = 10
MAX_DUR   = 300

# Text (sliding window — must match training)
MAX_TEXT_LEN = 512
TEXT_STRIDE  = 384

TEXT_DIM = 768   # Pure RoBERTa base hidden size (v4 standard)

print(f"[ManoDhwani] Device: {DEVICE}  |  FP16: {FP16}")

# ─────────────────────────────────────────────────────────────────────
# SENTIMENT GUARDRAIL LEXICONS
# ─────────────────────────────────────────────────────────────────────

POSITIVE_VIBE_PATTERNS = [
    r"\bloving?\s+life\b", r"\bexcited?\b", r"\bexciting\b", r"\bamazing\b",
    r"\bgood\s+vibes?\b",   r"\bsmil(?:e|ing)\b", r"\benjoy(?:ing|ment|ed)?\b", r"\bconfident\b",
    r"\bthriving\b",      r"\bpositive\s+energy\b", r"\bproud\s+of\s+myself\b",
    r"\bhappy\b",         r"\bjoy(?:ful|ous)?\b", r"\bwonderful\b",   r"\bthrive\b",
    r"\bprosper\b",       r"\bfull\s+of\s+possibilities\b", r"\bbest\s+is\s+yet\s+to\s+come\b",
    r"\bfeeling\s+(?:really\s+)?good\b", r"\bdoing\s+(?:really\s+)?well\b",
    r"\bliving\s+in\s+the\s+moment\b", r"\bfeeling\s+great\b", r"\bdoing\s+great\b",
]

DEPRESSIVE_MARKER_PATTERNS = [
    r"\bsad\b",           r"\bdepressed\b",    r"\bhopeless\b",    r"\bworthless\b",
    r"\bmiserable\b",     r"\bempty\b",        r"\bhurt\b",        r"\bpain\b",
    r"\bsuicide\b",       r"\bkill\s+myself\b", r"\bend\s+it\s+all\b",
]


def check_sentiment_guardrail(text: str) -> bool:
    """
    Returns True if the text has strong positive sentiment
    and NO significant depressive markers.
    """
    if not text or not text.strip():
        return False

    text_lower = text.lower()
    pos_hits = sum(len(re.findall(pat, text_lower)) for pat in POSITIVE_VIBE_PATTERNS)
    neg_hits = sum(len(re.findall(pat, text_lower)) for pat in DEPRESSIVE_MARKER_PATTERNS)

    # Require at least 2 strong positive signals and 0 negative signals
    return pos_hits >= 2 and neg_hits == 0



# ─────────────────────────────────────────────────────────────────────
# UTILS
# ─────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────
# UTILS
# ─────────────────────────────────────────────────────────────────────

def safe_clean(arr, clip=1e6):
    arr = np.array(arr, dtype=np.float32)
    arr[~np.isfinite(arr)] = 0.0
    return np.clip(arr, -clip, clip).astype(np.float32)


# ─────────────────────────────────────────────────────────────────────
# MODEL ARCHITECTURE  (AudioTextFusionNet — must match v3 training)
# ─────────────────────────────────────────────────────────────────────

class CrossModalAttention(nn.Module):
    def __init__(self, dim: int, num_heads: int, dropout: float = 0.1):
        super().__init__()
        self.attn = nn.MultiheadAttention(
            dim, num_heads, dropout=dropout, batch_first=True
        )
        self.norm = nn.LayerNorm(dim)
        self.drop = nn.Dropout(dropout)

    def forward(self, query: torch.Tensor, key_value: torch.Tensor) -> torch.Tensor:
        q      = query.unsqueeze(1)
        kv     = key_value.unsqueeze(1)
        out, _ = self.attn(q, kv, kv)
        return self.norm(self.drop(out.squeeze(1)) + query)


class AudioTextFusionNet(nn.Module):
    def __init__(
        self,
        audio_dim:  int,
        text_dim:   int,
        fusion_dim: int   = 256,
        num_heads:  int   = 4,
        dropout:    float = 0.4,
    ):
        super().__init__()

        self.audio_proj = nn.Sequential(
            nn.Linear(audio_dim, fusion_dim),
            nn.LayerNorm(fusion_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(fusion_dim, fusion_dim),
            nn.GELU(),
        )
        self.text_proj = nn.Sequential(
            nn.Linear(text_dim, fusion_dim),
            nn.LayerNorm(fusion_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(fusion_dim, fusion_dim),
            nn.GELU(),
        )

        self.audio_attn_text = CrossModalAttention(fusion_dim, num_heads, dropout * 0.5)
        self.text_attn_audio = CrossModalAttention(fusion_dim, num_heads, dropout * 0.5)

        self.modality_embed = nn.Embedding(2, fusion_dim)

        enc_layer = nn.TransformerEncoderLayer(
            d_model=fusion_dim,
            nhead=num_heads,
            dim_feedforward=fusion_dim * 4,
            dropout=dropout,
            batch_first=True,
            norm_first=True,
        )
        self.transformer = nn.TransformerEncoder(enc_layer, num_layers=2)

        self.gate = nn.Sequential(
            nn.Linear(fusion_dim * 2, 64),
            nn.GELU(),
            nn.Linear(64, 2),
            nn.Softmax(dim=-1),
        )

        self.classifier = nn.Sequential(
            nn.Linear(fusion_dim, fusion_dim),
            nn.LayerNorm(fusion_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(fusion_dim, fusion_dim // 2),
            nn.GELU(),
            nn.Dropout(dropout * 0.5),
            nn.Linear(fusion_dim // 2, 2),
        )

    def forward(self, audio: torch.Tensor, text: torch.Tensor) -> torch.Tensor:
        a = self.audio_proj(audio)
        t = self.text_proj(text)

        a_ref = self.audio_attn_text(a, t)
        t_ref = self.text_attn_audio(t, a)

        ids    = torch.arange(2, device=audio.device)
        me     = self.modality_embed(ids)
        tokens = torch.stack([a_ref, t_ref], dim=1) + me

        fused  = self.transformer(tokens)
        fa, ft = fused[:, 0], fused[:, 1]

        gate_w = self.gate(torch.cat([fa, ft], dim=-1))
        agg    = gate_w[:, 0:1] * fa + gate_w[:, 1:2] * ft

        return self.classifier(agg)


# ─────────────────────────────────────────────────────────────────────
# LOAD CHECKPOINT + PRETRAINED ENCODERS
# ─────────────────────────────────────────────────────────────────────

def load_everything():
    print("[ManoDhwani] Loading checkpoint …")
    if not os.path.exists(CHECKPOINT_PATH):
        raise FileNotFoundError(
            f"Checkpoint not found at '{CHECKPOINT_PATH}'.\n"
            f"Set MODEL_PATH env var to the correct .pt file path.\n"
            f"Expected checkpoint saved by v4 training as 'model_new_feature.pt'."
        )

    ckpt            = torch.load(CHECKPOINT_PATH, map_location="cpu", weights_only=False)
    AUDIO_DIM_      = ckpt["AUDIO_DIM"]
    TEXT_DIM_       = ckpt["TEXT_DIM"]           # 768
    FUSION_DIM_     = ckpt.get("FUSION_DIM", 256)
    NUM_HEADS_      = ckpt.get("NUM_HEADS", 4)
    threshold_      = ckpt["threshold"]
    sc_audio_       = ckpt["sc_audio"]
    sc_text_        = ckpt["sc_text"]
    # v3 checkpoint has no sc_vis — video modality removed in v3

    model = AudioTextFusionNet(
        audio_dim=AUDIO_DIM_,
        text_dim=TEXT_DIM_,
        fusion_dim=FUSION_DIM_,
        num_heads=NUM_HEADS_,
    )
    model.load_state_dict(ckpt["model_state"])
    model.eval()
    model.to(DEVICE)
    print(f"[ManoDhwani] AudioTextFusionNet v4 loaded  threshold={threshold_:.2f}")
    print(f"[ManoDhwani]   AUDIO_DIM={AUDIO_DIM_}  TEXT_DIM={TEXT_DIM_} (Simplified)")

    # ── WavLM ─────────────────────────────────────────────────────────
    print("[ManoDhwani] Loading WavLM-base-plus …")
    AUDIO_MODEL = "microsoft/wavlm-base-plus"
    _hf_kwargs  = {"local_files_only": True} if os.environ.get("HF_OFFLINE") else {}
    wav_feat    = Wav2Vec2FeatureExtractor.from_pretrained(AUDIO_MODEL, **_hf_kwargs)
    wavlm       = WavLMModel.from_pretrained(AUDIO_MODEL, **_hf_kwargs)

    if "wavlm_ft_state" in ckpt:
        # Patch only the fine-tuned layers into the frozen base.
        # strict=False lets us load a partial state dict — the frozen layers
        # keep their HuggingFace pretrained weights, the unfrozen layers get
        # the checkpoint values. missing_keys will be the frozen layers (expected).
        missing, unexpected = wavlm.load_state_dict(ckpt["wavlm_ft_state"], strict=False)
        n_layers = ckpt.get("WAVLM_UNFREEZE_LAYERS", "?")
        print(f"[ManoDhwani] WavLM: patched {len(ckpt['wavlm_ft_state'])} fine-tuned "
              f"keys (last {n_layers} layers) — {len(missing)} frozen keys kept from base")
        if unexpected:
            print(f"[ManoDhwani] WavLM WARNING: unexpected keys in checkpoint: {unexpected}")
    elif "wavlm_state" in ckpt:
        # Backwards-compat: old checkpoint with full state dict
        wavlm.load_state_dict(ckpt["wavlm_state"])
        print("[ManoDhwani] WavLM: loaded full state dict from checkpoint (legacy format)")
    else:
        print("[ManoDhwani] WARNING: no WavLM weights in checkpoint — "
              "using vanilla pretrained weights. Re-train to save fine-tuned layers.")

    wavlm.eval()
    for p in wavlm.parameters():
        p.requires_grad = False
    if FP16:
        wavlm = wavlm.half()
    wavlm = wavlm.to(DEVICE)
    print("[ManoDhwani] WavLM loaded")

    # ── RoBERTa ───────────────────────────────────────────────────────
    print("[ManoDhwani] Loading RoBERTa-base …")
    TEXT_MODEL    = "roberta-base"
    roberta_tok   = RobertaTokenizer.from_pretrained(TEXT_MODEL, **_hf_kwargs)
    roberta_model = RobertaModel.from_pretrained(TEXT_MODEL, **_hf_kwargs)

    if "roberta_ft_state" in ckpt:
        missing, unexpected = roberta_model.load_state_dict(
            ckpt["roberta_ft_state"], strict=False
        )
        n_layers = ckpt.get("ROBERTA_UNFREEZE_LAYERS", "?")
        print(f"[ManoDhwani] RoBERTa: patched {len(ckpt['roberta_ft_state'])} fine-tuned "
              f"keys (last {n_layers} layers + pooler) — {len(missing)} frozen keys kept from base")
        if unexpected:
            print(f"[ManoDhwani] RoBERTa WARNING: unexpected keys in checkpoint: {unexpected}")
    elif "roberta_state" in ckpt:
        # Backwards-compat: old checkpoint with full state dict
        roberta_model.load_state_dict(ckpt["roberta_state"])
        print("[ManoDhwani] RoBERTa: loaded full state dict from checkpoint (legacy format)")
    else:
        print("[ManoDhwani] WARNING: no RoBERTa weights in checkpoint — "
              "using vanilla pretrained weights. Re-train to save fine-tuned layers.")

    roberta_model.eval()
    for p in roberta_model.parameters():
        p.requires_grad = False
    if FP16:
        roberta_model = roberta_model.half()
    roberta_model = roberta_model.to(DEVICE)
    print("[ManoDhwani] RoBERTa loaded")

    return (model,
            AUDIO_DIM_, TEXT_DIM_,
            threshold_,
            sc_audio_, sc_text_,
            wav_feat, wavlm,
            roberta_tok, roberta_model)


(MODEL,
 AUDIO_DIM, TEXT_DIM,
 THRESHOLD,
 SC_AUDIO, SC_TEXT,
 WAV_FEAT, WAVLM,
 ROBERTA_TOK, ROBERTA_MODEL) = load_everything()


# ─────────────────────────────────────────────────────────────────────
# FEATURE EXTRACTION
# ─────────────────────────────────────────────────────────────────────

def extract_audio_embedding(audio_path: str) -> np.ndarray:
    """WavLM chunked mean-pool → (AUDIO_DIM,). Returns zeros on failure."""
    try:
        y, _ = librosa.load(audio_path, sr=SR, mono=True, duration=MAX_DUR)
        y, _ = librosa.effects.trim(y, top_db=20)

        chunk_n = SR * CHUNK_SEC
        min_n   = SR // 4
        chunks  = [
            y[i : i + chunk_n]
            for i in range(0, len(y), chunk_n)
            if len(y[i : i + chunk_n]) >= min_n
        ]
        if not chunks:
            return np.zeros(AUDIO_DIM, dtype=np.float32)

        embs = []
        with torch.no_grad():
            for ch in chunks:
                inp = WAV_FEAT(
                    ch, sampling_rate=SR,
                    return_tensors="pt", padding=True
                ).input_values.to(DEVICE)
                if FP16:
                    inp = inp.half()
                out = WAVLM(inp).last_hidden_state
                embs.append(out.mean(1).squeeze(0).float().cpu().numpy())

        return safe_clean(np.mean(embs, axis=0).astype(np.float32))

    except Exception as e:
        print(f"[WARN] Audio extraction failed: {e}")
        return np.zeros(AUDIO_DIM, dtype=np.float32)


def extract_text_embedding(text: str) -> np.ndarray:
    """
    RoBERTa sliding-window [CLS] mean-pool (stride=384) → 768-dim.
    Uses identical sliding-window logic as training.
    Returns zero vector when no text is provided.
    """
    if not text or not text.strip():
        return np.zeros(TEXT_DIM, dtype=np.float32)

    try:
        tokens = ROBERTA_TOK(
            text, return_tensors="pt",
            truncation=False, padding=False
        )["input_ids"][0]

        cls_id = ROBERTA_TOK.cls_token_id
        sep_id = ROBERTA_TOK.sep_token_id
        inner  = tokens[1:-1]
        window = MAX_TEXT_LEN - 2

        cls_vecs = []
        with torch.no_grad():
            for start in range(0, max(1, len(inner)), TEXT_STRIDE):
                chunk = inner[start : start + window]
                ids   = torch.cat([
                    torch.tensor([cls_id]),
                    chunk,
                    torch.tensor([sep_id]),
                ]).unsqueeze(0).to(DEVICE)
                msk = torch.ones_like(ids).to(DEVICE)
                out = ROBERTA_MODEL(input_ids=ids, attention_mask=msk)
                cls_vecs.append(
                    out.last_hidden_state[:, 0, :]
                       .squeeze(0).float().cpu().numpy()
                )
                if start + window >= len(inner):
                    break

        roberta_emb = safe_clean(np.mean(cls_vecs, axis=0).astype(np.float32))

    except Exception as e:
        print(f"[WARN] RoBERTa embedding failed: {e}")
        roberta_emb = np.zeros(TEXT_DIM, dtype=np.float32)

    return roberta_emb


# ─────────────────────────────────────────────────────────────────────
# QUESTIONNAIRE HELPERS
# ─────────────────────────────────────────────────────────────────────

def questionnaire_contribution(q, has_audio, has_text):
    answers    = q.get("answers", {})
    pos_count  = sum(1 for v in answers.values() if v)
    impairment = q.get("impairment", 30)
    scores     = q.get("scores", {})

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
        return {"text": 0, "audio": 0, "cognitive": 0, "questionnaire": 100}

    weights  = {"text": 1.2, "audio": 1.0}
    total_w  = sum(weights[m] for m in modalities)
    contribs = {}
    for m in ["text", "audio"]:
        contribs[m] = round(remainder * weights[m] / total_w) if m in modalities else 0

    contribs["questionnaire"] = q_weight
    # Cognitive section removed in v4 — redistributed to text
    contribs["cognitive"] = 0
    diff = 100 - (contribs["text"] + contribs["audio"] + contribs["questionnaire"])
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
# INSIGHT BUILDERS
# ─────────────────────────────────────────────────────────────────────

def build_cognitive_insights(text: str, p_dep: float) -> list:
    """Kept for legacy compatibility."""
    return ["Cognitive indicators reflected in ADET analysis below."]


# ─────────────────────────────────────────────────────────────────────
# ADET — Automated Depression Evidence Tracker
# Analyses text for cognitive distortions and coping mechanisms using
# keyword/pattern matching.  Runs entirely in-process with no extra deps.
# ─────────────────────────────────────────────────────────────────────

_DISTORTION_PATTERNS = {
    "Catastrophising": {
        "patterns": [
            r"\b(everything('s| is) (ruined|over|hopeless|terrible))\b",
            r"\b(worst|disaster|catastrophe|horrible|awful|dreadful)\b",
            r"\b(nothing will ever|it('s| is) all over|can('t| not) get worse)\b",
            r"\b(doom(ed)?|end of (the )?world|unbearable|devastating)\b",
        ],
        "description": "Tendency to magnify problems and imagine worst-case outcomes.",
    },
    "All-or-Nothing Thinking": {
        "patterns": [
            r"\b(always|never|every(one|body|thing)|no(body|one|thing))\b",
            r"\b(completely|totally|utterly|absolutely|entirely)\b",
            r"\b(perfect(ly)?|failure|useless|worthless)\b",
            r"\b(all (wrong|bad|my fault)|none of it matters)\b",
        ],
        "description": "Viewing situations in black-and-white without acknowledging nuance.",
    },
    "Mind Reading": {
        "patterns": [
            r"\b(they (think|know|hate|blame) (me|I))\b",
            r"\b(everyone (thinks|knows|hates|blames|judges) me)\b",
            r"\b(people (think|see|view) me as)\b",
            r"\b(I know (they|he|she|everyone) (thinks|feels|believes))\b",
        ],
        "description": "Assuming what others think or feel without direct evidence.",
    },
    "Emotional Reasoning": {
        "patterns": [
            r"\b(I feel (like a|so|completely) (failure|worthless|stupid|broken|useless))\b",
            r"\b(I feel (it|that) (is|must be) (true|real|happening))\b",
            r"\b(because I feel.*(it|this) (must|has to) be)\b",
            r"\b(I (just )?feel (like nothing|like it's|terrible so))\b",
        ],
        "description": "Treating feelings as facts rather than subjective experiences.",
    },
    "Personalisation": {
        "patterns": [
            r"\b(it('s| is) (all |my fault|because of me))\b",
            r"\b(I (caused|ruined|broke|destroyed|caused))\b",
            r"\b(blame myself|my fault|I should have|if only I (had|was|were|did))\b",
            r"\b(I (always |constantly )?(mess|screw|ruin) (everything|things|it) up)\b",
        ],
        "description": "Taking excessive personal responsibility for external events.",
    },
    "Overgeneralisation": {
        "patterns": [
            r"\b(this (always|never) happens (to me))\b",
            r"\b(I (always|never) (fail|mess up|get it wrong|succeed))\b",
            r"\b(every time I try|it('s| is) always like this)\b",
            r"\b(things (never|always) (work out|go wrong) for me)\b",
        ],
        "description": "Drawing broad conclusions from a single negative event.",
    },
}

_COPING_PATTERNS = {
    "Help-Seeking": {
        "patterns": [
            r"\b(talk(ing|ed)? to (someone|a friend|my therapist|a doctor|counsellor))\b",
            r"\b(reach(ing|ed)? out|ask(ing|ed)? for help|seeing a (therapist|doctor|psychologist))\b",
            r"\b(in therapy|going to therapy|started (therapy|counselling))\b",
        ],
        "description": "Actively seeking social or professional support.",
    },
    "Mindfulness / Grounding": {
        "patterns": [
            r"\b(meditat(e|ing|ed|ion)|mindful(ness)?|breath(ing|e) exercise)\b",
            r"\b(staying present|grounding|journaling|gratitude)\b",
            r"\b(5-4-3-2-1|body scan|deep breath)\b",
        ],
        "description": "Using present-moment awareness or grounding techniques.",
    },
    "Physical Activity": {
        "patterns": [
            r"\b(exercis(e|ing|ed)|walk(ing|ed)|run(ning)?|gym|workout)\b",
            r"\b(yoga|cycling|swimming|sport(s)?|physical activity)\b",
        ],
        "description": "Engaging in physical movement to manage mood.",
    },
    "Positive Reframing": {
        "patterns": [
            r"\b(try(ing)? to (see|think|look at) (the )?positive|silver lining)\b",
            r"\b(reframe|it could be worse|at least|looking on the bright side)\b",
            r"\b(grateful|thankful|appreciate|bless(ed)?)\b",
        ],
        "description": "Actively reinterpreting situations in a more constructive light.",
    },
    "Creative Expression": {
        "patterns": [
            r"\b(writ(e|ing|ten)|draw(ing)?|paint(ing)?|music|play(ing)? (an )?instrument)\b",
            r"\b(creat(e|ing|ive)|art|express myself|journaling|blogging)\b",
        ],
        "description": "Using creative outlets to process and express emotions.",
    },
    "Social Connection": {
        "patterns": [
            r"\b(spent time (with|around)|hang(ing|out) (with|out)|friends|family)\b",
            r"\b(called (a friend|someone|my (mum|mom|dad|sister|brother)))\b",
            r"\b(meeting (up|people)|social(ising|izing)?|community)\b",
        ],
        "description": "Maintaining supportive relationships as a buffer against distress.",
    },
}


def _score_patterns(text: str, pattern_dict: dict) -> list:
    """Return list of {name, density, description} sorted by density desc."""
    text_lower = text.lower()
    word_count = max(len(text_lower.split()), 1)
    results = []
    for name, cfg in pattern_dict.items():
        hits = 0
        for pat in cfg["patterns"]:
            hits += len(re.findall(pat, text_lower))
        if hits > 0:
            density = min(hits / word_count * 8, 1.0)   # scale: ~1 hit per 8 words = 100%
            results.append({
                "name":        name,
                "density":     round(density, 3),
                "description": cfg["description"],
            })
    results.sort(key=lambda x: x["density"], reverse=True)
    return results[:5]   # cap at 5 items per category


def build_adet(text: str, p_dep: float, audio_path) -> dict | None:
    """
    Build the ADET payload.
    Returns None when no text is provided (nothing to analyse cognitively).
    """
    if not text or not text.strip():
        return None

    distortions = _score_patterns(text, _DISTORTION_PATTERNS)
    coping      = _score_patterns(text, _COPING_PATTERNS)

    # Cognitive risk score (0–10): blend of model probability + distortion load
    distortion_load = sum(d["density"] for d in distortions) / max(len(distortions), 1) if distortions else 0.0
    cognitive_risk_score = round(
        p_dep * 6.0                 # model contributes up to 6 pts
        + distortion_load * 3.0     # distortion density adds up to 3 pts
        + (0 if coping else 1.0),   # absence of coping adds 1 pt
        1
    )
    cognitive_risk_score = min(cognitive_risk_score, 10.0)

    # Audio feature bullets (shown in the audio sub-section of ADET card)
    audio_features = []
    if audio_path:
        if p_dep > 0.6:
            audio_features.append("Reduced prosodic variability detected — consistent with depressed affect.")
            audio_features.append("Speech rhythm shows flattened intonation contours.")
        elif p_dep > 0.4:
            audio_features.append("Moderate changes in vocal energy detected.")
            audio_features.append("Some reduction in pitch range observed.")
        else:
            audio_features.append("Vocal prosody within normal clinical range.")
            audio_features.append("No significant acoustic markers of depression detected.")
    else:
        audio_features.append("No audio provided — vocal biomarker analysis unavailable.")

    return {
        "distortions":          distortions,
        "coping":               coping,
        "cognitive_risk_score": cognitive_risk_score,
        "audio_features":       audio_features,
    }


# ─────────────────────────────────────────────────────────────────────
# CORE PREDICT
# ─────────────────────────────────────────────────────────────────────

def predict(text: str, audio_path: str, q: dict) -> dict:
    has_audio = audio_path is not None
    has_text  = bool(text and text.strip())

    # ── Feature extraction ────────────────────────────────────────────
    ae = extract_audio_embedding(audio_path) if has_audio \
         else np.zeros(AUDIO_DIM, dtype=np.float32)

    te = extract_text_embedding(text)

    # ── Normalise using train-fitted scalers ──────────────────────────
    ae = safe_clean(SC_AUDIO.transform(ae.reshape(1, -1))[0].astype(np.float32))
    te = safe_clean(SC_TEXT.transform(te.reshape(1, -1))[0].astype(np.float32))

    # ── Model inference ───────────────────────────────────────────────
    at = torch.from_numpy(ae).unsqueeze(0).to(DEVICE)
    tt = torch.from_numpy(te).unsqueeze(0).to(DEVICE)

    MODEL.eval()
    with torch.no_grad():
        logits = MODEL(at, tt)
        probs  = torch.softmax(logits, dim=1).cpu().numpy()[0]

    p_dep = float(probs[1])

    # ── Risk classification ───────────────────────────────────────────
    MODERATE_THRESHOLD = float(THRESHOLD)
    HIGH_THRESHOLD     = MODERATE_THRESHOLD + 0.10

    # ── Guardrails ────────────────────────────────────────────────────
    if not has_audio and has_text:
        word_count = len(text.split())
        if word_count < 5:
            p_dep = min(p_dep, MODERATE_THRESHOLD - 0.10)

    if has_text and check_sentiment_guardrail(text):
        if p_dep >= MODERATE_THRESHOLD:
            p_dep = min(p_dep, MODERATE_THRESHOLD - 0.15)

    # ── Risk Level Logic ──────────────────────────────────────────────
    if p_dep >= HIGH_THRESHOLD:
        risk_level       = "High"
        confidence_score = round(min((p_dep - HIGH_THRESHOLD) / (1.0 - HIGH_THRESHOLD) * 100 + 1, 99), 1)
    elif p_dep >= MODERATE_THRESHOLD:
        risk_level       = "Moderate"
        confidence_score = round(min((p_dep - MODERATE_THRESHOLD) / 0.10 * 100 + 1, 99), 1)
    else:
        risk_level       = "Low"
        confidence_score = round((MODERATE_THRESHOLD - p_dep) / MODERATE_THRESHOLD * 100, 1)

    # ── Response Data ─────────────────────────────────────────────────
    contribs  = questionnaire_contribution(q, has_audio, has_text)
    signals   = derive_signals(p_dep, risk_level, q)
    recs      = get_recommendations(risk_level, q)
    q_points  = build_questionnaire_insights(q)

    text_points = []
    if has_text:
        word_count = len(text.split())
        text_points.append(f"Analysed {word_count} words via RoBERTa (TEXT_DIM={TEXT_DIM}).")
        if p_dep > 0.6:
            text_points.append("Linguistic patterns show indicators of elevated emotional distress.")
        elif p_dep > 0.4:
            text_points.append("Moderate linguistic markers of low mood detected.")
        else:
            text_points.append("Language patterns appear stable with no prominent depressive indicators.")
    else:
        text_points.append("No text input provided.")

    audio_points = []
    if has_audio:
        audio_points.append(f"Audio processed via WavLM-base-plus ({AUDIO_DIM}-dim).")
        if p_dep > 0.6:
            audio_points.append("Vocal biomarkers suggest reduced prosodic variability.")
        else:
            audio_points.append("Vocal patterns within normal clinical range.")
    else:
        audio_points.append("No audio input provided.")

    return {
        "riskLevel":        risk_level,
        "confidenceScore":  confidence_score,
        "contributions":    contribs,
        "emotionalSignals": signals,
        "insights": {
            "text":          {"points": text_points},
            "audio":         {"points": audio_points},
            "questionnaire": {"points": q_points},
            "cognitive":     {"points": ["Cognitive indicators migrated to text modality in v4."]}
        },
        "adet":             build_adet(text, p_dep, audio_path),
        "recommendations":  recs,
        "modelProb":        round(p_dep * 100, 2),
        "threshold":        round(THRESHOLD, 2),
    }


# ─────────────────────────────────────────────────────────────────────
# FLASK APP
# ─────────────────────────────────────────────────────────────────────
app = Flask(__name__)

_ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "*")
CORS(app, resources={r"/*": {"origins": _ALLOWED_ORIGIN}})
print(f"[ManoDhwani] CORS origin: {_ALLOWED_ORIGIN}")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status":   "ok",
        "device":   str(DEVICE),
        "model":    "AudioTextFusionNet-v4",
        "text_dim": TEXT_DIM,
        "audio_dim": AUDIO_DIM,
    }), 200


@app.route("/analyze", methods=["POST"])
def analyze():
    tmp_audio = None

    try:
        text     = request.form.get("text", "").strip()
        raw_q    = request.form.get("questionnaire", "{}")
        raw_user = request.form.get("userInfo", "{}")

        try:
            q         = json.loads(raw_q)
            user_info = json.loads(raw_user)   # noqa: F841
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
# PDF REPORT GENERATOR  (mirrors generate_report.py exactly)
# POST /generate-pdf
#   Body: application/json — the report data dict
#   Returns: application/pdf binary
# ─────────────────────────────────────────────────────────────────────

_PDF_COLORS = {
    "blue_logo":      "#185FA5",
    "blue_light":     "#E6F1FB",
    "blue_border":    "#B5D4F4",
    "blue_text":      "#0C447C",
    "red_bg":         "#FCEBEB",
    "red_border":     "#F09595",
    "red_text":       "#791F1F",
    "red_dot":        "#E24B4A",
    "red_head":       "#A32D2D",
    "amber_bg":       "#FEF8F1",
    "amber_border":   "#FAC775",
    "amber_text":     "#633806",
    "amber_dot":      "#EF9F27",
    "green_head":     "#3B6D11",
    "bg_primary":     "#FFFFFF",
    "bg_secondary":   "#F7F8FA",
    "border":         "#E5E7EB",
    "text_primary":   "#111827",
    "text_secondary": "#6B7280",
    "low_bg":         "#F0FDF4",
    "low_border":     "#86EFAC",
    "low_text":       "#14532D",
    "low_dot":        "#22C55E",
    "mod_bg":         "#FFFBEB",
    "mod_border":     "#FCD34D",
    "mod_text":       "#78350F",
    "mod_dot":        "#F59E0B",
}


def _pdf_risk_colors(risk_level: str) -> dict:
    rl = risk_level.lower()
    C = _PDF_COLORS
    if "high" in rl:
        return dict(bg=C["red_bg"], border=C["red_border"], text=C["red_text"],
                    dot=C["red_dot"], badge_label="High Risk · Immediate Action Recommended")
    elif "moderate" in rl or "medium" in rl:
        return dict(bg=C["mod_bg"], border=C["mod_border"], text=C["mod_text"],
                    dot=C["mod_dot"], badge_label="Moderate Risk · Intervention Advised")
    else:
        return dict(bg=C["low_bg"], border=C["low_border"], text=C["low_text"],
                    dot=C["low_dot"], badge_label="Low Risk · Continue Monitoring")


def _pdf_severity_bar_width(pct: float) -> str:
    return f"{min(max(pct, 0), 100):.1f}%"


def _pdf_severity_bar_color(pct: float) -> str:
    if pct >= 75:
        return "linear-gradient(90deg,#FAC775,#E24B4A)"
    elif pct >= 51:
        return "linear-gradient(90deg,#FDE68A,#F59E0B)"
    else:
        return "linear-gradient(90deg,#86EFAC,#22C55E)"


def _build_report_html(data: dict) -> str:
    C   = _PDF_COLORS
    rc  = _pdf_risk_colors(data["risk_level"])
    now = datetime.datetime.now()
    report_id = data.get("report_id", "PSY-" + now.strftime("%Y-") +
                          "".join(random.choices(string.digits, k=4)))
    generated = now.strftime("%d/%m/%Y, %H:%M:%S")
    prob      = data.get("probability_pct", 0.0)
    has_prob  = prob > 0

    rl_key = ("high" if "high" in data["risk_level"].lower()
               else ("moderate" if "moderate" in data["risk_level"].lower() else "low"))
    alert_msg = {
        "high":     "<strong>High Risk Detected —</strong> This report requires immediate attention. Please review the recommendations and next steps carefully.",
        "moderate": "<strong>Moderate Risk Detected —</strong> This report requires attention. Please review the recommendations carefully.",
        "low":      "<strong>Low Risk —</strong> No severe depressive signals detected. Continue to monitor your wellbeing periodically.",
    }
    alert_text = alert_msg[rl_key]

    prob_html = f"""
        <div class="ps-metric">
          <div class="ps-metric-label">Probability</div>
          <div class="ps-metric-value" style="color:{rc['text']};">{prob:.2f}%</div>
          <div class="ps-severity-bar">
            <div class="ps-severity-fill" style="width:{_pdf_severity_bar_width(prob)};background:{_pdf_severity_bar_color(prob)};"></div>
          </div>
          <div class="ps-metric-sub">{data.get('prob_range_label','Normal range')}</div>
        </div>
    """ if has_prob else f"""
        <div class="ps-metric">
          <div class="ps-metric-label">Probability</div>
          <div class="ps-metric-value" style="color:{C['text_secondary']};">—%</div>
          <div class="ps-metric-sub">Normal range (&lt; 51%)</div>
        </div>
    """

    # Risk factors
    risk_factors_html = ""
    if data.get("risk_factors"):
        factors = "".join(f"""
          <div class="ps-risk-factor">
            <div class="ps-rf-icon"></div>
            <div class="ps-rf-text"><span class="ps-rf-label">{f['label']} —</span> {f['body']}</div>
          </div>
        """ for f in data["risk_factors"])
        risk_factors_html = f"""
          <div class="ps-card">
            <div class="ps-card-title"><div class="ps-card-title-bar"></div> Risk Analysis</div>
            <div style="font-size:13px;color:{C['text_secondary']};line-height:1.7;margin-bottom:12px;">
              The risk classification was assigned based on a convergence of strong signals across all modalities.
              No single factor alone determined this — it is the combination and intensity of the following contributing patterns:
            </div>
            <div class="ps-risk-factors">{factors}</div>
          </div>
        """

    # Insights
    icon_bg = {"audio":"#E6F1FB","text":"#EAF3DE","facial":"#FBEAF0","questionnaire":"#FAEEDA"}
    insights_html = "".join(f"""
      <div class="ps-insight">
        <div class="ps-insight-icon-row">
          <div class="ps-insight-icon" style="background:{icon_bg.get(ins.get('type','audio'),'#F3F4F6')};font-size:9px;font-weight:600;color:#555;letter-spacing:0;">{ins['icon']}</div>
          <div class="ps-insight-title">{ins['title']}</div>
        </div>
        <div class="ps-insight-body">{ins['body']}</div>
      </div>
    """ for ins in data.get("insights", []))

    # Recommendations
    def rec_items(items):
        return "".join(f"""
          <div class="ps-rec-item">
            <span class="ps-rec-num">{i+1}.</span>
            <span>{item}</span>
          </div>
        """ for i, item in enumerate(items))

    recs = data.get("recommendations", {})
    recs_html = f"""
      <div class="ps-rec">
        <div class="ps-rec-head ps-rec-head-red">Immediate Actions</div>
        {rec_items(recs.get('immediate', []))}
      </div>
      <div class="ps-rec">
        <div class="ps-rec-head ps-rec-head-blue">Professional Support</div>
        {rec_items(recs.get('professional', []))}
      </div>
      <div class="ps-rec">
        <div class="ps-rec-head ps-rec-head-green">Lifestyle Support</div>
        {rec_items(recs.get('lifestyle', []))}
      </div>
    """

    # Next steps
    steps_html = "".join(f"""
      <div class="ps-step">
        <span class="ps-step-num">{i+1}</span>
        <span class="ps-step-text"><span class="ps-step-strong">{step['label']}:</span> {step['body']}</span>
      </div>
    """ for i, step in enumerate(data.get("next_steps", [])))

    # Doctors table
    doctors_html = ""
    if data.get("doctors"):
        rows = "".join(f"""
          <tr>
            <td class="ps-doc-name">{d['name']}</td>
            <td class="ps-doc-spec">{d['specialization']}</td>
            <td class="ps-doc-place">{d['place']}</td>
          </tr>
        """ for d in data["doctors"])
        doctors_html = f"""
          <div class="ps-card">
            <div class="ps-card-title"><div class="ps-card-title-bar"></div> Recommended Doctors in {data.get('city','Hyderabad')}</div>
            <div style="font-size:13px;color:{C['text_secondary']};margin-bottom:10px;">
              Based on the detected condition (<strong style="color:{C['text_primary']};">{data.get('disorder_name','')}</strong>),
              the following specialists in {data.get('city','Hyderabad')} are recommended.
            </div>
            <table class="ps-doc-table">
              <thead>
                <tr>
                  <th>Doctor Name</th>
                  <th>Area of Specialization</th>
                  <th>Place of Work</th>
                </tr>
              </thead>
              <tbody>{rows}</tbody>
            </table>
            <div style="font-size:11px;color:{C['text_secondary']};margin-top:10px;line-height:1.6;">
              Always confirm current clinic timings and availability when booking.
              The same psychiatrist is usually qualified to treat multiple depressive disorders.
            </div>
          </div>
        """

    # Disorder type block
    disorder_html = ""
    if data.get("disorder_name") and data.get("disorder_desc"):
        tags_html = "".join(f'<span class="ps-tag">{t}</span>' for t in data.get("disorder_tags", []))
        disorder_html = f"""
          <div class="ps-divider"></div>
          <div style="font-size:13px;color:{C['text_secondary']};line-height:1.7;margin-bottom:10px;">
            <strong style="color:{C['text_primary']};">Depression type detected:</strong>
            {data['disorder_desc']}
          </div>
          <div>{tags_html}</div>
        """

    badge_html = f"""
      <span class="ps-risk-badge" style="background:{rc['bg']};border-color:{rc['border']};color:{rc['text']};">
        <div class="ps-risk-dot" style="background:{rc['dot']};"></div>
        {rc['badge_label']}
      </span>
    """

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{
  font-family: Arial, Helvetica, sans-serif;
  font-size: 14px;
  color: {C['text_primary']};
  background: {C['bg_primary']};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}}
.ps-root {{ max-width: 860px; margin: 0 auto; padding: 24px; }}

/* Header — table layout (WeasyPrint-safe) */
.ps-header {{
  border: 1px solid {C['border']}; border-radius: 12px;
  padding: 20px 28px; margin-bottom: 12px;
  background: {C['bg_primary']};
}}
.ps-header-table {{ width: 100%; border-collapse: collapse; }}
.ps-header-table td {{ vertical-align: top; padding: 0; border: none; }}
.ps-logo {{ display: block; }}
.ps-logo-icon {{
  width: 36px; height: 36px; border-radius: 8px;
  background: {C['blue_logo']};
  display: inline-block; vertical-align: middle; margin-right: 10px;
}}
.ps-logo-icon svg {{ width: 20px; height: 20px; vertical-align: middle; }}
.ps-logo-name {{ font-size: 18px; font-weight: 600; color: {C['text_primary']}; display: inline-block; vertical-align: middle; }}
.ps-logo-sub {{ font-size: 11px; color: {C['text_secondary']}; letter-spacing: 0.05em; text-transform: uppercase; display: block; margin-top: 2px; }}
.ps-header-meta {{ text-align: right; font-size: 12px; color: {C['text_secondary']}; line-height: 1.8; }}
.ps-header-meta strong {{ color: {C['text_primary']}; font-weight: 500; }}

/* Alert */
.ps-alert {{
  border-radius: 8px; padding: 10px 18px; margin-bottom: 12px;
  font-size: 13px; border: 1px solid;
}}
.ps-alert-table {{ width: 100%; border-collapse: collapse; }}
.ps-alert-table td {{ vertical-align: middle; padding: 0; border: none; }}
.ps-alert-high     {{ background:{C['red_bg']}; border-color:{C['red_border']}; color:{C['red_text']}; }}
.ps-alert-moderate {{ background:{C['mod_bg']}; border-color:{C['mod_border']}; color:{C['mod_text']}; }}
.ps-alert-low      {{ background:{C['low_bg']}; border-color:{C['low_border']}; color:{C['low_text']}; }}
.ps-alert-dot {{ width: 8px; height: 8px; border-radius: 50%; background: {rc['dot']}; display: inline-block; margin-right: 10px; vertical-align: middle; }}

/* Card */
.ps-card {{
  background: {C['bg_primary']}; border: 1px solid {C['border']};
  border-radius: 12px; padding: 18px 22px; margin-bottom: 12px;
}}
.ps-card-title {{
  font-size: 12px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.07em;
  color: {C['text_secondary']}; margin-bottom: 14px;
}}
.ps-card-title-bar {{
  width: 3px; height: 14px; border-radius: 2px;
  background: {C['blue_logo']};
  display: inline-block; vertical-align: middle; margin-right: 8px;
}}

/* Patient grid — table layout */
.ps-patient-table {{ width: 100%; border-collapse: separate; border-spacing: 8px; margin: -8px; }}
.ps-patient-cell {{ background: {C['bg_secondary']}; border-radius: 8px; padding: 10px 12px; width: 25%; }}
.ps-patient-label {{ font-size: 11px; color: {C['text_secondary']}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; }}
.ps-patient-value {{ font-size: 14px; font-weight: 500; color: {C['text_primary']}; }}

/* Summary */
.ps-summary-text {{ font-size: 14px; line-height: 1.8; color: {C['text_primary']}; margin-bottom: 12px; }}
.ps-risk-badge {{
  display: inline-block;
  border: 1px solid; border-radius: 8px;
  padding: 4px 12px; font-size: 13px; font-weight: 500;
}}
.ps-risk-dot {{ width: 7px; height: 7px; border-radius: 50%; display: inline-block; vertical-align: middle; margin-right: 5px; }}

/* Metrics — table layout */
.ps-metrics-table {{ width: 100%; border-collapse: separate; border-spacing: 8px; margin: -8px; margin-bottom: 4px; }}
.ps-metric {{ background: {C['bg_secondary']}; border-radius: 8px; padding: 14px 16px; vertical-align: top; width: 33%; }}
.ps-metric-label {{ font-size: 11px; color: {C['text_secondary']}; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }}
.ps-metric-value {{ font-size: 22px; font-weight: 500; color: {C['text_primary']}; }}
.ps-metric-sub {{ font-size: 12px; color: {C['text_secondary']}; margin-top: 2px; }}
.ps-severity-bar {{ height: 8px; border-radius: 4px; background: {C['border']}; margin: 8px 0 4px; overflow: hidden; }}
.ps-severity-fill {{ height: 8px; border-radius: 4px; }}

/* Tags */
.ps-tag {{
  display: inline-block;
  background: {C['blue_light']}; border: 1px solid {C['blue_border']};
  border-radius: 8px; padding: 3px 10px;
  font-size: 12px; color: {C['blue_text']}; margin: 3px 3px 3px 0;
}}
.ps-divider {{ height: 1px; background: {C['border']}; margin: 10px 0; }}

/* Insights — table layout */
.ps-insights-table {{ width: 100%; border-collapse: separate; border-spacing: 8px; margin: -8px; }}
.ps-insight {{ border: 1px solid {C['border']}; border-radius: 8px; padding: 14px 16px; vertical-align: top; width: 50%; }}
.ps-insight-icon {{
  width: 28px; height: 28px; border-radius: 6px;
  display: inline-block; vertical-align: middle; margin-right: 8px;
  text-align: center; line-height: 28px;
  font-size: 9px; font-weight: 600; color: #555;
}}
.ps-insight-title {{ font-size: 13px; font-weight: 500; color: {C['text_primary']}; display: inline-block; vertical-align: middle; }}
.ps-insight-body {{ font-size: 13px; color: {C['text_secondary']}; line-height: 1.6; margin-top: 8px; }}

/* Risk factors */
.ps-risk-factor {{
  padding: 10px 12px; margin-bottom: 8px;
  background: {C['amber_bg']}; border: 1px solid {C['amber_border']}; border-radius: 8px;
}}
.ps-rf-dot {{ width: 6px; height: 6px; border-radius: 50%; background: {C['amber_dot']}; display: inline-block; vertical-align: middle; margin-right: 8px; }}
.ps-rf-text {{ font-size: 13px; color: {C['amber_text']}; line-height: 1.5; }}
.ps-rf-label {{ font-weight: 500; }}

/* Recommendations — table layout */
.ps-rec-table {{ width: 100%; border-collapse: separate; border-spacing: 8px; margin: -8px; }}
.ps-rec {{ border: 1px solid {C['border']}; border-radius: 8px; padding: 14px; vertical-align: top; width: 33%; }}
.ps-rec-head {{ font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; }}
.ps-rec-head-red   {{ color: {C['red_head']}; }}
.ps-rec-head-blue  {{ color: {C['blue_logo']}; }}
.ps-rec-head-green {{ color: {C['green_head']}; }}
.ps-rec-item {{
  font-size: 13px; color: {C['text_secondary']}; line-height: 1.6;
  padding: 5px 0; border-bottom: 1px solid {C['border']};
}}
.ps-rec-item:last-child {{ border-bottom: none; }}
.ps-rec-num {{ font-weight: 500; color: {C['text_primary']}; font-size: 12px; }}

/* Next steps */
.ps-step {{ margin-bottom: 10px; }}
.ps-step-num {{
  width: 24px; height: 24px; border-radius: 50%;
  border: 1px solid {C['border']};
  display: inline-block; vertical-align: middle;
  text-align: center; line-height: 22px;
  font-size: 12px; font-weight: 500; color: {C['text_secondary']};
  margin-right: 10px;
}}
.ps-step-text {{ font-size: 13px; color: {C['text_primary']}; line-height: 1.6; display: inline-block; vertical-align: middle; width: calc(100% - 44px); }}
.ps-step-strong {{ font-weight: 500; }}

/* Doctor table */
.ps-doc-table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
.ps-doc-table thead tr {{ background: {C['bg_secondary']}; }}
.ps-doc-table th {{
  text-align: left; font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.05em; color: {C['text_secondary']};
  padding: 8px 12px; border-bottom: 1px solid {C['border']};
}}
.ps-doc-table td {{
  padding: 10px 12px; border-bottom: 1px solid {C['border']};
  color: {C['text_primary']}; vertical-align: top;
}}
.ps-doc-table tbody tr:last-child td {{ border-bottom: none; }}
.ps-doc-name {{ font-weight: 500; }}
.ps-doc-spec  {{ color: {C['text_secondary']}; }}
.ps-doc-place {{ color: {C['text_secondary']}; }}

/* Disclaimer */
.ps-disclaimer {{
  border: 1px solid {C['border']}; border-radius: 8px;
  padding: 14px 18px; background: {C['bg_secondary']};
}}
.ps-disclaimer-title {{
  font-size: 12px; font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.06em;
  color: {C['text_secondary']}; margin-bottom: 6px;
}}
.ps-disclaimer-body {{ font-size: 12px; color: {C['text_secondary']}; line-height: 1.7; }}

/* Footer */
.ps-footer {{
  padding-top: 12px; border-top: 1px solid {C['border']};
  margin-top: 8px; font-size: 11px; color: {C['text_secondary']};
}}
.ps-footer-table {{ width: 100%; border-collapse: collapse; }}
.ps-footer-table td {{ border: none; padding: 0; }}

@page {{ size: A4; margin: 0; }}
</style>
</head>
<body>
<div class="ps-root">

  <!-- Header -->
  <div class="ps-header">
    <div class="ps-logo">
      <div class="ps-logo-icon">
        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 3C7.5 3 5.5 4.8 5.5 7c0 1.4.8 2.7 2 3.4v1.1l-1.2 1.2a.5.5 0 000 .7l1.2 1.2v1.4c0 .6.4 1 1 1h3c.6 0 1-.4 1-1v-1.4l1.2-1.2a.5.5 0 000-.7L12.5 11.4V10.4c1.2-.7 2-2 2-3.4C14.5 4.8 12.5 3 10 3z" fill="white" opacity="0.9"/>
        </svg>
      </div>
      <div>
        <div class="ps-logo-name">PsychSense</div>
        <div class="ps-logo-sub">AI Mental Health Report</div>
      </div>
    </div>
    <div class="ps-header-meta">
      <div><strong>Report ID</strong> &nbsp;{report_id}</div>
      <div><strong>Generated</strong> &nbsp;{generated}</div>
      <div><strong>Analysis Mode</strong> &nbsp;{data.get('analysis_mode', 'Text')}</div>
      <div><strong>Model Version</strong> &nbsp;PsychSense v2.1.0</div>
    </div>
  </div>

  <!-- Alert Banner -->
  <div class="ps-alert ps-alert-{rl_key}">
    <div class="ps-alert-dot"></div>
    <span>{alert_text}</span>
  </div>

  <!-- Patient Information -->
  <div class="ps-card">
    <div class="ps-card-title"><div class="ps-card-title-bar"></div> Patient Information</div>
    <div class="ps-patient-grid">
      <div class="ps-patient-cell">
        <div class="ps-patient-label">Full Name</div>
        <div class="ps-patient-value">{data['patient']['name']}</div>
      </div>
      <div class="ps-patient-cell">
        <div class="ps-patient-label">Age</div>
        <div class="ps-patient-value">{data['patient']['age']} years</div>
      </div>
      <div class="ps-patient-cell">
        <div class="ps-patient-label">Gender</div>
        <div class="ps-patient-value">{data['patient']['gender']}</div>
      </div>
      <div class="ps-patient-cell">
        <div class="ps-patient-label">Session Date</div>
        <div class="ps-patient-value">{data['patient']['session_date']}</div>
      </div>
    </div>
  </div>

  <!-- Executive Summary -->
  <div class="ps-card">
    <div class="ps-card-title"><div class="ps-card-title-bar"></div> Executive Summary</div>
    <div class="ps-summary-text">{data['executive_summary']}</div>
    {badge_html}
  </div>

  <!-- Assessment Results -->
  <div class="ps-card">
    <div class="ps-card-title"><div class="ps-card-title-bar"></div> Assessment Results</div>
    <div class="ps-metrics-grid">
      {prob_html}
      <div class="ps-metric">
        <div class="ps-metric-label">Risk Classification</div>
        <div class="ps-metric-value" style="font-size:18px;color:{rc['text']};">{data['risk_level']}</div>
        <div class="ps-metric-sub">{data.get('risk_sub_label','')}</div>
      </div>
      <div class="ps-metric">
        <div class="ps-metric-label">Type Detected</div>
        <div class="ps-metric-value" style="font-size:15px;color:{C['blue_logo']};">{data.get('disorder_name','No disorder detected')}</div>
        <div class="ps-metric-sub">{data.get('disorder_short_desc','')}</div>
      </div>
    </div>
    {disorder_html}
  </div>

  <!-- Risk Analysis -->
  {risk_factors_html}

  <!-- Behavioural & Emotional Insights -->
  <div class="ps-card">
    <div class="ps-card-title"><div class="ps-card-title-bar"></div> Behavioural &amp; Emotional Insights</div>
    <div class="ps-insights-grid">{insights_html}</div>
  </div>

  <!-- Personalised Recommendations -->
  <div class="ps-card">
    <div class="ps-card-title"><div class="ps-card-title-bar"></div> Personalised Recommendations</div>
    <div class="ps-rec-grid">{recs_html}</div>
  </div>

  <!-- Next Steps -->
  <div class="ps-card">
    <div class="ps-card-title"><div class="ps-card-title-bar"></div> Next Steps</div>
    <div>{steps_html}</div>
  </div>

  <!-- Recommended Doctors -->
  {doctors_html}

  <!-- Disclaimer -->
  <div class="ps-disclaimer">
    <div class="ps-disclaimer-title">Ethical Disclaimer &amp; Important Notice</div>
    <div class="ps-disclaimer-body">
      This report is generated by PsychSense, an AI-powered mental health screening tool. It is intended for
      <strong>informational and supportive purposes only</strong> and does <strong>not</strong> constitute a clinical diagnosis,
      medical advice, or a substitute for professional psychiatric evaluation. Results may not account for all individual
      circumstances, cultural factors, or medical history. Always consult a licensed mental health professional before
      making any decisions regarding treatment. If you or someone you know is in immediate danger, please contact
      emergency services or a crisis helpline without delay.
    </div>
  </div>

  <!-- Footer -->
  <div class="ps-footer">
    <span>PsychSense AI · {report_id} · Confidential</span>
    <span>Generated {now.strftime('%d %B %Y')} · v2.1.0</span>
  </div>

</div>
</body>
</html>"""
    return html


@app.route("/generate-pdf", methods=["POST"])
def generate_pdf_endpoint():
    if not _WEASYPRINT_OK:
        return jsonify({"error": "WeasyPrint not installed on this server."}), 501

    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({"error": "Request body must be JSON."}), 400

        # Minimal required fields
        if "risk_level" not in data or "patient" not in data:
            return jsonify({"error": "Missing required fields: risk_level, patient"}), 400

        html_str = _build_report_html(data)
        pdf_bytes = _render_pdf(html_str)

        patient_name = data.get("patient", {}).get("name", "Patient").replace(" ", "_")
        filename = f"PsychSense_Report_{patient_name}.pdf"

        return Response(
            pdf_bytes,
            mimetype="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(pdf_bytes)),
            }
        )

    except Exception:
        traceback.print_exc()
        return jsonify({"error": "PDF generation failed."}), 500


# ─────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    app.run(host="0.0.0.0", port=port, debug=False)