#!/bin/bash
#
# ReelBot one-command launcher
# Usage:
#   ./run.sh          — start everything (infra, backend, worker, frontend)
#   ./run.sh stop     — stop everything
#   ./run.sh status   — check what's running
#   ./run.sh logs [api|worker|next|all] — tail logs
#
set -e
cd "$(dirname "$0")"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
say() { echo -e "${GREEN}[reelbot]${NC} $1"; }
warn() { echo -e "${YELLOW}[reelbot]${NC} $1"; }

start_docker() {
  say "Starting Postgres + Redis + MinIO (docker compose)..."
  docker compose up -d
  for i in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -U reelbot > /dev/null 2>&1; then break; fi
    sleep 1
  done
  for i in $(seq 1 30); do
    if docker compose exec -T minio mc ready local > /dev/null 2>&1; then break; fi
    sleep 1
  done
  say "Infra ready."
}

check_ffmpeg() {
  if ! command -v ffmpeg > /dev/null; then
    warn "ffmpeg not found — install it first (brew install ffmpeg)"; exit 1
  fi
}

setup_backend() {
  say "Setting up backend venv..."
  (
    cd backend
    [ -d .venv ] || python3.11 -m venv .venv
    ./.venv/bin/pip install -q --upgrade pip "setuptools<81" wheel
    ./.venv/bin/pip install -q openai-whisper==20240930 --no-build-isolation || true
    ./.venv/bin/pip install -q -r requirements.txt
    [ -f .env ] || warn "backend/.env missing — copy from README env table"
    ./.venv/bin/python -m alembic upgrade head
    ./.venv/bin/python seed.py
  )
  say "Backend ready."
}

setup_frontend() {
  say "Installing frontend deps..."
  (
    cd frontend
    npm install --silent
    [ -f .env.local ] || warn "frontend/.env.local missing — see README"
  )
  say "Frontend ready."
}

start_all() {
  start_docker
  check_ffmpeg
  setup_backend
  setup_frontend
  mkdir -p /tmp/reelbot logs

  say "Launching FastAPI on :8000..."
  (cd backend && nohup ./.venv/bin/python -m uvicorn main:app --port 8000 > ../logs/api.log 2>&1 & echo $! > /tmp/reelbot/api.pid)

  say "Launching Celery worker (with embedded beat)..."
  (cd backend && nohup ./.venv/bin/celery -A tasks.render worker -l info --pool=solo --concurrency=1 -B > ../logs/worker.log 2>&1 & echo $! > /tmp/reelbot/worker.pid)

  say "Launching Next.js on :3000..."
  (cd frontend && nohup npm run dev -- -p 3000 > ../logs/next.log 2>&1 & echo $! > /tmp/reelbot/next.pid)

  sleep 6
  status_all
  echo ""
  say "=================================================="
  say " ReelBot is up!"
  say "   Frontend:  http://localhost:3000"
  say "   API docs:  http://localhost:8000/docs"
  say "   Admin:     admin@reelbot.dev / admin1234"
  say "   Stop:      ./run.sh stop"
  say "=================================================="
}

stop_all() {
  for f in api worker next; do
    if [ -f "/tmp/reelbot/$f.pid" ]; then
      kill "$(cat /tmp/reelbot/$f.pid)" 2>/dev/null && say "stopped $f" || warn "$f not running"
      rm -f "/tmp/reelbot/$f.pid"
    fi
  done
  docker compose down 2>/dev/null && say "stopped infra" || true
}

status_one() {
  pidfile="/tmp/reelbot/$1.pid"
  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo -e "${GREEN}● $1 running${NC} (pid $(cat "$pidfile"))"
  else
    echo -e "${RED}○ $1 stopped${NC}"
  fi
}

status_all() {
  status_one api; status_one worker; status_one next
  docker compose ps --format '{{.Name}}: {{.Status}}' 2>/dev/null || warn "docker not running"
}

case "${1:-start}" in
  start)  start_all ;;
  stop)   stop_all ;;
  status) status_all ;;
  logs)
    case "${2:-all}" in
      api)    tail -f logs/api.log ;;
      worker) tail -f logs/worker.log ;;
      next)   tail -f logs/next.log ;;
      *)      tail -f logs/*.log ;;
    esac ;;
  *) echo "Usage: ./run.sh [start|stop|status|logs [api|worker|next|all]]"; exit 1 ;;
esac
