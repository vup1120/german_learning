#!/usr/bin/env python3
"""Traditional Chinese translations for DW "Kurz und leicht" episodes, made with Gemini.

Runs in GitHub Actions after ``tools/fetch_dw_kurz.py``. For each recent episode it asks
Gemini once for:

* a natural Traditional Chinese (Taiwan) translation of every transcript sentence,
* the base form (noun with article, infinitive, separable verbs with "|") and the
  meaning in context of every word in the transcript,
* the Chinese meaning of each Glossar entry and each headline.

Results go to ``data/dw_kurz/translations/YYYY-MM-DD.json`` together with a hash of the
episode text, so a changed transcript is translated again. ``tools/build_site.py`` merges
them into the published episode. The word list uses the same tokenisation as
``site/dw_games.js``, so word numbers match what the site shows.

The key comes from the ``GEMINI_API_KEY`` environment variable (a GitHub repository
secret). Without it, or on any API problem, the script prints why and exits with 0.

Usage:
    GEMINI_API_KEY=... python tools/translate_dw.py                # newest 7 episodes, at most 3 calls
    GEMINI_API_KEY=... python tools/translate_dw.py --force 2026-11-26
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / "data" / "dw_kurz"
REST = "https://generativelanguage.googleapis.com/v1beta"
TEXT_MODELS = ["gemini-flash-latest", "gemini-2.5-flash"]
SCHEMA = 1
MIN_COVERAGE = 0.6
# Same as WORD_RE in site/dw_games.js.
WORD_RE = re.compile(r"[A-Za-zÄÖÜäöüßÀ-ÿ0-9]+(?:[-’'][A-Za-zÄÖÜäöüßÀ-ÿ0-9]+)*")

Poster = Callable[[str, dict, dict], "tuple[int, object]"]


def words(text: str) -> list[str]:
    return WORD_RE.findall(text or "")


def norm(text) -> str:
    return " ".join(str(text or "").split())


def episode_hash(episode: dict) -> str:
    """Changes whenever the text that was translated changes."""
    payload = {
        "stories": [[s["de"] for s in story.get("sentences", [])] for story in episode.get("stories", [])],
        "glossary": [[g.get("id"), g.get("term"), g.get("definition")] for g in episode.get("glossary", [])],
        "headlines": episode.get("headlines", []),
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()[:16]


RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "sentences": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "id": {"type": "STRING"},
            "zh": {"type": "STRING"},
            "words": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
                "i": {"type": "INTEGER"}, "lemma": {"type": "STRING"}, "zh": {"type": "STRING"}},
                "required": ["i", "lemma", "zh"]}},
        }, "required": ["id", "zh", "words"]}},
        "glossary": {"type": "ARRAY", "items": {"type": "OBJECT", "properties": {
            "id": {"type": "STRING"}, "zh": {"type": "STRING"}}, "required": ["id", "zh"]}},
        "headlines": {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": ["sentences", "glossary", "headlines"],
}

INSTRUCTIONS = """Du hilfst einer Person aus Taiwan (Muttersprache: Traditionelles Chinesisch), die Deutsch auf B1-Niveau lernt.
Unten steht eine Folge der DW-Videonachrichten „Kurz und leicht“ als JSON.

1. Übersetze jeden Satz ("sentences") natürlich und vollständig ins Traditionelle Chinesisch (Taiwan, 繁體中文).
2. Für JEDES nummerierte Wort eines Satzes gib ein Objekt mit
   - "i": die Nummer des Wortes,
   - "lemma": die Grundform – Nomen mit Artikel im Singular („die Waffenruhe“), Verben im Infinitiv,
     trennbare Verben mit „|“ („aus|fallen“, auch wenn „fallen … aus“ im Satz getrennt steht),
     Adjektive in der Grundform, Eigennamen und Funktionswörter unverändert,
   - "zh": die kurze chinesische Bedeutung GENAU in diesem Satz (Funktionswörter: kurze Erklärung, z. B. „陽性主格冠詞“).
3. Übersetze jede Glossar-Erklärung ("glossary": Begriff + deutsche Erklärung) als kurze chinesische Bedeutung des Begriffs.
4. Übersetze die Schlagzeilen ("headlines") in derselben Reihenfolge.
Antworte nur mit JSON nach dem Schema. Benutze ausschließlich traditionelle Schriftzeichen."""


def build_prompt(episode: dict) -> str:
    sentences = []
    for story in episode.get("stories", []):
        for s in story.get("sentences", []):
            sentences.append({"id": s["id"], "de": s["de"],
                              "words": [f"{i}={w}" for i, w in enumerate(words(s["de"]))]})
    data = {
        "sentences": sentences,
        "glossary": [{"id": g["id"], "term": g["term"], "definition": g["definition"]} for g in episode.get("glossary", [])],
        "headlines": episode.get("headlines", []),
    }
    return INSTRUCTIONS + "\n\n" + json.dumps(data, ensure_ascii=False)


def post_json(url: str, payload: dict, headers: dict, timeout: int = 120) -> tuple[int, object]:
    request = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), method="POST",
                                     headers=dict({"Content-Type": "application/json"}, **headers))
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        try:
            return exc.code, json.loads(body)
        except ValueError:
            return exc.code, body


def api_message(body) -> str:
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        return body["error"].get("message") or body["error"].get("status") or ""
    return str(body)[:200]


class QuotaError(RuntimeError):
    pass


def call_gemini(prompt: str, key: str, models: list[str], post: Poster = post_json) -> tuple[str, dict]:
    """Return (model, parsed JSON). Tries the models in order; without schema if a model rejects it."""
    last = ""
    for model in models:
        for with_schema in (True, False):
            config = {"responseMimeType": "application/json", "temperature": 0.2}
            if with_schema:
                config["responseSchema"] = RESPONSE_SCHEMA
            status, body = post(f"{REST}/models/{model}:generateContent",
                                {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": config},
                                {"x-goog-api-key": key})
            if status == 200 and isinstance(body, dict):
                parts = ((body.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
                text = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
                text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
                try:
                    return model, json.loads(text)
                except ValueError:
                    last = f"{model}: answer was not JSON"
                    continue
            last = f"{model}: HTTP {status} {api_message(body)}"
            if status == 429:
                raise QuotaError(last)
            if status in (401, 403):
                raise RuntimeError(last)
            if status == 400 and with_schema:
                continue  # try once more without the schema
            break  # 404 or other: next model
    raise RuntimeError(last or "no model answered")


def validate(episode: dict, data: dict) -> dict | None:
    """Keep only well-formed entries; None if too little of the episode was translated."""
    sentences = {s["id"]: s["de"] for story in episode.get("stories", []) for s in story.get("sentences", [])}
    out_sentences: dict[str, dict] = {}
    for item in data.get("sentences") or []:
        if not isinstance(item, dict) or item.get("id") not in sentences or not norm(item.get("zh")):
            continue
        ws = words(sentences[item["id"]])
        word_map = {}
        for w in item.get("words") or []:
            try:
                i = int(w.get("i"))
            except (TypeError, ValueError, AttributeError):
                continue
            if 0 <= i < len(ws) and norm(w.get("lemma")) and norm(w.get("zh")):
                word_map[str(i)] = {"l": norm(w["lemma"]), "zh": norm(w["zh"])}
        out_sentences[item["id"]] = {"zh": norm(item["zh"]), "words": word_map}
    glossary_ids = {g["id"] for g in episode.get("glossary", [])}
    out_glossary = {g["id"]: norm(g["zh"]) for g in data.get("glossary") or []
                    if isinstance(g, dict) and g.get("id") in glossary_ids and norm(g.get("zh"))}
    headlines = [norm(h) for h in (data.get("headlines") or []) if isinstance(h, str)]
    headlines = headlines[:len(episode.get("headlines", []))] if len(headlines) >= len(episode.get("headlines", [])) else []
    if sentences and len(out_sentences) / len(sentences) < MIN_COVERAGE:
        return None
    if not sentences and not out_glossary:
        return None
    return {"sentences": out_sentences, "glossary": out_glossary, "headlines": headlines}


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def merge_translation(episode: dict, translation: dict | None) -> dict:
    """Episode with Chinese added (sentence.zh, sentence.words, glossary.zh, headlines_zh) if the hash matches."""
    if not translation or translation.get("episode_hash") != episode_hash(episode):
        return episode
    merged = json.loads(json.dumps(episode))
    for story in merged.get("stories", []):
        for s in story.get("sentences", []):
            t = translation.get("sentences", {}).get(s["id"])
            if t:
                s["zh"] = t["zh"]
                if t.get("words"):
                    s["words"] = t["words"]
    for g in merged.get("glossary", []):
        if translation.get("glossary", {}).get(g["id"]):
            g["zh"] = translation["glossary"][g["id"]]
    if translation.get("headlines"):
        merged["headlines_zh"] = translation["headlines"]
    merged["translated"] = True
    return merged


def run(archive: Path, key: str, episodes: int = 7, max_calls: int = 3, force: str | None = None,
        models: list[str] | None = None, post: Poster = post_json, log=print) -> dict:
    out_dir = archive / "translations"
    files = sorted((archive / "episodes").glob("*.json"), reverse=True)
    existing_ids = {p.stem for p in files}
    for orphan in out_dir.glob("*.json") if out_dir.exists() else []:
        if orphan.stem not in existing_ids:
            orphan.unlink()
    done, skipped, failed = [], [], []
    calls = 0
    for path in files[:max(0, episodes)]:
        episode = load_json(path)
        if not isinstance(episode, dict) or not episode.get("id"):
            continue
        key_id = episode["id"]
        if not episode.get("stories") and not episode.get("glossary"):
            skipped.append(key_id)
            continue
        target = out_dir / f"{key_id}.json"
        current = load_json(target)
        if key_id != force and isinstance(current, dict) and current.get("episode_hash") == episode_hash(episode):
            skipped.append(key_id)
            continue
        if calls >= max_calls:
            break
        calls += 1
        try:
            model, data = call_gemini(build_prompt(episode), key, models or TEXT_MODELS, post)
        except QuotaError as exc:
            log(f"  {key_id}: rate limit reached, trying again next run ({exc})")
            failed.append(key_id)
            break
        except Exception as exc:  # never fail the build
            log(f"  {key_id}: translation failed: {exc}")
            failed.append(key_id)
            continue
        cleaned = validate(episode, data if isinstance(data, dict) else {})
        if cleaned is None:
            log(f"  {key_id}: answer covered too few sentences; not saved")
            failed.append(key_id)
            continue
        out_dir.mkdir(parents=True, exist_ok=True)
        payload = {"schema": SCHEMA, "id": key_id, "episode_hash": episode_hash(episode), "model": model,
                   "created": datetime.now(timezone.utc).replace(microsecond=0).isoformat()}
        payload.update(cleaned)
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        words_total = sum(len(s["words"]) for s in cleaned["sentences"].values())
        log(f"  {key_id}: {len(cleaned['sentences'])} sentences, {words_total} words, "
            f"{len(cleaned['glossary'])} Glossar · {model}")
        done.append(key_id)
    return {"translated": done, "unchanged": skipped, "failed": failed}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--archive", type=Path, default=ARCHIVE)
    parser.add_argument("--episodes", type=int, default=7, help="look at the newest N episodes")
    parser.add_argument("--max-calls", type=int, default=3, help="API calls per run (free-tier friendly)")
    parser.add_argument("--force", metavar="YYYY-MM-DD", help="translate this day again")
    parser.add_argument("--model", action="append", help="model to use (repeatable); default: flash-latest, 2.5-flash")
    args = parser.parse_args(argv)
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        print("dw translations: no GEMINI_API_KEY (add it as a repository secret); skipped")
        return 0
    try:
        result = run(args.archive, key, args.episodes, args.max_calls, args.force, args.model)
    except Exception as exc:  # pragma: no cover - last line of defence
        print(f"dw translations failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 0
    print("dw translations:", json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
