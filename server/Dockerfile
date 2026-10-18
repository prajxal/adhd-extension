# Readwell server for Render (or any container host that sets $PORT).
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    APP_ENV=production \
    PORT=8000

WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
RUN pip install . \
    && useradd --create-home --uid 10001 readwell

USER readwell
EXPOSE 8000

# --proxy-headers: read the visitor's IP from Render's proxy so per-IP limits work.
# Only Render's proxy can reach the container, so trusting its forwarded headers is safe.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
