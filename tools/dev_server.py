#!/usr/bin/env python3
"""Local development server for Deutsch-Quest with native German TTS endpoint."""
from __future__ import annotations

import argparse
import functools
import hashlib
import http.server
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = ROOT / "site"
CACHE_DIR = Path(tempfile.gettempdir()) / "deutschquest_tts_cache_v4"
EDGE_VOICE = "de-DE-ConradNeural"
EDGE_VOICES = [
    "de-DE-ConradNeural",
    "de-DE-AmalaNeural",
]


def _edge_tts_cmd() -> list[str] | None:
    if shutil.which("edge-tts"):
        return ["edge-tts"]
    if importlib.util.find_spec("edge_tts") is not None:
        return [sys.executable, "-m", "edge_tts"]
    return None


def _find_macos_german_voice() -> str | None:
    if not shutil.which("say"):
        return None
    try:
        out = subprocess.check_output(["say", "-v", "?"], text=True, stderr=subprocess.DEVNULL)
    except Exception:
        return None
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1].lower().startswith("de_"):
            return parts[0]
    return None


def _synthesize_german(text: str, requested_voice: str = "") -> tuple[bytes, str, str] | None:
    """Return (audio_bytes, content_type, voice_label) using edge-tts or macOS German voice."""
    cleaned = " ".join(text.split()).strip()
    if not cleaned:
        return None
    target_voice = requested_voice if requested_voice in EDGE_VOICES else EDGE_VOICE
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(f"{target_voice}:{cleaned}".encode("utf-8")).hexdigest()[:24]

    mp3_path = CACHE_DIR / f"{key}.mp3"
    if mp3_path.exists() and mp3_path.stat().st_size > 1024:
        return mp3_path.read_bytes(), "audio/mpeg", target_voice

    edge_cmd = _edge_tts_cmd()
    if edge_cmd:
        try:
            subprocess.run(
                [*edge_cmd, "--voice", target_voice, "--text", cleaned, "--write-media", str(mp3_path)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=15,
            )
            if mp3_path.exists() and mp3_path.stat().st_size > 1024:
                return mp3_path.read_bytes(), "audio/mpeg", target_voice
        except Exception:
            mp3_path.unlink(missing_ok=True)

    return None


class DeutschQuestHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/tts":
            params = urllib.parse.parse_qs(parsed.query)
            if params.get("ping"):
                sample = _synthesize_german("Hallo.")
                ok = sample is not None
                body = json.dumps({
                    "ok": ok,
                    "voice": sample[2] if sample else "",
                    "voices": EDGE_VOICES if ok and sample[2] in EDGE_VOICES else ([sample[2]] if ok else []),
                }).encode("utf-8")
                self.send_response(200 if ok else 503)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            text = (params.get("text") or [""])[0]
            req_voice = (params.get("voice") or [""])[0]
            result = _synthesize_german(text, req_voice)
            if result is None:
                self.send_error(503, "German TTS unavailable")
                return
            audio_bytes, content_type, _ = result
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(audio_bytes)))
            self.send_header("Cache-Control", "public, max-age=86400")
            self.end_headers()
            self.wfile.write(audio_bytes)
            return

        super().do_GET()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run local Deutsch-Quest server.")
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    handler = functools.partial(DeutschQuestHandler, directory=str(SITE_DIR))
    with http.server.ThreadingHTTPServer(("", args.port), handler) as httpd:
        print(f"Serving Deutsch-Quest at http://localhost:{args.port}/", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
