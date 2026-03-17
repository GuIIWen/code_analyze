#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8011}"
FRONTEND_PORT="${FRONTEND_PORT:-3199}"
PYTHON_BIN="${PYTHON_BIN:-/root/Xpod_Web/xpod/bin/python}"
BACKEND_LOG="${BACKEND_LOG:-/tmp/code-analyze-backend.log}"
FRONTEND_LOG="${FRONTEND_LOG:-/tmp/code-analyze-frontend.log}"
BACKEND_PID_FILE="${BACKEND_PID_FILE:-/tmp/code-analyze-backend.pid}"
FRONTEND_PID_FILE="${FRONTEND_PID_FILE:-/tmp/code-analyze-frontend.pid}"

kill_pid_file() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$pid_file"
  fi
}

kill_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti TCP:"$port" 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      kill $pids 2>/dev/null || true
      sleep 1
    fi
  fi
}

cd "$ROOT_DIR"

kill_pid_file "$BACKEND_PID_FILE"
kill_pid_file "$FRONTEND_PID_FILE"
kill_port "$BACKEND_PORT"
kill_port "$FRONTEND_PORT"

nohup setsid "$PYTHON_BIN" -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port "$BACKEND_PORT" \
  </dev/null >"$BACKEND_LOG" 2>&1 &
echo $! >"$BACKEND_PID_FILE"

nohup setsid npm run dev \
  </dev/null >"$FRONTEND_LOG" 2>&1 &
echo $! >"$FRONTEND_PID_FILE"

echo "backend: http://127.0.0.1:${BACKEND_PORT}"
echo "frontend: http://127.0.0.1:${FRONTEND_PORT}"
echo "backend log: ${BACKEND_LOG}"
echo "frontend log: ${FRONTEND_LOG}"
