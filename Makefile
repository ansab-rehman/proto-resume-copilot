PY := backend/.venv/bin/python

.PHONY: setup dev-backend dev-frontend test lint build samples smoke-eval docker

setup:
	cd backend && python3 -m venv .venv && .venv/bin/pip install -q -e '.[dev]'
	cd frontend && npm install
	@test -f .env || cp .env.example .env

dev-backend:
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

test:
	cd backend && .venv/bin/pytest -q

lint:
	cd backend && .venv/bin/ruff check . && .venv/bin/ruff format --check .
	cd frontend && npm run build

build:
	cd frontend && npm run build

samples:
	cd backend && .venv/bin/python scripts/make_samples.py

smoke-eval:
	cd backend && .venv/bin/python scripts/smoke_eval.py

docker:
	docker compose up --build
