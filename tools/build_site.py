#!/usr/bin/env python3
"""Prepare the data files the learning site reads.

Copies the Friends catalogue, subtitle lessons, practice dialogues and the
DW "Kurz und leicht" archive (``data/dw_kurz/``, filled by
``tools/fetch_dw_kurz.py``) into ``site/data/`` and, unless ``--no-news`` is
given, fetches today's headlines from the RSS feeds listed in
``tools/news_feeds.json``.

Only the headline, a short teaser and the link are stored for each news item;
the article itself stays on the publisher's site.

Usage:
    python tools/build_site.py            # copy data and fetch news
    python tools/build_site.py --no-news  # copy data only (offline)
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_DATA = ROOT / "site" / "data"
TEASER_LIMIT = 220
EPISODE_FIELDS = (
    "episode_id", "season", "episode", "title_de", "title_en", "summary_de",
    "summary_zh", "theme_zh", "suggested_level", "language_focus",
    "vocabulary", "discussion_de", "discussion_zh",
)
LESSON_FIELDS = (
    "episode_id", "summary_de", "summary_zh", "learning_goals_zh",
    "vocabulary", "grammar", "discussion", "practice",
)
VOCAB_FIELDS = ("de", "zh", "example_de", "example_zh")
GRAMMAR_FIELDS = ("focus_zh", "explanation_zh", "example_de", "example_zh")
PRACTICE_FIELDS = ("task_de", "task_zh", "answer_hint_de", "answer_hint_zh")


def pick(obj: dict, fields: tuple[str, ...]) -> dict:
    return {key: obj[key] for key in fields if key in obj}


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def read_lessons(path: Path) -> list[dict]:
    """Return the lessons in one file; accepts a list or an object with a ``lessons`` list."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"  skipped {path.name}: {exc}", file=sys.stderr)
        return []
    if isinstance(data, dict):
        data = data.get("lessons", [])
    return [item for item in data if isinstance(item, dict) and item.get("episode_id")]


def read_subtitled_ids() -> set[str]:
    """Episode ids that have an imported subtitle source, from the coverage file."""
    path = ROOT / "data" / "subtitle_coverage.json"
    if not path.exists():
        return set()
    try:
        coverage = json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return set()
    return {e["episode_id"] for e in coverage.get("episodes", []) if e.get("subtitle_available") and e.get("episode_id")}


def build_friends() -> dict:
    episodes = json.loads((ROOT / "friends_episodes_236.json").read_text(encoding="utf-8"))
    slim = [pick(ep, EPISODE_FIELDS) for ep in episodes]

    lessons: dict[str, dict] = {}
    for lesson_file in sorted((ROOT / "data" / "subtitle_lessons").glob("*.json")):
        for lesson in read_lessons(lesson_file):
            item = pick(lesson, LESSON_FIELDS)
            item["vocabulary"] = [pick(v, VOCAB_FIELDS) for v in lesson.get("vocabulary") or []]
            item["grammar"] = [pick(g, GRAMMAR_FIELDS) for g in lesson.get("grammar") or []]
            item["practice"] = [pick(p, PRACTICE_FIELDS) for p in lesson.get("practice") or []]
            lessons[lesson["episode_id"]] = item

    known = {ep["episode_id"] for ep in slim}
    unknown = sorted(set(lessons) - known)
    if unknown:
        print("  lessons for unknown episode ids ignored:", ", ".join(unknown), file=sys.stderr)
        lessons = {key: value for key, value in lessons.items() if key in known}

    subtitled = read_subtitled_ids() & known

    dialogues_path = ROOT / "friends_original_dialogues_10.json"
    dialogues = {}
    if dialogues_path.exists():
        for dialogue in json.loads(dialogues_path.read_text(encoding="utf-8")):
            dialogues[dialogue["episode_id"]] = dialogue

    write_json(SITE_DATA / "friends.json", {
        "episodes": slim, "lessons": lessons, "dialogues": dialogues, "subtitled": sorted(subtitled),
    })
    return {"episodes": len(slim), "lessons": len(lessons), "subtitled": len(subtitled), "dialogues": len(dialogues)}


def build_movies() -> dict:
    """Publish original lessons; never publish the copyrighted source subtitles."""
    lessons = []
    for path in sorted((ROOT / "data" / "movie_lessons").glob("*.json")):
        movie = json.loads(path.read_text(encoding="utf-8"))
        if not movie.get("movie_id") or not movie.get("chapters"):
            raise ValueError(f"Invalid movie lesson: {path}")
        lessons.append(movie)
    write_json(SITE_DATA / "movies.json", {"movies": lessons})
    return {"movies": len(lessons), "chapters": sum(len(x["chapters"]) for x in lessons)}


def build_dw(source: Path | None = None) -> dict:
    """Publish the DW "Kurz und leicht" archive: site/data/dw/index.json + one file per day."""
    source = source or ROOT / "data" / "dw_kurz"
    out = SITE_DATA / "dw"
    if out.exists():
        for stale in out.glob("*.json"):
            stale.unlink()
    episodes = {}
    for path in sorted((source / "episodes").glob("*.json")):
        try:
            episode = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            print(f"  skipped {path.name}: {exc}", file=sys.stderr)
            continue
        if isinstance(episode, dict) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(episode.get("id", ""))):
            episodes[episode["id"]] = episode
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from fetch_dw_kurz import build_index  # same index the fetcher writes
    index = build_index(episodes)
    for key, episode in episodes.items():
        write_json(out / f"{key}.json", episode)
    write_json(out / "index.json", index)
    return {"episodes": len(episodes), "latest": index["latest"]}


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    text = re.sub(r"<[^>]+>", " ", value)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def shorten(text: str, limit: int = TEASER_LIMIT) -> str:
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(",.;:") + " …"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def parse_date(value: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    try:
        return parsedate_to_datetime(value).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
    except ValueError:
        return ""


def parse_feed(xml_bytes: bytes, source: str) -> list[dict]:
    """Parse RSS 2.0, RDF/RSS 1.0 or Atom into a flat list of items."""
    root = ET.fromstring(xml_bytes)
    items = []
    for node in root.iter():
        if local_name(node.tag) not in ("item", "entry"):
            continue
        fields: dict[str, str] = {}
        for child in node:
            name = local_name(child.tag)
            if name == "link":
                href = child.attrib.get("href")
                if href and child.attrib.get("rel", "alternate") == "alternate":
                    fields.setdefault("link", href)
                elif child.text and child.text.strip():
                    fields.setdefault("link", child.text.strip())
            elif name in ("title", "description", "summary", "pubdate", "date", "updated", "published"):
                fields.setdefault(name, child.text or "")
        title = clean_text(fields.get("title"))
        link = (fields.get("link") or "").strip()
        if not title or not link.startswith("http"):
            continue
        teaser = clean_text(fields.get("description") or fields.get("summary"))
        when = parse_date(fields.get("pubdate") or fields.get("date") or fields.get("published") or fields.get("updated") or "")
        items.append({"title": title, "teaser": shorten(teaser), "url": link, "source": source, "published": when})
    return items


def fetch(url: str, timeout: int = 20) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "german-learning-site/1.0 (personal study tool)"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def build_news(fetcher=fetch) -> dict:
    config = json.loads((ROOT / "tools" / "news_feeds.json").read_text(encoding="utf-8"))
    limit = int(config.get("max_items_per_group", 8))
    groups, errors = [], []
    for group in config["groups"]:
        per_feed = []
        for feed in group["feeds"]:
            try:
                per_feed.append(parse_feed(fetcher(feed["url"]), feed["source"]))
            except Exception as exc:  # one broken feed must not stop the build
                errors.append({"url": feed["url"], "error": f"{type(exc).__name__}: {exc}"})
        # Interleave the feeds so that no single source fills the whole list.
        merged, seen = [], set()
        for rank in range(max((len(f) for f in per_feed), default=0)):
            for feed_items in per_feed:
                if rank < len(feed_items) and feed_items[rank]["url"] not in seen:
                    seen.add(feed_items[rank]["url"])
                    merged.append(feed_items[rank])
        groups.append({
            "id": group["id"], "de": group["de"], "zh": group["zh"],
            "fallback_url": group.get("fallback_url", ""), "items": merged[:limit],
        })
    payload = {"updated": datetime.now(timezone.utc).isoformat(), "groups": groups, "errors": errors}
    write_json(SITE_DATA / "news.json", payload)
    return {"items": sum(len(g["items"]) for g in groups), "errors": errors}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--no-news", action="store_true", help="skip fetching news feeds")
    args = parser.parse_args(argv)

    print("friends:", build_friends())
    print("movies:", build_movies())
    print("dw kurz und leicht:", build_dw())
    if args.no_news:
        if not (SITE_DATA / "news.json").exists():
            write_json(SITE_DATA / "news.json", {"updated": "", "groups": [], "errors": []})
        print("news: skipped")
    else:
        result = build_news()
        print("news items:", result["items"])
        for error in result["errors"]:
            print("  feed failed:", error["url"], "-", error["error"], file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
