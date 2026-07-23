#!/bin/sh

set -u

OCR_PID=""
APP_PID=""

shutdown() {
  if [ -n "$APP_PID" ]; then kill "$APP_PID" 2>/dev/null || true; fi
  if [ -n "$OCR_PID" ]; then kill "$OCR_PID" 2>/dev/null || true; fi
  if [ -n "$APP_PID" ]; then wait "$APP_PID" 2>/dev/null || true; fi
  if [ -n "$OCR_PID" ]; then wait "$OCR_PID" 2>/dev/null || true; fi
}

trap shutdown EXIT
trap 'exit 143' TERM INT

PORT=8000 /opt/ddddocr/bin/python /app/ddddocr/server.py &
OCR_PID=$!

OCR_READY=0
ATTEMPT=0
while [ "$ATTEMPT" -lt 60 ]; do
  if /opt/ddddocr/bin/python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=1)" 2>/dev/null; then
    OCR_READY=1
    break
  fi
  if ! kill -0 "$OCR_PID" 2>/dev/null; then break; fi
  ATTEMPT=$((ATTEMPT + 1))
  sleep 1
done

if [ "$OCR_READY" -ne 1 ]; then
  echo "ddddocr 服务启动失败" >&2
  exit 1
fi

node /app/server/server.js &
APP_PID=$!

while kill -0 "$APP_PID" 2>/dev/null && kill -0 "$OCR_PID" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$OCR_PID" 2>/dev/null; then
  wait "$OCR_PID" 2>/dev/null || true
  echo "ddddocr 服务意外退出" >&2
  exit 1
fi

wait "$APP_PID"
exit $?
