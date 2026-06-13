#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv-local-voice"
MODEL_DIR="$ROOT_DIR/models/local-voice"
MODEL_PATH="$MODEL_DIR/ggml-base.bin"

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/pip" install -r "$ROOT_DIR/requirements-local-voice.txt"

mkdir -p "$(dirname "$MODEL_DIR")"
mkdir -p "$MODEL_DIR"

if [ ! -f "$MODEL_PATH" ]; then
  curl -L --fail --retry 3 --retry-delay 3 \
    -o "$MODEL_PATH" \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
fi

cat <<EOF
Local voice environment is ready.

Start the service with:
  LOCAL_STT_MODEL_PATH=$MODEL_PATH npm run voice:local

The legacy Flask service is still available with:
  LOCAL_STT_MODEL_PATH=$MODEL_PATH "$VENV_DIR/bin/python" scripts/local_voice_service.py
EOF
