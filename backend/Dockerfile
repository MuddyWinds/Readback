FROM python:3.12-slim

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Build context is the repo root (see docker-compose.yml), so requirements.txt
# and the backend/ package are both reachable. Copying backend/ to /app/backend
# keeps it an importable package for `uvicorn backend.main:app`.
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
