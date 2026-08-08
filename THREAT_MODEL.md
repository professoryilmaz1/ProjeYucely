"""Deterministic v0 router used before an LLM fallback.
Production will combine rules + small classifier + policy checks + LLM only when needed.
"""
from dataclasses import dataclass, asdict
import re

@dataclass
class IntentResult:
    primary_intent: str
    confidence: float
    entities: dict
    risk_flags: list[str]
    route: str

MONEY_RE = re.compile(r"(?:\$\s*|usd\s+)(\d+(?:\.\d{1,2})?)", re.I)

def route_intent(text: str) -> dict:
    t = " ".join(text.lower().split())
    amount = None
    m = MONEY_RE.search(t)
    if m:
        amount = float(m.group(1))

    entities = {"amount": amount, "currency": "USD" if "$" in t or "usd" in t else None,
                "start_time": None, "end_time": None, "location_text": None, "task": text.strip()}
    risk_flags: list[str] = []

    # Safety/compliance flags; policy engine decides, router only flags.
    if any(x in t for x in ["doctor", "medical", "medicine", "lawyer", "attorney", "imam"]):
        risk_flags.append("POSSIBLY_REGULATED_OR_TRUST_ROLE")

    if any(x in t for x in ["evlen", "marry", "marriage", "relationship", "eş", "es ar"]):
        r = IntentResult("RELATIONSHIP_MATCH", .92, entities, risk_flags, "match_agent")
    elif any(x in t for x in ["save me", "tasarruf", "harcamayı azalt", "harcamayi azalt"]):
        r = IntentResult("SAVE_MONEY", .90, entities, risk_flags, "money_agent")
    elif any(x in t for x in ["what if", "ya olursa", "alırsam", "alirsam", "taşınırsam", "tasinirsam"]):
        r = IntentResult("WHAT_IF", .88, entities, risk_flags, "planner_agent")
    elif amount is not None and any(x in t for x in ["kazan", "kazanmam", "need $", "make $"]):
        r = IntentResult("MONEY_MISSION", .93, entities, risk_flags, "earn_agent")
    elif any(x in t for x in ["para kazan", "earn", "iş arıyorum", "is ariyorum", "boşum", "bosum", "available for work"]):
        r = IntentResult("EARN", .91, entities, risk_flags, "earn_agent")
    elif any(x in t for x in ["lazım", "lazim", "need", "bakıcı", "bakici", "yardım", "yardim"]):
        r = IntentResult("NEED_HELP", .88, entities, risk_flags, "need_agent")
    elif any(x in t for x in ["planla", "organize", "takvim", "schedule", "my day", "my week"]):
        r = IntentResult("PLAN_LIFE", .84, entities, risk_flags, "planner_agent")
    else:
        r = IntentResult("UNKNOWN", .35, entities, risk_flags, "human_review")
    return asdict(r)

if __name__ == "__main__":
    samples = [
        "Köpeğime 4 saat bakıcı lazım $40",
        "Bugün 1-5 arası boşum para kazanmak istiyorum",
        "Cuma gününe kadar $430 kazanmam lazım",
        "Evlenmek istiyorum, ciddi bir eş arıyorum"
    ]
    for s in samples:
        print(s, "=>", route_intent(s))
