#!/usr/bin/env python3
"""Local STT/TTS HTTP service for Audai.

STT uses whisper.cpp with a local GGML model file.
TTS uses macOS `say` so it works offline on this development machine.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

from flask import Flask, jsonify, request, send_file


HOST = os.environ.get("LOCAL_VOICE_HOST", "127.0.0.1")
PORT = int(os.environ.get("LOCAL_VOICE_PORT", "8765"))
MODEL_PATH = os.environ.get("LOCAL_STT_MODEL_PATH", "models/local-voice/ggml-base.bin")
WHISPER_CLI = os.environ.get("LOCAL_WHISPER_CLI", "whisper-cli")
DEFAULT_VOICE = os.environ.get("LOCAL_TTS_VOICE", "")

app = Flask(__name__)


def decode_stderr(stderr) -> str:
  if stderr is None:
    return ""

  if isinstance(stderr, bytes):
    return stderr.decode("utf-8", errors="ignore").strip()

  return stderr.strip()


def transcribe_with_whisper_cpp(audio_path: str) -> str:
  model_path = Path(MODEL_PATH)

  if not model_path.exists():
    raise RuntimeError(
      f"Local STT model not found: {model_path}. Run scripts/setup_local_voice.sh first."
    )

  with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as wav_file:
    subprocess.run(
      [
        "ffmpeg",
        "-y",
        "-i",
        audio_path,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-f",
        "wav",
        wav_file.name,
      ],
      check=True,
      capture_output=True,
    )
    result = subprocess.run(
      [
        WHISPER_CLI,
        "-m",
        str(model_path),
        "-f",
        wav_file.name,
        "-l",
        "zh",
        "-nt",
        "-np",
      ],
      check=True,
      capture_output=True,
      text=True,
    )

  return result.stdout.strip()


@app.post("/stt")
def stt():
  audio = request.files.get("audio")

  if audio is None:
    return jsonify({"error": "missing multipart audio field"}), 400

  suffix = Path(audio.filename or "audio.webm").suffix or ".webm"

  with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as audio_file:
    audio.save(audio_file.name)
    try:
      text = transcribe_with_whisper_cpp(audio_file.name)
    except subprocess.CalledProcessError as error:
      stderr = decode_stderr(error.stderr)
      lowered_stderr = stderr.lower()

      if "invalid data" in lowered_stderr or "end of file" in lowered_stderr:
        return jsonify({
          "model": Path(MODEL_PATH).name,
          "text": "",
          "warning": stderr or "audio chunk could not be decoded",
        })

      return jsonify({"error": stderr or "whisper.cpp failed"}), 500
    except RuntimeError as error:
      return jsonify({"error": str(error)}), 500

  return jsonify({
    "model": Path(MODEL_PATH).name,
    "text": text,
  })


@app.post("/tts")
def tts():
  payload = request.get_json(silent=True) or {}
  text = str(payload.get("text") or "").strip()
  voice = str(payload.get("voice") or DEFAULT_VOICE).strip()

  if not text:
    return jsonify({"error": "missing text"}), 400

  aiff_output = tempfile.NamedTemporaryFile(suffix=".aiff", delete=False)
  aiff_output.close()
  wav_output = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
  wav_output.close()
  command = ["say", "-o", aiff_output.name, text]

  if voice:
    command = ["say", "-v", voice, "-o", aiff_output.name, text]

  try:
    subprocess.run(command, check=True, capture_output=True)
    subprocess.run(
      [
        "ffmpeg",
        "-y",
        "-i",
        aiff_output.name,
        "-ar",
        "24000",
        "-ac",
        "1",
        "-f",
        "wav",
        wav_output.name,
      ],
      check=True,
      capture_output=True,
    )
  except subprocess.CalledProcessError as error:
    Path(aiff_output.name).unlink(missing_ok=True)
    Path(wav_output.name).unlink(missing_ok=True)
    stderr = decode_stderr(error.stderr)
    return jsonify({"error": stderr or "macOS say or ffmpeg failed"}), 500
  finally:
    Path(aiff_output.name).unlink(missing_ok=True)

  response = send_file(
    wav_output.name,
    mimetype="audio/wav",
    as_attachment=False,
    download_name="audai-local-tts.wav",
    max_age=0,
  )
  response.call_on_close(lambda: Path(wav_output.name).unlink(missing_ok=True))
  return response


@app.get("/health")
def health():
  return jsonify({
    "backend": "whisper.cpp",
    "modelPath": MODEL_PATH,
    "ok": Path(MODEL_PATH).exists(),
    "tts": "macos-say",
  })


if __name__ == "__main__":
  app.run(host=HOST, port=PORT, debug=False, threaded=True)
