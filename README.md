{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "YucelyIntent",
  "type": "object",
  "required": ["primary_intent", "confidence", "entities", "risk_flags", "route"],
  "properties": {
    "primary_intent": {
      "enum": ["NEED_HELP", "EARN", "MONEY_MISSION", "SAVE_MONEY", "PLAN_LIFE", "WHAT_IF", "RELATIONSHIP_MATCH", "OPPORTUNITY", "SUPPORT", "UNKNOWN"]
    },
    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    "entities": {
      "type": "object",
      "properties": {
        "amount": {"type": ["number", "null"]},
        "currency": {"type": ["string", "null"]},
        "start_time": {"type": ["string", "null"]},
        "end_time": {"type": ["string", "null"]},
        "location_text": {"type": ["string", "null"]},
        "task": {"type": ["string", "null"]}
      },
      "additionalProperties": true
    },
    "risk_flags": {"type": "array", "items": {"type": "string"}},
    "route": {
      "enum": ["need_agent", "earn_agent", "money_agent", "planner_agent", "match_agent", "opportunity_agent", "support_agent", "human_review"]
    }
  },
  "additionalProperties": false
}
