FROM python:3.12.8-slim
WORKDIR /app
# Build context is the repo root so the shared/ package is available.
COPY proxy/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY shared/ ./shared/
COPY proxy/ .
# The command is overridden in docker-compose.yml
