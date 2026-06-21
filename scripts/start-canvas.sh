#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$SKILL_DIR/assets/cowart-app"
CALLER_DIR="$PWD"
PORT="${COWART_PORT:-43217}"
PROJECT_DIR="${COWART_PROJECT_DIR:-${1:-$CALLER_DIR}}"
CANVAS_DIR="${COWART_CANVAS_DIR:-$PROJECT_DIR/canvas}"
HOST="${COWART_HOST:-127.0.0.1}"

PORT="$(
  COWART_START_PORT="$PORT" COWART_HOST="$HOST" node <<'NODE'
const net = require('node:net')

const host = process.env.COWART_HOST || '127.0.0.1'
const startPort = Number(process.env.COWART_START_PORT || 43217)
const maxAttempts = Number(process.env.COWART_PORT_SCAN_ATTEMPTS || 20)

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', (error) => {
      resolve({ ok: false, code: error.code, message: error.message })
    })
    server.once('listening', () => {
      server.close(() => resolve({ ok: true }))
    })
    server.listen(port, host)
  })
}

;(async () => {
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = startPort + offset
    const result = await canListen(port)
    if (result.ok) {
      console.log(port)
      return
    }

    if (result.code === 'EACCES' || result.code === 'EPERM') {
      console.error(`Cowart cannot listen on ${host}:${port}: ${result.message}`)
      console.error('If you are running inside Codex sandbox, start Cowart with the approved local-service permission.')
      process.exit(1)
    }
  }

  console.error(`Cowart could not find a free port from ${startPort} to ${startPort + maxAttempts - 1}.`)
  process.exit(1)
})()
NODE
)"

export COWART_PROJECT_DIR="$PROJECT_DIR"
export COWART_CANVAS_DIR="$CANVAS_DIR"
export COWART_PORT="$PORT"

cd "$ROOT_DIR"

if [ ! -d node_modules ]; then
  npm install
fi

echo "Cowart canvas: http://${HOST}:${PORT}"
echo "Cowart canvas data: ${CANVAS_DIR}/pages/<page-id>/cowart-canvas.json"
echo "Cowart page assets: ${CANVAS_DIR}/pages/<page-id>/assets -> http://${HOST}:${PORT}/page-assets/<page-id>/"
exec npm run dev -- --host "$HOST" --port "$PORT" --strictPort
