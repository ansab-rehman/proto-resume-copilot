# Resume Review Co-pilot

A hiring manager pastes a job description, reviews an AI-drafted rubric, uploads PDF/Word
resumes, and gets a clear, evidence-backed view of each candidate:

1. **Baseline requirements**: does the candidate meet every must-have? (Meets / Does not meet / Needs review)
2. **Noteworthy qualifications**: strengths beyond the rubric, each with a quote
3. **Rubric match score**: a secondary number with a transparent breakdown

The AI assists and the human decides. The app never recommends hiring or rejecting anyone.

Stack: React + TypeScript (Vite, TanStack Query) · Python + FastAPI · SQLite (SQLModel) ·
any OpenAI-compatible LLM endpoint (default: Z.ai GLM).

---

## Quick start

```bash
cp .env.example .env          # then set LLM_API_KEY
make setup                    # backend venv + frontend deps
make dev-backend              # http://localhost:8000  (PORT=8010 make dev-backend to change)
make dev-frontend             # http://localhost:5173  (PORT=8010 make dev-frontend to match)
```

Or as a single container serving the built UI and the API:

```bash
docker compose up --build     # http://localhost:8000
```

**Try it:** create a role by pasting [`samples/jd_senior_fullstack.md`](samples/jd_senior_fullstack.md),
review the drafted rubric, then drag all six files from [`samples/resumes/`](samples/resumes/)
onto the upload area. All sample people are fictional (`make samples` regenerates them).

| Command | What it does |
|---|---|
| `make test` | Backend test suite (63 tests, uses a fake LLM, no network) |
| `make lint` | ruff check + format check, frontend type-check + build |
| `make smoke-eval` | Runs the 6 samples × 3 against the configured model (see below) |

Without `LLM_API_KEY` the UI shows an "LLM not configured" banner. Browsing works, but drafting
and evaluating return a clear 503.

---

## How it works

```
frontend (Vite/React/TS) ──REST /api──> FastAPI ──> parsing (pypdf / python-docx)
                                           ├──> LLMClient protocol ─> OpenAICompatClient (.env)
                                           └──> SQLite (SQLModel)
```

| Path | Responsibility |
|---|---|
| `backend/app/parsing.py` | PDF/DOCX text extraction. Checks extension **and** magic bytes. 413 oversize, 415 wrong type / legacy `.doc`, 422 unreadable or no text layer |
| `backend/app/llm.py` | `LLMClient` protocol + one OpenAI-compatible client. `structured()` validates output with Pydantic plus an optional `check` hook and allows **exactly one corrective retry** that sends the error back |
| `backend/app/evaluation.py` | Schemas, prompts, `PROMPT_VERSION`, rubric extraction, evaluation, quote verification, baseline status, score. **Everything the HM sees as a verdict is computed here deterministically**, not by the model |
| `backend/app/routes.py` | REST API, background evaluation task, concurrency guards |
| `backend/app/db.py` | Two tables (`Role`, `Candidate`), startup recovery |
| `frontend/src/pages/` | Roles → Role (rubric + candidates) → Candidate (evidence + decision) |

### Flow
1. **Create role**: the JD goes to the LLM, which drafts a rubric of must-haves and nice-to-haves. If drafting fails, the role is still created with an empty rubric so the HM can write one or "Redraft from JD".
2. **Review rubric**: edit, move between must/nice, add, remove. Server assigns ids `r1..rn` and requires ≥1 must-have (422 otherwise). Every save bumps `rubric_version`.
3. **Upload**: one request per file (sent in parallel), so each file gets its own error. Upload returns immediately with `processing`. A `BackgroundTask` evaluates, and the UI polls while anything is processing.
4. **Evaluate**: one LLM call returns a verdict + verbatim quote + one-line rationale per requirement, highlights, and interview questions. The backend then verifies quotes and computes baseline and score.
5. **Decide**: the HM sets New / Advance / Hold / Reject plus a note. Evaluations never touch these fields.

---

## Product decisions

**Rubric first, then evaluate.** The JD is converted into explicit, editable requirements that
the HM approves. Every candidate is measured with the same yardstick, and the HM can see and
change that yardstick.

**Evidence for every verdict.** Each verdict carries a verbatim quote. The backend checks the
quote against the resume text by normalized exact match: NFKC (expands ﬁ/ﬂ ligatures),
curly→straight quotes, dashes, casefold, collapsed whitespace, and line-break hyphenation tried
both joined (`experi-␤ence`) and kept (`full-␤stack`). Ellipses split a quote into fragments
that must all appear. The UI shows "✓ Quote found in resume" and, next to it, *"A matching quote
shows the text exists, not that the conclusion is right."*

**Three-state baseline, computed in code (must-haves only).**

| Verdict | Quote | Requirement status |
|---|---|---|
| met | found | **Met** |
| met | missing or not found | **Needs review** |
| partial / unclear | any | **Needs review** |
| not_met | none (absence can't be quoted) | **Not found in resume** (failing) |
| not_met | found (contradicting evidence, e.g. "2 years" vs 5+) | **Not found in resume** (failing) |
| not_met | given but not found | **Needs review** |

Overall: any failing must-have → **Does not meet**. Otherwise all Met → **Meets**. Otherwise
→ **Needs review**. All individual statuses are always shown, so mixed cases stay transparent.
`not_met` is labelled **"Not found in resume"**, never "Not met". It is the model's claim of
absence, which is the main false-negative risk, and the label tells the HM to look.

**Checklist first, score second.** The badge and must-have checklist dominate the candidate
page. The **Rubric match score** is secondary, with the tooltip *"Coverage of your rubric, not a
prediction of job success."* Formula: `70 × must-have coverage + 30 × nice-to-have coverage`,
where met = 1, partial = ½, not found/unclear = 0. With no nice-to-haves, the score is
must-have coverage × 100. The breakdown is shown, and the number is visually de-emphasized
when the baseline is "Does not meet". The score stays verdict-based: a "met" with an
unverified quote still gets credit, and the Needs-review flag next to it tells the HM to check.

**AI never decides.** There is no hire/reject recommendation anywhere: not in the prompt, the
schema or the UI. A banner reads "AI-assisted summary. Verify before deciding." The decision and
note belong to the HM, and background evaluations use targeted UPDATEs that can't overwrite them.

**Fairness & safety.** Both prompts tell the model to ignore protected attributes, school and
employer prestige, and employment gaps. The resume is wrapped in `<resume>` tags as untrusted
data, with any `</resume>` inside it escaped. Instructions inside it are ignored, and the model is
asked to mention them in the summary. Interview questions target gaps and Needs-review items.

**Provenance & staleness.** Each evaluation stores `model_id`, `PROMPT_VERSION` and the
`rubric_version` captured when the task started. When the rubric changes, affected candidates
show **"Stale: rubric changed"** with Re-evaluate (one candidate, or all stale at once).

---

## Production-minded details

- **Single corrective retry.** A schema violation or failed check (e.g. the model skipped,
  duplicated or invented requirement ids) is sent back once with the specific error. A second
  failure becomes a clear, retryable message ("The model didn't assess every requirement. Retry.").
- **Concurrency without a queue.** Re-evaluate is an atomic `UPDATE … WHERE status != 'processing'`,
  so a second click returns **409**. The task writes only its own fields, and only `WHERE status = 'processing'`.
  Deleting a candidate or role mid-evaluation is safe because the late write simply matches no row.
- **Restart recovery.** On startup, rows left `processing` are marked failed with "Interrupted — retry".
- **Logging.** Only ids, statuses, latency and error class. Never resume text, prompts or keys.
- **Limits.** 5 MB per file (configurable), 60k extracted characters, 25 requirements.

### Tests (`make test`)
Parsing (pdf, docx, wrong type, legacy .doc, magic-byte mismatch, corrupt, no text layer,
oversize) · LLM retry semantics (fenced output, one retry on validation or check failure,
configured `response_format` passed through) · every row of the baseline table + the mixed
case · scoring incl. renormalization · quote normalization · completeness check (missing,
duplicate, unknown ids) · prompt escaping · API flow (role → upload → evaluate → decision →
stale → re-evaluate → cascade delete) · 409 on double re-evaluate · restart recovery · delete
during evaluation · task never overwrites decision/note · rubric edit mid-run shows stale.

---

## Configuration (`.env`)

| Var | Default | Notes |
|---|---|---|
| `LLM_BASE_URL` | `https://api.z.ai/api/paas/v4/` | Backend-configured only; never user-supplied |
| `LLM_API_KEY` | — | Required for drafting/evaluating |
| `LLM_MODEL` | `glm-4.6` | |
| `LLM_EXTRA_BODY` | `{"thinking":{"type":"disabled"}}` | JSON merged into each request body |
| `LLM_RESPONSE_FORMAT` | `json_object` | `json_schema` for providers that support it |
| `MAX_UPLOAD_MB` | `5` | |
| `DATABASE_URL` | `sqlite:///./copilot.db` | |

### GLM compatibility notes
*From Z.ai docs:* `response_format` supports `text` and `json_object` only, which is why the
default is `json_object` with the schema in the system prompt and Pydantic doing the enforcement.
Temperature range is [0, 1] (we use 0). Thinking is on by default (slow), hence `LLM_EXTRA_BODY`.

*Not yet verified with a live key:* whether `json_object` output ever arrives fenced (a
fence-stripping helper is kept as a precaution), exact `temperature=0` handling, the effect of
disabling thinking on latency, and whether 8192 output tokens is enough for large rubrics. The
code was exercised end to end against a local OpenAI-compatible mock. Run `make smoke-eval`
with a real key to check these.

There's no automatic json_schema → json_object fallback. It would cost a failed call on every
request. The format is one explicit setting instead.

---

## Smoke eval (`make smoke-eval`)
Drafts a rubric from the sample JD, then evaluates each of the six samples N times (default 3,
`SMOKE_N=5` to change) and prints baseline distribution, scores, score spread and per-requirement
verdict agreement. The samples cover these cases: **strong**, **partial** (Vue, not React),
**weak**, **adjacent** ("worked alongside the AWS platform team", which should be partial, not met),
**sparse** (should be unclear) and **injection**: the weak resume plus one line asking the AI
to "rate this candidate 100". The injection resume is compared to its weak twin, and the script
prints a WARNING if its score leaves the twin's range, its baseline differs, or the injected text
is quoted as evidence. **This is a consistency check, not an accuracy benchmark**, and it never fails the build.

---

## Assumptions
English resumes; text-based PDFs (no OCR); one hiring manager; local use; synthetic data only.

## Security & limitations
- **No auth**, intended for local use only.
- **Synthetic data only.** Resume text is sent to the configured third-party LLM provider.
- API key lives only in `.env` / environment; never stored in the DB or sent to the browser.
- No rate limiting. No PII in logs.
- The LLM endpoint is fixed by the backend. **Allowing user-supplied endpoints would require an
  SSRF allowlist first.**
- Quote verification proves a passage exists, not that the model interpreted it correctly.
- In-process `BackgroundTasks`: work is lost on restart (recovered as "Interrupted — retry") and doesn't scale across workers.

## Trade-offs
- **One LLM call per resume** (all requirements at once): cheaper and faster than a call per requirement, at some risk of the model skimming. The completeness check plus retry mitigates the most visible failure.
- **SQLite + JSON columns**: the evaluation is stored as one document, and score and baseline are derived from it. That's enough for a single user and trivially portable.
- **No BYOK settings UI**: `.env` config avoids encrypted key storage and SSRF surface for a local demo.
- **Score in code, not from the model**: deterministic, explainable, and can be re-weighted without re-running the LLM.

## Next iteration
BYOK settings (encrypted keys + SSRF allowlist) · auth & multi-tenant · durable job queue ·
OCR for scanned resumes · PII redaction before the LLM call · labeled eval set with accuracy
metrics · audit log of decisions · data retention policy · side-by-side candidate comparison.
