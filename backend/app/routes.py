import logging
import time
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, update
from sqlmodel import Session, select

from . import db
from .config import get_settings
from .db import DONE, FAILED, PROCESSING, Candidate, Role, get_session
from .evaluation import (
    PROMPT_VERSION,
    Requirement,
    Rubric,
    evaluate,
    extract_rubric,
    finalize_rubric,
)
from .llm import LLMClient, LLMError, get_llm
from .parsing import ParseError, extract_text

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

Decision = Literal["new", "advance", "hold", "reject"]


def llm_dep() -> LLMClient:
    try:
        return get_llm()
    except LLMError as e:
        raise HTTPException(503, str(e)) from e


# ---------- helpers ----------


def _role_or_404(s: Session, role_id: int) -> Role:
    role = s.get(Role, role_id)
    if not role:
        raise HTTPException(404, "Role not found.")
    return role


def _candidate_or_404(s: Session, candidate_id: int) -> Candidate:
    c = s.get(Candidate, candidate_id)
    if not c:
        raise HTTPException(404, "Candidate not found.")
    return c


def _role_out(role: Role, **extra) -> dict:
    return {
        "id": role.id,
        "title": role.title,
        "jd_markdown": role.jd_markdown,
        "rubric": role.rubric,
        "rubric_version": role.rubric_version,
        "created_at": role.created_at,
        **extra,
    }


def _is_stale(c: Candidate, role: Role) -> bool:
    return c.status == DONE and (c.rubric_version or 0) < role.rubric_version


def _candidate_summary(c: Candidate, role: Role) -> dict:
    ev = c.evaluation or {}
    highlights = ev.get("highlights") or []
    return {
        "id": c.id,
        "role_id": c.role_id,
        "filename": c.filename,
        "status": c.status,
        "error": c.error,
        "decision": c.decision,
        "note": c.note,
        "created_at": c.created_at,
        "stale": _is_stale(c, role),
        "candidate_name": ev.get("candidate_name"),
        "baseline": ev.get("baseline"),
        "score": ev.get("score"),
        "top_highlight": highlights[0]["title"] if highlights else None,
    }


# ---------- evaluation task ----------


def run_evaluation(candidate_id: int, llm: LLMClient) -> None:
    """Background task. Writes only its own fields, and only while the row is still processing."""
    start = time.monotonic()
    with Session(db.get_engine()) as s:
        c = s.get(Candidate, candidate_id)
        role = s.get(Role, c.role_id) if c else None
        if not c or not role or c.status != PROCESSING:
            return
        rubric = Rubric.model_validate(role.rubric)
        rubric_version = role.rubric_version  # captured now so mid-run edits show as stale
        resume_text = c.resume_text

    try:
        result = evaluate(llm, rubric, resume_text)
        values = dict(
            status=DONE,
            error=None,
            evaluation=result,
            model_id=llm.model_id,
            prompt_version=PROMPT_VERSION,
            rubric_version=rubric_version,
        )
    except LLMError as e:
        values = dict(status=FAILED, error=str(e))
    except Exception:
        log.exception("evaluation crashed candidate=%s", candidate_id)
        values = dict(status=FAILED, error="Unexpected error during evaluation. Retry.")

    with Session(db.get_engine()) as s:
        res = s.exec(
            update(Candidate)
            .where(Candidate.id == candidate_id, Candidate.status == PROCESSING)
            .values(**values)
        )
        s.commit()
    log.info(
        "evaluation candidate=%s status=%s written=%s latency_ms=%d",
        candidate_id,
        values["status"],
        bool(res.rowcount),
        (time.monotonic() - start) * 1000,
    )


# ---------- health ----------


@router.get("/health")
def health():
    s = get_settings()
    return {"llm_configured": s.llm_configured, "model_id": s.llm_model}


# ---------- roles ----------


class RoleIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    jd_markdown: str = Field(min_length=1, max_length=50_000)


class RequirementIn(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    kind: Literal["must", "nice"]


class RubricIn(BaseModel):
    requirements: list[RequirementIn] = Field(max_length=25)


@router.post("/roles", status_code=201)
def create_role(body: RoleIn, s: Session = Depends(get_session), llm=Depends(llm_dep)):
    """Create the role and draft a rubric from the JD. If drafting fails the role is still
    created with an empty rubric, so the hiring manager can write one or retry."""
    rubric_error = None
    try:
        rubric = extract_rubric(llm, body.jd_markdown).model_dump()
    except LLMError as e:
        rubric, rubric_error = {"requirements": []}, str(e)
    role = Role(title=body.title.strip(), jd_markdown=body.jd_markdown, rubric=rubric)
    s.add(role)
    s.commit()
    s.refresh(role)
    return _role_out(role, rubric_error=rubric_error)


@router.get("/roles")
def list_roles(s: Session = Depends(get_session)):
    counts = dict(s.exec(select(Candidate.role_id, func.count()).group_by(Candidate.role_id)).all())
    roles = s.exec(select(Role).order_by(Role.created_at.desc())).all()
    return [
        {
            "id": r.id,
            "title": r.title,
            "created_at": r.created_at,
            "candidate_count": counts.get(r.id, 0),
            "requirement_count": len(r.rubric.get("requirements", [])),
        }
        for r in roles
    ]


@router.get("/roles/{role_id}")
def get_role(role_id: int, s: Session = Depends(get_session)):
    return _role_out(_role_or_404(s, role_id))


@router.post("/roles/{role_id}/rubric/extract")
def regenerate_rubric(role_id: int, s: Session = Depends(get_session), llm=Depends(llm_dep)):
    role = _role_or_404(s, role_id)
    try:
        rubric = extract_rubric(llm, role.jd_markdown)
    except LLMError as e:
        raise HTTPException(502, str(e)) from e
    role.rubric = rubric.model_dump()
    role.rubric_version += 1
    s.add(role)
    s.commit()
    s.refresh(role)
    return _role_out(role)


@router.put("/roles/{role_id}/rubric")
def update_rubric(role_id: int, body: RubricIn, s: Session = Depends(get_session)):
    role = _role_or_404(s, role_id)
    try:
        rubric = finalize_rubric(
            Rubric(requirements=[Requirement(**r.model_dump()) for r in body.requirements])
        )
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    role.rubric = rubric.model_dump()
    role.rubric_version += 1
    s.add(role)
    s.commit()
    s.refresh(role)
    return _role_out(role)


@router.delete("/roles/{role_id}", status_code=204)
def delete_role(role_id: int, s: Session = Depends(get_session)):
    role = _role_or_404(s, role_id)
    s.exec(delete(Candidate).where(Candidate.role_id == role_id))
    s.delete(role)
    s.commit()


# ---------- candidates ----------


@router.post("/roles/{role_id}/candidates", status_code=201)
def upload_candidate(
    role_id: int,
    file: UploadFile,
    tasks: BackgroundTasks,
    s: Session = Depends(get_session),
    llm=Depends(llm_dep),
):
    role = _role_or_404(s, role_id)
    if not any(r["kind"] == "must" for r in role.rubric.get("requirements", [])):
        raise HTTPException(409, "Add at least one must-have requirement before uploading.")
    max_bytes = int(get_settings().max_upload_mb * 1024 * 1024)
    data = file.file.read(max_bytes + 1)
    filename = (file.filename or "resume").rsplit("/", 1)[-1][:200]
    try:
        text = extract_text(filename, data, max_bytes)
    except ParseError as e:
        raise HTTPException(e.status_code, e.message) from e
    c = Candidate(role_id=role_id, filename=filename, resume_text=text, status=PROCESSING)
    s.add(c)
    s.commit()
    s.refresh(c)
    tasks.add_task(run_evaluation, c.id, llm)
    return _candidate_summary(c, role)


@router.get("/roles/{role_id}/candidates")
def list_candidates(role_id: int, s: Session = Depends(get_session)):
    role = _role_or_404(s, role_id)
    rows = s.exec(
        select(Candidate).where(Candidate.role_id == role_id).order_by(Candidate.created_at)
    ).all()
    return [_candidate_summary(c, role) for c in rows]


@router.get("/candidates/{candidate_id}")
def get_candidate(candidate_id: int, s: Session = Depends(get_session)):
    c = _candidate_or_404(s, candidate_id)
    role = s.get(Role, c.role_id)
    return {
        **_candidate_summary(c, role),
        "role_title": role.title,
        "role_rubric_version": role.rubric_version,
        "evaluation": c.evaluation,
        "resume_text": c.resume_text,
        "model_id": c.model_id,
        "prompt_version": c.prompt_version,
        "rubric_version": c.rubric_version,
    }


class CandidatePatch(BaseModel):
    decision: Decision | None = None
    note: str | None = Field(default=None, max_length=5000)


@router.patch("/candidates/{candidate_id}")
def update_candidate(candidate_id: int, body: CandidatePatch, s: Session = Depends(get_session)):
    c = _candidate_or_404(s, candidate_id)
    values = body.model_dump(exclude_none=True)
    if values:
        # Targeted update so a concurrent evaluation write can't clobber the human's fields.
        s.exec(update(Candidate).where(Candidate.id == candidate_id).values(**values))
        s.commit()
        s.refresh(c)
    return _candidate_summary(c, s.get(Role, c.role_id))


@router.post("/candidates/{candidate_id}/reevaluate", status_code=202)
def reevaluate(
    candidate_id: int,
    tasks: BackgroundTasks,
    s: Session = Depends(get_session),
    llm=Depends(llm_dep),
):
    c = _candidate_or_404(s, candidate_id)
    role = s.get(Role, c.role_id)
    if not any(r["kind"] == "must" for r in role.rubric.get("requirements", [])):
        raise HTTPException(409, "Add at least one must-have requirement first.")
    res = s.exec(
        update(Candidate)
        .where(Candidate.id == candidate_id, Candidate.status != PROCESSING)
        .values(status=PROCESSING, error=None)
    )
    s.commit()
    if not res.rowcount:
        raise HTTPException(409, "This candidate is already being evaluated.")
    tasks.add_task(run_evaluation, candidate_id, llm)
    s.refresh(c)
    return _candidate_summary(c, role)


@router.delete("/candidates/{candidate_id}", status_code=204)
def delete_candidate(candidate_id: int, s: Session = Depends(get_session)):
    c = _candidate_or_404(s, candidate_id)
    s.delete(c)
    s.commit()
