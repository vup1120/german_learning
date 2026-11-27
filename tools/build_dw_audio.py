#!/usr/bin/env python3
"""Native German MP3s (edge-tts, de-DE-ConradNeural) for recent DW "Kurz und leicht" episodes.

Reads ``data/dw_kurz/`` and writes ``site/audio/dw/<hash>.mp3`` plus
``site/audio/dw/manifest.json``. ``site/speech.js`` merges that manifest into
the static audio map, so the speaker buttons on the DW page play these files
instead of the browser voice. Older episodes simply fall back to the browser
voice. Files of episodes outside the window are deleted, so the folder (which
the workflow caches, and Git ignores) stays small.

Missing edge-tts or a network failure never fails the build: the script
reports it and exits with 0.

Usage:
    pip install edge-tts
    python tools/build_dw_audio.py              # newest 5 episodes
    python tools/build_dw_audio.py --episodes 10
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "data" / "dw_kurz"
OUT = ROOT / "site" / "audio" / "dw"
DEFAULT_VOICE = "de-DE-ConradNeural"


def norm(text: str) -> str:
    return " ".join(str(text or "").split()).strip()


def client_key(text: str) -> str:
    """The lookup key speech.js uses: its chop() pieces joined by single spaces."""
    parts = re.findall(r"[^.!?;:]+[.!?;:]?", norm(text))
    return " ".join(p.strip() for p in parts if p.strip())


def collect_texts(archive: Path, episodes: int) -> list[str]:
    files = sorted((archive / "episodes").glob("*.json"), reverse=True)[:max(0, episodes)]
    texts: list[str] = []

    def add(value: str | None) -> None:
        value = norm(value or "")
        if value and value not in texts:
            texts.append(value)

    for path in files:
        try:
            episode = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        for item in episode.get("glossary", []):
            add(item.get("say") or item.get("term"))
            add(item.get("definition"))
        for story in episode.get("stories", []):
            for sentence in story.get("sentences", []):
                add(sentence.get("de"))
        for headline in episode.get("headlines", []):
            add(headline)
    return texts


def filename(text: str, voice: str) -> str:
    return hashlib.sha256(f"{voice}:{text}".encode("utf-8")).hexdigest()[:16] + ".mp3"


async def synthesize(texts: list[str], voice: str, concurrency: int, out: Path) -> dict[str, str]:
    import edge_tts  # imported here so a missing package is reported, not raised at import

    out.mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(concurrency)
    files: dict[str, str] = {}

    async def one(text: str) -> None:
        name = filename(text, voice)
        path = out / name
        if not (path.exists() and path.stat().st_size > 1024):
            async with sem:
                for attempt in range(3):
                    try:
                        await edge_tts.Communicate(text, voice).save(str(path))
                        if path.exists() and path.stat().st_size > 1024:
                            break
                    except Exception:
                        path.unlink(missing_ok=True)
                        await asyncio.sleep(0.8 * (attempt + 1))
        if path.exists() and path.stat().st_size > 1024:
            for key in {norm(text), client_key(text)}:
                files[key] = f"dw/{name}"

    await asyncio.gather(*(one(t) for t in texts))
    return files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--episodes", type=int, default=5, help="how many recent episodes get audio")
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    parser.add_argument("--concurrency", type=int, default=6)
    parser.add_argument("--archive", type=Path, default=ARCHIVE)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args(argv)

    texts = collect_texts(args.archive, args.episodes)
    if not texts:
        print("dw audio: no episodes yet")
        return 0
    try:
        files = asyncio.run(synthesize(texts, args.voice, args.concurrency, args.out))
    except ImportError:
        print("dw audio: edge-tts is not installed (pip install edge-tts); the site uses the browser voice")
        return 0
    except Exception as exc:  # network trouble: keep whatever already exists
        print(f"dw audio failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 0
    keep = set(files.values())
    removed = 0
    for path in args.out.glob("*.mp3"):
        if f"dw/{path.name}" not in keep:
            path.unlink()
            removed += 1
    (args.out / "manifest.json").write_text(
        json.dumps({"voice": args.voice, "files": files}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    print(f"dw audio: {len(keep)} of {len(texts)} texts have audio ({removed} old files removed) · {args.voice}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
