FROM python:3.12.8-slim
WORKDIR /app
# Build context is the repo root so the shared/ package is available.
COPY dashboard_api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY shared/ ./shared/
COPY dashboard_api/ .
# The command is overridden in docker-compose.yml
