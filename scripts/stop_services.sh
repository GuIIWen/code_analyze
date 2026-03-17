#!/usr/bin/env bash
set -euo pipefail

BACKEND_PORT="${BACKEND_PORT:-8011}"
FRONTEND_PORT="${FRONTEND_PORT:-3199}"
BACKEND_PID_FILE="${BACKEND_PID_FILE:-/tmp/code-analyze-backend.pid}"
FRONTEND_PID_FILE="${FRONTEND_PID_FILE:-/tmp/code-analyze-frontend.pid}"

kill_pid_file() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
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
    fi
  fi
}

kill_pid_file "$BACKEND_PID_FILE"
kill_pid_file "$FRONTEND_PID_FILE"
kill_port "$BACKEND_PORT"
kill_port "$FRONTEND_PORT"

echo "stopped backend:${BACKEND_PORT} frontend:${FRONTEND_PORT}"
