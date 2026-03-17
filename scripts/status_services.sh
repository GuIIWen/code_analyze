#!/usr/bin/env bash
set -euo pipefail

BACKEND_PORT="${BACKEND_PORT:-8011}"
FRONTEND_PORT="${FRONTEND_PORT:-3199}"
BACKEND_LOG="${BACKEND_LOG:-/tmp/code-analyze-backend.log}"
FRONTEND_LOG="${FRONTEND_LOG:-/tmp/code-analyze-frontend.log}"

echo "[ports]"
if command -v lsof >/dev/null 2>&1; then
  lsof -i :"$BACKEND_PORT" -P -n 2>/dev/null || true
  lsof -i :"$FRONTEND_PORT" -P -n 2>/dev/null || true
fi

echo
echo "[backend health]"
if command -v curl >/dev/null 2>&1; then
  curl -sS -m 5 "http://127.0.0.1:${BACKEND_PORT}/api/health" || true
  echo
fi

echo
echo "[logs]"
echo "backend: ${BACKEND_LOG}"
echo "frontend: ${FRONTEND_LOG}"
