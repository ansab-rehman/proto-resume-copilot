import json


class FakeLLMClient:
    """Scripted responses; each item is a str, a dict (JSON-encoded) or a callable(messages)."""

    model_id = "fake-model"

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls: list[list[dict]] = []

    def complete(self, messages, schema):
        self.calls.append([dict(m) for m in messages])
        r = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        if callable(r):
            r = r(messages)
        return r if isinstance(r, str) else json.dumps(r)


RESUME = """Jane Doe
Senior engineer. 6 years of Python and FastAPI building APIs.
Built React + TypeScript dashboards. Worked alongside the AWS team.
"""

RUBRIC = {
    "requirements": [
        {"text": "5+ years of Python", "kind": "must"},
        {"text": "React with TypeScript", "kind": "must"},
        {"text": "Hands-on AWS", "kind": "nice"},
    ]
}


def eval_response(**overrides):
    base = {
        "candidate_name": "Jane Doe",
        "summary": "Backend-leaning engineer.",
        "verdicts": [
            {
                "requirement_id": "r1",
                "verdict": "met",
                "quote": "6 years of Python and FastAPI",
                "rationale": "6 years.",
            },
            {
                "requirement_id": "r2",
                "verdict": "met",
                "quote": "Built React + TypeScript dashboards",
                "rationale": "Stated.",
            },
            {
                "requirement_id": "r3",
                "verdict": "partial",
                "quote": "Worked alongside the AWS team",
                "rationale": "Adjacent only.",
            },
        ],
        "highlights": [{"title": "API design", "quote": "building APIs"}],
        "interview_questions": ["What did you personally build on AWS?"],
    }
    base.update(overrides)
    return base
