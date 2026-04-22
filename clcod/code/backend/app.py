# ╔══════════════════════════════════════════════════════════════════════╗
# ║  PsychSense — Flask Backend  (v3 — Audio + Text + Cognitive)        ║
# ║  Model : AudioTextFusionNet (WavLM + RoBERTa + CognitiveFeatures)  ║
# ║  Checkpoint : model_new_feature.pt  (saved by v3 training code)    ║
# ║                                                                      ║
# ║  TEXT_DIM = 778  (RoBERTa-768 + 5 distortions + 4 coping + 1 risk) ║
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
from flask import Flask, request, jsonify
from flask_cors import CORS
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

# Audio
SR        = 16_000
CHUNK_SEC = 10
MAX_DUR   = 300

# Text (sliding window — must match v3 training)
MAX_TEXT_LEN = 512
TEXT_STRIDE  = 384

# Cognitive feature dimensions  (must match training)
N_DISTORTIONS = 5
N_COPING      = 4
N_RISK        = 1
TEXT_DIM_BASE = 768   # RoBERTa base hidden size
# Full TEXT_DIM = 778 — read from checkpoint after load

print(f"[PsychSense] Device: {DEVICE}  |  FP16: {FP16}")

# ─────────────────────────────────────────────────────────────────────
# COGNITIVE DISTORTION + COPING MECHANISM PATTERNS  (identical to v3)
# ─────────────────────────────────────────────────────────────────────

DISTORTION_PATTERNS = {
    "overgeneralization": [
        r"\balways\b", r"\bnever\b", r"\beveryone\b", r"\bno\s+one\b",
        r"\bnothing\b", r"\beverything\b", r"\bforever\b", r"\bconstantly\b",
        r"\ball\s+the\s+time\b", r"\bevery\s+time\b", r"\bnobody\b",
        r"\bentirely\b", r"\bcompletely\b", r"\bwholly\b",
    ],
    "catastrophizing": [
        r"\bworst\b", r"\bruined\b", r"\beverything\s+is\s+over\b",
        r"\bterrible\b", r"\bdisaster\b", r"\bhopeless\b", r"\bdesperate\b",
        r"\bdestroyed\b", r"\bcollapsed\b", r"\bundone\b", r"\bpointless\b",
        r"\bunbearable\b", r"\boverwhelmed\b", r"\bcan.t\s+take\s+it\b",
        r"\bgive\s+up\b", r"\bgave\s+up\b", r"\bno\s+way\s+out\b",
    ],
    "personalization": [
        r"\bmy\s+fault\b", r"\bi\s+caused\b", r"\bi\s+am\s+useless\b",
        r"\bi.m\s+useless\b", r"\bbecause\s+of\s+me\b", r"\bi\s+ruined\b",
        r"\bi\s+broke\b", r"\bi\s+destroyed\b", r"\bi\s+should\s+have\b",
        r"\bi\s+shouldn.t\s+have\b", r"\bi\s+let\b", r"\bi\s+blew\b",
        r"\bblame\s+myself\b", r"\bi.m\s+responsible\b",
        r"\ball\s+my\s+fault\b", r"\bi\s+failed\b",
    ],
    "negative_self_labeling": [
        r"\bi\s+am\s+worthless\b", r"\bi.m\s+worthless\b",
        r"\bi\s+am\s+a\s+failure\b", r"\bi.m\s+a\s+failure\b",
        r"\bi\s+am\s+stupid\b",     r"\bi.m\s+stupid\b",
        r"\bi\s+am\s+ugly\b",       r"\bi.m\s+ugly\b",
        r"\bi\s+am\s+broken\b",     r"\bi.m\s+broken\b",
        r"\bi\s+am\s+pathetic\b",   r"\bi.m\s+pathetic\b",
        r"\bi\s+am\s+a\s+burden\b", r"\bi.m\s+a\s+burden\b",
        r"\bi\s+am\s+nothing\b",    r"\bi.m\s+nothing\b",
        r"\bi\s+hate\s+myself\b",   r"\bi\s+don.t\s+deserve\b",
        r"\bi\s+am\s+weak\b",       r"\bi.m\s+weak\b",
        r"\bi\s+am\s+incompetent\b",r"\bi\s+am\s+awful\b",
    ],
    "emotional_reasoning": [
        r"\bi\s+feel\s+like\s+a\s+failure\b",
        r"\bi\s+feel\s+hopeless\b",  r"\bi\s+feel\s+worthless\b",
        r"\bi\s+feel\s+empty\b",     r"\bi\s+feel\s+nothing\b",
        r"\bi\s+just\s+know\b",      r"\bi\s+know\s+it\s+will\b",
        r"\bi\s+know\s+i.ll\b",
        r"\bsomething\s+must\s+be\s+wrong\s+with\s+me\b",
        r"\bif\s+i\s+feel\s+bad\b",  r"\bfeeling\s+so\s+bad\b",
    ],
}

COPING_PATTERNS = {
    "help_seeking": [
        r"\btalked\s+to\s+someone\b", r"\basked\s+for\s+help\b",
        r"\bsought\s+help\b",         r"\bspoke\s+to\b",
        r"\breached\s+out\b",         r"\bcalled\s+someone\b",
        r"\bsaw\s+a\s+therapist\b",   r"\bsaw\s+my\s+doctor\b",
        r"\bwent\s+to\s+therapy\b",   r"\bsupport\s+group\b",
        r"\btold\s+my\b",             r"\bshared\s+with\b",
        r"\bopened\s+up\b",           r"\bconfided\b",
    ],
    "problem_solving": [
        r"\btrying\s+to\s+fix\b",  r"\bworking\s+on\s+it\b",
        r"\bmade\s+a\s+plan\b",    r"\bset\s+a\s+goal\b",
        r"\bfigured\s+out\b",      r"\bsolved\b",
        r"\btook\s+action\b",      r"\bstepped\s+up\b",
        r"\bhandled\s+it\b",       r"\bmanaged\s+it\b",
        r"\bdecided\s+to\b",       r"\bstarted\s+to\b",
        r"\btaking\s+steps\b",     r"\bworking\s+through\b",
        r"\baddressing\b",
    ],
    "positive_reframing": [
        r"\bit\s+will\s+get\s+better\b", r"\bstaying\s+hopeful\b",
        r"\blooking\s+on\s+the\s+bright\b", r"\bsilver\s+lining\b",
        r"\bthings\s+will\s+improve\b",  r"\bcan\s+get\s+through\b",
        r"\bi\s+will\s+be\s+okay\b",     r"\bi.ll\s+be\s+okay\b",
        r"\bnot\s+giving\s+up\b",        r"\bstill\s+hopeful\b",
        r"\blearned\s+from\b",           r"\bgrew\s+from\b",
        r"\bopportunity\s+to\b",         r"\bgrateful\s+for\b",
        r"\bthankful\s+for\b",           r"\bpositive\s+side\b",
    ],
    "emotional_expression": [
        r"\bi\s+feel\s+sad\b",     r"\bi\s+am\s+sad\b",    r"\bi.m\s+sad\b",
        r"\bi\s+feel\s+angry\b",   r"\bi\s+am\s+angry\b",
        r"\bi\s+feel\s+upset\b",   r"\bi\s+am\s+upset\b",
        r"\bi\s+feel\s+scared\b",  r"\bi\s+am\s+scared\b",
        r"\bi\s+feel\s+anxious\b", r"\bi\s+am\s+anxious\b",
        r"\bi\s+cried\b",          r"\bi\s+was\s+crying\b",
        r"\blet\s+it\s+out\b",     r"\bexpressed\s+my\b",
        r"\blet\s+myself\s+feel\b",
    ],
}

DISTORTION_DISPLAY = {
    "overgeneralization":     "Overgeneralization",
    "catastrophizing":        "Catastrophizing",
    "personalization":        "Personalization",
    "negative_self_labeling": "Negative Self-Labeling",
    "emotional_reasoning":    "Emotional Reasoning",
}
COPING_DISPLAY = {
    "help_seeking":         "Help Seeking",
    "problem_solving":      "Problem Solving",
    "positive_reframing":   "Positive Reframing",
    "emotional_expression": "Emotional Expression",
}


# ─────────────────────────────────────────────────────────────────────
# UTILS
# ─────────────────────────────────────────────────────────────────────

def safe_clean(arr, clip=1e6):
    arr = np.array(arr, dtype=np.float32)
    arr[~np.isfinite(arr)] = 0.0
    return np.clip(arr, -clip, clip).astype(np.float32)


# ─────────────────────────────────────────────────────────────────────
# COGNITIVE FEATURE EXTRACTION  (identical logic to v3 training code)
# ─────────────────────────────────────────────────────────────────────

def extract_cognitive_features(text: str) -> np.ndarray:
    """
    Extract a 10-dim cognitive feature vector from raw text.
    Layout: [d1..d5, c1..c4, risk]  — identical to v3 training.
    """
    zero = np.zeros(N_DISTORTIONS + N_COPING + N_RISK, dtype=np.float32)
    if not text or not isinstance(text, str) or not text.strip():
        return zero

    text_lower = text.lower()
    try:
        words = nltk.word_tokenize(text_lower)
    except Exception:
        words = text_lower.split()
    word_count = max(len(words), 1)

    if word_count < 5:
        return zero

    distortion_scores = {}
    for name, patterns in DISTORTION_PATTERNS.items():
        count = sum(len(re.findall(pat, text_lower)) for pat in patterns)
        distortion_scores[name] = count / word_count

    coping_scores = {}
    for name, patterns in COPING_PATTERNS.items():
        count = sum(len(re.findall(pat, text_lower)) for pat in patterns)
        coping_scores[name] = count / word_count

    sum_d = sum(distortion_scores.values())
    sum_c = sum(coping_scores.values())
    risk  = float(np.clip(sum_d - sum_c, 0.0, 1.0))

    d_vec = np.array([
        distortion_scores["overgeneralization"],
        distortion_scores["catastrophizing"],
        distortion_scores["personalization"],
        distortion_scores["negative_self_labeling"],
        distortion_scores["emotional_reasoning"],
    ], dtype=np.float32)

    c_vec = np.array([
        coping_scores["help_seeking"],
        coping_scores["problem_solving"],
        coping_scores["positive_reframing"],
        coping_scores["emotional_expression"],
    ], dtype=np.float32)

    r_vec = np.array([risk], dtype=np.float32)
    return safe_clean(np.concatenate([d_vec, c_vec, r_vec]))


def integrate_into_pipeline(roberta_embedding: np.ndarray,
                             raw_text: str) -> np.ndarray:
    """Concatenate RoBERTa(768) + cognitive(10) → 778-dim text vector."""
    cog = extract_cognitive_features(raw_text)
    return safe_clean(np.concatenate([roberta_embedding, cog]).astype(np.float32))


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
    print("[PsychSense] Loading checkpoint …")
    if not os.path.exists(CHECKPOINT_PATH):
        raise FileNotFoundError(
            f"Checkpoint not found at '{CHECKPOINT_PATH}'.\n"
            f"Set MODEL_PATH env var to the correct .pt file path.\n"
            f"Expected checkpoint saved by v3 training as 'model_new_feature.pt'."
        )

    ckpt            = torch.load(CHECKPOINT_PATH, map_location="cpu", weights_only=False)
    AUDIO_DIM_      = ckpt["AUDIO_DIM"]
    TEXT_DIM_       = ckpt["TEXT_DIM"]           # 778
    TEXT_DIM_BASE_  = ckpt.get("TEXT_DIM_BASE", 768)
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
    print(f"[PsychSense] AudioTextFusionNet loaded  threshold={threshold_:.2f}")
    print(f"[PsychSense]   AUDIO_DIM={AUDIO_DIM_}  TEXT_DIM={TEXT_DIM_} "
          f"(RoBERTa={TEXT_DIM_BASE_} + cognitive={TEXT_DIM_ - TEXT_DIM_BASE_})")

    # ── WavLM ─────────────────────────────────────────────────────────
    print("[PsychSense] Loading WavLM-base-plus …")
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
        print(f"[PsychSense] WavLM: patched {len(ckpt['wavlm_ft_state'])} fine-tuned "
              f"keys (last {n_layers} layers) — {len(missing)} frozen keys kept from base")
        if unexpected:
            print(f"[PsychSense] WavLM WARNING: unexpected keys in checkpoint: {unexpected}")
    elif "wavlm_state" in ckpt:
        # Backwards-compat: old checkpoint with full state dict
        wavlm.load_state_dict(ckpt["wavlm_state"])
        print("[PsychSense] WavLM: loaded full state dict from checkpoint (legacy format)")
    else:
        print("[PsychSense] WARNING: no WavLM weights in checkpoint — "
              "using vanilla pretrained weights. Re-train to save fine-tuned layers.")

    wavlm.eval()
    for p in wavlm.parameters():
        p.requires_grad = False
    if FP16:
        wavlm = wavlm.half()
    wavlm = wavlm.to(DEVICE)
    print("[PsychSense] WavLM loaded")

    # ── RoBERTa ───────────────────────────────────────────────────────
    print("[PsychSense] Loading RoBERTa-base …")
    TEXT_MODEL    = "roberta-base"
    roberta_tok   = RobertaTokenizer.from_pretrained(TEXT_MODEL, **_hf_kwargs)
    roberta_model = RobertaModel.from_pretrained(TEXT_MODEL, **_hf_kwargs)

    if "roberta_ft_state" in ckpt:
        missing, unexpected = roberta_model.load_state_dict(
            ckpt["roberta_ft_state"], strict=False
        )
        n_layers = ckpt.get("ROBERTA_UNFREEZE_LAYERS", "?")
        print(f"[PsychSense] RoBERTa: patched {len(ckpt['roberta_ft_state'])} fine-tuned "
              f"keys (last {n_layers} layers + pooler) — {len(missing)} frozen keys kept from base")
        if unexpected:
            print(f"[PsychSense] RoBERTa WARNING: unexpected keys in checkpoint: {unexpected}")
    elif "roberta_state" in ckpt:
        # Backwards-compat: old checkpoint with full state dict
        roberta_model.load_state_dict(ckpt["roberta_state"])
        print("[PsychSense] RoBERTa: loaded full state dict from checkpoint (legacy format)")
    else:
        print("[PsychSense] WARNING: no RoBERTa weights in checkpoint — "
              "using vanilla pretrained weights. Re-train to save fine-tuned layers.")

    roberta_model.eval()
    for p in roberta_model.parameters():
        p.requires_grad = False
    if FP16:
        roberta_model = roberta_model.half()
    roberta_model = roberta_model.to(DEVICE)
    print("[PsychSense] RoBERTa loaded")

    return (model,
            AUDIO_DIM_, TEXT_DIM_, TEXT_DIM_BASE_,
            threshold_,
            sc_audio_, sc_text_,
            wav_feat, wavlm,
            roberta_tok, roberta_model)


(MODEL,
 AUDIO_DIM, TEXT_DIM, TEXT_DIM_BASE_LOADED,
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
    RoBERTa sliding-window [CLS] mean-pool (stride=384) → 768-dim,
    then appended with 10-dim cognitive features → TEXT_DIM (778)-dim.

    Uses identical sliding-window logic as v3 training.
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
        roberta_emb = np.zeros(TEXT_DIM_BASE_LOADED, dtype=np.float32)

    # Append 10-dim cognitive features → 778-dim total
    return integrate_into_pipeline(roberta_emb, text)


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
    # Cognitive is a sub-slice of text (already counted inside text).
    # Surface it for display by carving it out of the text slice so the
    # four bars always add up to exactly 100%.
    cog_slice = round(contribs.get("text", 0) * 0.15)
    contribs["cognitive"] = cog_slice
    contribs["text"]      = contribs.get("text", 0) - cog_slice
    diff = 100 - (contribs["text"] + contribs["audio"] + contribs["questionnaire"] + contribs["cognitive"])
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
# COGNITIVE INSIGHT BUILDER  (new — surfaces distortion/coping to UI)
# ─────────────────────────────────────────────────────────────────────

def build_cognitive_insights(text: str, p_dep: float) -> list:
    """
    Generate human-readable cognitive distortion + coping insight strings
    from the same feature vector that was fed into the model.
    """
    if not text or not text.strip():
        return ["No text provided — cognitive distortion analysis not available."]

    cog      = extract_cognitive_features(text)
    d_names  = list(DISTORTION_PATTERNS.keys())
    c_names  = list(COPING_PATTERNS.keys())
    d_scores = cog[:N_DISTORTIONS]
    c_scores = cog[N_DISTORTIONS:N_DISTORTIONS + N_COPING]
    risk     = float(cog[-1])

    points = []

    # Dominant distortion
    if d_scores.max() > 0:
        dom_d_key = d_names[int(np.argmax(d_scores))]
        dom_d_val = float(d_scores.max()) * 100
        points.append(
            f"Dominant cognitive distortion: {DISTORTION_DISPLAY[dom_d_key]} "
            f"({dom_d_val:.1f}% pattern density)."
        )
    else:
        points.append("No significant cognitive distortions detected in language.")

    # Dominant coping
    if c_scores.max() > 0:
        dom_c_key = c_names[int(np.argmax(c_scores))]
        dom_c_val = float(c_scores.max()) * 100
        points.append(
            f"Primary coping mechanism: {COPING_DISPLAY[dom_c_key]} "
            f"({dom_c_val:.1f}% pattern density)."
        )
    else:
        points.append("No strong coping mechanism signals detected in language.")

    # Risk score
    if risk >= 0.5:
        points.append(
            f"Cognitive risk score is elevated ({risk:.2f}) — distortion patterns "
            "significantly outweigh coping signals."
        )
    elif risk >= 0.2:
        points.append(
            f"Moderate cognitive risk ({risk:.2f}) — distortions partially offset "
            "by coping language."
        )
    else:
        points.append(
            f"Low cognitive risk ({risk:.2f}) — balanced or positive cognitive patterns."
        )

    return points


# ─────────────────────────────────────────────────────────────────────
# CORE PREDICT
# ─────────────────────────────────────────────────────────────────────

def predict(text, audio_path, q):
    has_audio = audio_path is not None
    has_text  = bool(text and text.strip())

    # ── Feature extraction ────────────────────────────────────────────
    ae = extract_audio_embedding(audio_path) if has_audio \
         else np.zeros(AUDIO_DIM, dtype=np.float32)

    # Text embedding = RoBERTa(768) + cognitive(10) = 778-dim
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
    # FIX ISSUE 5: Use the F1-tuned threshold directly from the checkpoint.
    # Previously MODERATE_THRESHOLD was hard-floored at 0.60, silently
    # discarding the validation-tuned value. If the tuned threshold was 0.44,
    # that override changed the decision boundary without any principled basis.
    # If you observe too many false positives, the correct fix is to raise
    # the precision constraint in find_best_threshold() (e.g. precision >= 0.40)
    # and re-train — not to override the threshold post-hoc in production.
    MODERATE_THRESHOLD = float(THRESHOLD)

    # High Risk band sits 0.10 above Moderate
    HIGH_THRESHOLD = MODERATE_THRESHOLD + 0.10

    # ── Guardrail for Non-Clinical / Extremely Short Text ─────────────
    # FIX ISSUE 7: align word_count guard with training code (< 5, not <= 5)
    if not has_audio and has_text:
        word_count = len(text.split())
        cog = extract_cognitive_features(text)
        cognitive_risk = float(cog[-1])

        # Training uses `word_count < 5` — match exactly to avoid off-by-one
        if word_count < 5 and cognitive_risk == 0.0:
            p_dep = min(p_dep, MODERATE_THRESHOLD - 0.10)

    MODERATE_BAND = HIGH_THRESHOLD - MODERATE_THRESHOLD

    # ── Diagnostic log (visible in backend console) ───────────────────
    print(f"[CLASSIFY] p_dep={p_dep:.4f}  "
          f"MODERATE_THRESHOLD={MODERATE_THRESHOLD:.4f}  "
          f"HIGH_THRESHOLD={HIGH_THRESHOLD:.4f}")

    if p_dep >= HIGH_THRESHOLD:
        risk_level       = "High"
        # +1 to avoid 0.0 confidence right at the boundary
        confidence_score = round(
            min((p_dep - HIGH_THRESHOLD) / (1.0 - HIGH_THRESHOLD) * 100 + 1, 99), 1
        )
    elif p_dep >= MODERATE_THRESHOLD:
        risk_level       = "Moderate"
        confidence_score = round(
            min((p_dep - MODERATE_THRESHOLD) / MODERATE_BAND * 100 + 1, 99), 1
        )
    else:
        risk_level       = "Low"
        confidence_score = round(
            (MODERATE_THRESHOLD - p_dep) / MODERATE_THRESHOLD * 100, 1
        )

    # ── Build response payload ────────────────────────────────────────
    contribs  = questionnaire_contribution(q, has_audio, has_text)
    signals   = derive_signals(p_dep, risk_level, q)
    recs      = get_recommendations(risk_level, q)
    q_points  = build_questionnaire_insights(q)
    cog_pts   = build_cognitive_insights(text, p_dep) if has_text else [
        "No text provided — cognitive analysis unavailable."
    ]

    text_points = []
    if has_text:
        word_count = len(text.split())
        text_points.append(
            f"Analysed {word_count} words via RoBERTa with "
            f"cognitive distortion overlay (TEXT_DIM={TEXT_DIM})."
        )
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

    adet = None
    if has_text:
        cog = extract_cognitive_features(text)
        d_scores = cog[:N_DISTORTIONS]
        c_scores = cog[N_DISTORTIONS:N_DISTORTIONS + N_COPING]
        risk     = float(cog[-1])
        
        d_names = list(DISTORTION_PATTERNS.keys())
        c_names = list(COPING_PATTERNS.keys())
        
        DISTORTION_DESC = {
            "overgeneralization": "Applying a single negative event to all future experiences.",
            "catastrophizing": "Expecting the worst possible outcome.",
            "personalization": "Taking blame for events outside of personal control.",
            "negative_self_labeling": "Assigning extreme, negative labels to oneself.",
            "emotional_reasoning": "Believing negative feelings reflect objective truth."
        }
        COPING_DESC = {
            "help_seeking": "Actively seeking assistance or emotional support.",
            "problem_solving": "Taking concrete steps to resolve issues.",
            "positive_reframing": "Finding positive aspects in challenging situations.",
            "emotional_expression": "Healthy articulation of emotions."
        }
        
        adet_distortions = []
        for i, name in enumerate(d_names):
            if d_scores[i] > 0:
                adet_distortions.append({
                    "name": DISTORTION_DISPLAY[name],
                    "density": float(d_scores[i]),
                    "description": DISTORTION_DESC[name]
                })
        
        adet_coping = []
        for i, name in enumerate(c_names):
            if c_scores[i] > 0:
                adet_coping.append({
                    "name": COPING_DISPLAY[name],
                    "density": float(c_scores[i]),
                    "description": COPING_DESC[name]
                })

        adet = {
            "distortions": adet_distortions,
            "coping": adet_coping,
            # FIX ISSUE 4: Keep cognitive_risk_score in [0, 1] to match training.
            # Previously multiplied by 10 with no documentation; if the frontend
            # expects [0, 1] this caused numeric anomalies. If the UI does need
            # a [0, 10] scale, do the conversion in the frontend explicitly.
            "cognitive_risk_score": risk,
            "audio_features": audio_points
        }

    return {
        "riskLevel":        risk_level,
        "confidenceScore":  confidence_score,
        "contributions":    contribs,
        "emotionalSignals": signals,
        "insights": {
            "text":          {"points": text_points},
            "cognitive":     {"points": cog_pts},
            "audio":         {"points": audio_points},
            "questionnaire": {"points": q_points},
        },
        "adet":             adet,
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
    return jsonify({
        "status":   "ok",
        "device":   str(DEVICE),
        "model":    "AudioTextFusionNet-v3",
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
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    app.run(host="0.0.0.0", port=port, debug=False)