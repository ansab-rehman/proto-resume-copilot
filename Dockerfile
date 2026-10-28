# Build the frontend, then serve it from FastAPI in a single small image.
FROM node:24-slim AS web
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
WORKDIR /app/backend
COPY backend/pyproject.toml ./
COPY backend/app ./app
RUN pip install --no-cache-dir .
COPY --from=web /app/frontend/dist /app/frontend/dist
ENV FRONTEND_DIST=/app/frontend/dist \
    DATABASE_URL=sqlite:////data/copilot.db \
    PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
