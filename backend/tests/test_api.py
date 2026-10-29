import json

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import db, routes
from app.db import FAILED, PROCESSING, Candidate, Role, init_db, make_engine, set_engine
from app.llm import LLMError
from app.main import app

from .conftest import make_pdf
from .fakes import RESUME, RUBRIC, FakeLLMClient, eval_response


def respond(messages):
    """Route by prompt: rubric extraction vs evaluation."""
    if "<job_description>" in messages[1]["content"]:
        return json.dumps(RUBRIC)
    return json.dumps(eval_response())


@pytest.fixture
def fake():
    return FakeLLMClient(respond)


@pytest.fixture
def client(tmp_path, fake):
    set_engine(make_engine(f"sqlite:///{tmp_path / 'test.db'}"))
    app.dependency_overrides[routes.llm_dep] = lambda: fake
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def pdf():
    return ("cv.pdf", make_pdf(RESUME.splitlines()), "application/pdf")


def create_role(client):
    r = client.post("/api/roles", json={"title": "Senior Eng", "jd_markdown": "# JD\n- Python"})
    assert r.status_code == 201, r.text
    return r.json()


def test_full_flow(client):
    role = create_role(client)
    assert [q["id"] for q in role["rubric"]["requirements"]] == ["r1", "r2", "r3"]
    assert client.get("/api/roles").json()[0]["requirement_count"] == 3

    up = client.post(f"/api/roles/{role['id']}/candidates", files={"file": pdf()})
    assert up.status_code == 201, up.text
    assert up.json()["status"] == PROCESSING
    cid = up.json()["id"]

    # TestClient runs background tasks before returning.
    rows = client.get(f"/api/roles/{role['id']}/candidates").json()
    assert rows[0]["status"] == "done"
    assert rows[0]["baseline"]["status"] == "meets"
    assert rows[0]["score"]["total"] == 85
    assert rows[0]["candidate_name"] == "Jane Doe"

    detail = client.get(f"/api/candidates/{cid}").json()
    assert detail["model_id"] == "fake-model"
    assert detail["prompt_version"]
    assert detail["rubric_version"] == 1
    assert detail["stale"] is False

    r = client.patch(f"/api/candidates/{cid}", json={"decision": "advance", "note": "Strong"})
    assert r.json()["decision"] == "advance"

    # rubric edit -> stale
    reqs = [{"text": "5+ years of Python", "kind": "must"}]
    r = client.put(f"/api/roles/{role['id']}/rubric", json={"requirements": reqs})
    assert r.json()["rubric_version"] == 2
    assert client.get(f"/api/candidates/{cid}").json()["stale"] is True

    # re-evaluate keeps the human decision and clears stale
    assert client.post(f"/api/candidates/{cid}/reevaluate").status_code == 202
    detail = client.get(f"/api/candidates/{cid}").json()
    assert detail["stale"] is False and detail["decision"] == "advance"

    assert client.delete(f"/api/roles/{role['id']}").status_code == 204
    assert client.get(f"/api/candidates/{cid}").status_code == 404
    assert client.get("/api/roles").json() == []


def test_rubric_requires_must_have(client):
    role = create_role(client)
    r = client.put(
        f"/api/roles/{role['id']}/rubric",
        json={"requirements": [{"text": "Go", "kind": "nice"}]},
    )
    assert r.status_code == 422
    assert "must-have" in r.json()["detail"]


def test_role_created_even_if_extraction_fails(client):
    app.dependency_overrides[routes.llm_dep] = lambda: FakeLLMClient("garbage")
    role = create_role(client)
    assert role["rubric"]["requirements"] == []
    assert role["rubric_error"]
    up = client.post(f"/api/roles/{role['id']}/candidates", files={"file": pdf()})
    assert up.status_code == 409


@pytest.mark.parametrize(
    "file,code",
    [
        (("cv.txt", b"hello", "text/plain"), 415),
        (("cv.pdf", b"%PDF-1.4 broken", "application/pdf"), 422),
    ],
)
def test_upload_errors(client, file, code):
    role = create_role(client)
    r = client.post(f"/api/roles/{role['id']}/candidates", files={"file": file})
    assert r.status_code == code
    assert r.json()["detail"]


def test_upload_oversize(client, monkeypatch):
    monkeypatch.setattr(routes.get_settings(), "max_upload_mb", 0.0001)
    role = create_role(client)
    r = client.post(f"/api/roles/{role['id']}/candidates", files={"file": pdf()})
    assert r.status_code == 413


def test_llm_not_configured(client, monkeypatch):
    role = create_role(client)
    app.dependency_overrides.clear()

    def boom():
        raise LLMError("LLM not configured.")

    monkeypatch.setattr(routes, "get_llm", boom)
    r = client.post(f"/api/roles/{role['id']}/candidates", files={"file": pdf()})
    assert r.status_code == 503


def test_failed_evaluation_then_retry(client):
    role = create_role(client)
    app.dependency_overrides[routes.llm_dep] = lambda: FakeLLMClient("not json")
    cid = client.post(f"/api/roles/{role['id']}/candidates", files={"file": pdf()}).json()["id"]
    c = client.get(f"/api/candidates/{cid}").json()
    assert c["status"] == FAILED and "malformed" in c["error"]

    app.dependency_overrides[routes.llm_dep] = lambda: FakeLLMClient(respond)
    assert client.post(f"/api/candidates/{cid}/reevaluate").status_code == 202
    assert client.get(f"/api/candidates/{cid}").json()["status"] == "done"


def _insert_candidate(role_id: int, status: str) -> int:
    with Session(db.get_engine()) as s:
        c = Candidate(role_id=role_id, filename="x.pdf", resume_text=RESUME, status=status)
        s.add(c)
        s.commit()
        return c.id


def test_reevaluate_while_processing_is_409(client):
    role = create_role(client)
    cid = _insert_candidate(role["id"], PROCESSING)
    assert client.post(f"/api/candidates/{cid}/reevaluate").status_code == 409


def test_restart_recovery(client):
    role = create_role(client)
    cid = _insert_candidate(role["id"], PROCESSING)
    assert init_db() == 1
    c = client.get(f"/api/candidates/{cid}").json()
    assert c["status"] == FAILED and "Interrupted" in c["error"]


def test_delete_during_evaluation_is_harmless(client):
    role = create_role(client)
    cid = _insert_candidate(role["id"], PROCESSING)

    def delete_then_answer(messages):
        with Session(db.get_engine()) as s:
            s.delete(s.get(Candidate, cid))
            s.commit()
        return respond(messages)

    routes.run_evaluation(cid, FakeLLMClient(delete_then_answer))  # must not raise
    with Session(db.get_engine()) as s:
        assert s.get(Candidate, cid) is None


def test_task_never_overwrites_human_fields(client):
    role = create_role(client)
    cid = _insert_candidate(role["id"], PROCESSING)

    def decide_then_answer(messages):
        client.patch(f"/api/candidates/{cid}", json={"decision": "hold", "note": "mid-run"})
        return respond(messages)

    routes.run_evaluation(cid, FakeLLMClient(decide_then_answer))
    c = client.get(f"/api/candidates/{cid}").json()
    assert c["status"] == "done" and c["decision"] == "hold" and c["note"] == "mid-run"


def test_rubric_edit_mid_run_shows_stale(client):
    role = create_role(client)
    cid = _insert_candidate(role["id"], PROCESSING)

    def edit_then_answer(messages):
        with Session(db.get_engine()) as s:
            r = s.get(Role, role["id"])
            r.rubric_version += 1
            s.add(r)
            s.commit()
        return respond(messages)

    routes.run_evaluation(cid, FakeLLMClient(edit_then_answer))
    assert client.get(f"/api/candidates/{cid}").json()["stale"] is True


def test_health(client):
    body = client.get("/api/health").json()
    assert set(body) == {"llm_configured", "model_id"}
