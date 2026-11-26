#!/usr/bin/env python3
"""Pre-generate native German MP3 audio files into site/audio/ using edge-tts."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = ROOT / "site"
AUDIO_DIR = SITE_DIR / "audio"
DEFAULT_VOICE = "de-DE-ConradNeural"

COACH_INTROS = [
    "Guten Tag! Ich lerne Deutsch. Heute übe ich Hören und Sprechen.",
    "Hallo! Schön, dass wir uns sehen. Hör mir bitte zu.",
    "Hallo! Was möchtest du mir heute erzählen?",
    "Warum ist dir das wichtig? Kannst du ein Beispiel nennen?",
    "Und was ist danach passiert? Erzähl mir mehr.",
    "Guten Tag! Ich habe eine kleine Frage an dich.",
    "Kannst du mir die Situation kurz beschreiben?",
    "Was würdest du in dieser Situation machen?",
    "Wie würdest du das Problem lösen?",
    "Guten Morgen! Wir besprechen heute eine Alltagssituation.",
    "Was ist deiner Meinung nach der wichtigste Punkt?",
    "Kannst du deinen Gedanken etwas genauer erklären?",
    "Welchen nächsten Schritt schlägst du vor?",
]


def norm(text: str) -> str:
    return " ".join(str(text or "").split()).strip()


def collect_texts(include_all_episodes: bool = False) -> list[str]:
    texts: set[str] = {norm(t) for t in COACH_INTROS if norm(t)}

    def add(value: str | None) -> None:
        cleaned = norm(value or "")
        if cleaned:
            texts.add(cleaned)

    life_path = SITE_DIR / "content/life.json"
    if life_path.exists():
        for zone in json.loads(life_path.read_text(encoding="utf-8")):
            for phrase in zone.get("phrases", []):
                add(phrase[0])

    test_path = SITE_DIR / "content/einbuergerung.json"
    if test_path.exists():
        test_data = json.loads(test_path.read_text(encoding="utf-8"))
        for v in test_data.get("vocab", []):
            add(v[0])
        for q in test_data.get("questions", []):
            add(q.get("q"))

    drive_path = SITE_DIR / "content/fahrpruefung.json"
    if drive_path.exists():
        drive_data = json.loads(drive_path.read_text(encoding="utf-8"))
        for group in drive_data.get("groups", []):
            for item in group.get("items", []):
                add(item[0])

    cards_path = SITE_DIR / "content/friends_cards.json"
    if cards_path.exists():
        cards_data = json.loads(cards_path.read_text(encoding="utf-8"))
        for ep in cards_data.get("episodes", {}).values():
            for card in ep.get("cards", []):
                add(card[0])

    movies_path = SITE_DIR / "data/movies.json"
    if movies_path.exists():
        movies_data = json.loads(movies_path.read_text(encoding="utf-8"))
        for movie in movies_data.get("movies", []):
            for ch in movie.get("chapters", []):
                for v in ch.get("vocabulary", []):
                    add(v.get("de"))
                    add(v.get("example_de"))
                for q in ch.get("discussion", []):
                    add(q.get("question_de"))

    friends_path = SITE_DIR / "data/friends.json"
    if friends_path.exists():
        friends_data = json.loads(friends_path.read_text(encoding="utf-8"))
        for lesson in friends_data.get("lessons", {}).values():
            for v in lesson.get("vocabulary", []):
                add(v.get("de"))
                add(v.get("example_de"))
            for q in lesson.get("discussion", []):
                add(q.get("question_de"))
        for dlg in friends_data.get("dialogues", {}).values():
            for turn in dlg.get("turns", []):
                add(turn.get("de"))
        if include_all_episodes:
            for ep in friends_data.get("episodes", []):
                for v in ep.get("vocabulary", []):
                    add(v.get("de"))
                add(ep.get("discussion_de"))

    return sorted(texts)


async def generate_one(
    text: str,
    voice: str,
    sem: asyncio.Semaphore,
) -> tuple[str, str, bool]:
    key = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    filename = f"{key}.mp3"
    out_path = AUDIO_DIR / filename
    if out_path.exists() and out_path.stat().st_size > 1024:
        return text, filename, False

    async with sem:
        for attempt in range(3):
            try:
                comm = edge_tts.Communicate(text, voice)
                await comm.save(str(out_path))
                if out_path.exists() and out_path.stat().st_size > 1024:
                    return text, filename, True
            except Exception:
                out_path.unlink(missing_ok=True)
                if attempt == 2:
                    return text, "", False
                await asyncio.sleep(0.8 * (attempt + 1))
    return text, "", False


async def build_all(voice: str, concurrency: int, include_all_episodes: bool) -> None:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    texts = collect_texts(include_all_episodes=include_all_episodes)
    sem = asyncio.Semaphore(concurrency)
    tasks = [generate_one(t, voice, sem) for t in texts]
    results = await asyncio.gather(*tasks)

    files: dict[str, str] = {}
    created = 0
    failed = 0
    for text, filename, was_created in results:
        if filename:
            files[text] = filename
            if was_created:
                created += 1
        else:
            failed += 1

    manifest_path = AUDIO_DIR / "manifest.json"
    manifest_path.write_text(
        json.dumps({"voice": voice, "files": files}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Audio manifest ready: {len(files)} files ({created} newly generated, {failed} failed) using {voice}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Pre-generate static German MP3 audio files.")
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    parser.add_argument("--concurrency", type=int, default=6)
    parser.add_argument("--all-episodes", action="store_true")
    args = parser.parse_args()
    asyncio.run(build_all(args.voice, args.concurrency, args.all_episodes))


if __name__ == "__main__":
    main()
