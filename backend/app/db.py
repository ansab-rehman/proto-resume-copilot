from datetime import UTC, datetime

from sqlalchemy import JSON, Column, update
from sqlalchemy.engine import Engine
from sqlmodel import Field, Session, SQLModel, create_engine

from .config import get_settings

PROCESSING, DONE, FAILED = "processing", "done", "failed"
INTERRUPTED_ERROR = "Interrupted — retry"


def _now() -> datetime:
    return datetime.now(UTC)


class Role(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    title: str
    jd_markdown: str
    # {"requirements": [{"id", "text", "kind": "must"|"nice"}]}
    rubric: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    rubric_version: int = 1
    created_at: datetime = Field(default_factory=_now)


class Candidate(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    role_id: int = Field(foreign_key="role.id", index=True)
    filename: str
    resume_text: str
    status: str = PROCESSING
    error: str | None = None
    evaluation: dict | None = Field(default=None, sa_column=Column(JSON))
    model_id: str | None = None
    prompt_version: str | None = None
    rubric_version: int | None = None
    decision: str = "new"  # new | advance | hold | reject — set by the human only
    note: str = ""
    created_at: datetime = Field(default_factory=_now)


class EvaluationCache(SQLModel, table=True):
    """Finished evaluations keyed by their full input, so identical input gets identical output."""

    key: str = Field(primary_key=True)
    resume_sha: str = Field(index=True)  # lets deletes purge entries for forgotten resumes
    evaluation: dict = Field(sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(default_factory=_now)


_engine: Engine | None = None


def make_engine(url: str) -> Engine:
    args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, connect_args=args)


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = make_engine(get_settings().database_url)
    return _engine


def set_engine(engine: Engine) -> None:
    global _engine
    _engine = engine


def get_session():
    with Session(get_engine()) as session:
        yield session


def init_db() -> int:
    """Create tables and mark evaluations orphaned by a restart as failed. Returns count."""
    engine = get_engine()
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        result = s.exec(
            update(Candidate)
            .where(Candidate.status == PROCESSING)
            .values(status=FAILED, error=INTERRUPTED_ERROR)
        )
        s.commit()
        return result.rowcount
