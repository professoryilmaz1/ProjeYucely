{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "YucelyWorkflow",
  "type": "object",
  "required": [
    "id",
    "request_id",
    "user_id",
    "intent",
    "policy",
    "state",
    "next_action",
    "created_at"
  ],
  "properties": {
    "id": {
      "type": "string"
    },
    "request_id": {
      "type": "string"
    },
    "user_id": {
      "type": "string"
    },
    "intent": {
      "type": "object"
    },
    "state": {
      "enum": [
        "CREATED",
        "POLICY_CHECKED",
        "READY",
        "NEEDS_APPROVAL",
        "BLOCKED"
      ]
    },
    "next_action": {
      "type": "string"
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "policy": {
      "type": "object",
      "required": [
        "outcome",
        "reasons"
      ],
      "properties": {
        "outcome": {
          "enum": [
            "ALLOW",
            "REQUIRE_APPROVAL",
            "BLOCK"
          ]
        },
        "reasons": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
