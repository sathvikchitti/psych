import re

POSITIVE_VIBE_PATTERNS = [
    r"\bloving?\s+life\b", r"\bexcited?\b", r"\bexciting\b", r"\bamazing\b",
    r"\bgood\s+vibes?\b",   r"\bsmil(?:e|ing)\b", r"\benjoy(?:ing|ment|ed)?\b", r"\bconfident\b",
    r"\bthriving\b",      r"\bpositive\s+energy\b", r"\bproud\s+of\s+myself\b",
    r"\bhappy\b",         r"\bjoy(?:ful|ous)?\b", r"\bwonderful\b",   r"\bthrive\b",
    r"\bprosper\b",       r"\bfull\s+of\s+possibilities\b", r"\bbest\s+is\s+yet\s+to\s+come\b",
    r"\bfeeling\s+(?:really\s+)?good\b", r"\bdoing\s+(?:really\s+)?well\b",
    r"\bliving\s+in\s+the\s+moment\b", r"\bfeeling\s+great\b", r"\bdoing\s+great\b",
]

# Patterns for simpler hits on the user's current specific text
SPECIFIC_HAPPY_PHRASES = [
    r"\bfeel\s+really\s+good\b",
    r"\bdoing\s+well\b",
    r"\benjoying\b",
    r"\bliving\s+in\s+the\s+moment\b"
]

DEPRESSIVE_MARKER_PATTERNS = [
    r"\bsad\b",           r"\bdepressed\b",    r"\bhopeless\b",    r"\bworthless\b",
    r"\bmiserable\b",     r"\bempty\b",        r"\bhurt\b",        r"\bpain\b",
    r"\bsuicide\b",       r"\bkill\s+myself\b", r"\bend\s+it\s+all\b",
]

def check_sentiment_guardrail(text: str) -> bool:
    if not text or not text.strip():
        return False
    text_lower = text.lower()
    pos_hits = sum(len(re.findall(pat, text_lower)) for pat in POSITIVE_VIBE_PATTERNS + SPECIFIC_HAPPY_PHRASES)
    neg_hits = sum(len(re.findall(pat, text_lower)) for pat in DEPRESSIVE_MARKER_PATTERNS)
    print(f"Positive Hits: {pos_hits}, Negative Hits: {neg_hits}")
    return pos_hits >= 2 and neg_hits == 0

user_text = "I feel really good these days I have been coping up lately and doing well I am simply living in the moment and enjoying them"
result = check_sentiment_guardrail(user_text)
print(f"Guardrail triggered: {result}")
