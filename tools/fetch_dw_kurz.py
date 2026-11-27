#!/usr/bin/env python3
"""Fetch the daily DW "Kurz und leicht" episode into ``data/dw_kurz/``.

For each recent episode this stores the YouTube video id (for the
youtube-nocookie embed), the German transcript ("Manuskript"), split into
sentences, and the vocabulary list ("Glossar": term + simple German
definition). One JSON file per day goes to ``data/dw_kurz/episodes/`` and a
small ``data/dw_kurz/index.json`` lists them, newest first.

Where things come from (all URLs live in ``tools/dw_kurz.json``):

1. The YouTube RSS feed of "Deutsch lernen mit der DW". Entries whose title
   contains "Kurz und leicht" give the video id and the date ("… vom 26.11.2026").
2. The DW episode page: links in the video description, optional DW feeds,
   and dated links on the "Kurz und leicht" overview page.
3. The page's Manuskript and Glossar are read from embedded JSON or from the
   HTML headings, whichever yields more.

The script never fails the build: on weekends, holidays or network errors it
prints what happened, leaves the archive untouched and exits with 0.
Files are only rewritten when their content changes, so a scheduled run with
nothing new produces no commit.

Usage:
    python tools/fetch_dw_kurz.py                     # fetch recent episodes
    python tools/fetch_dw_kurz.py --refetch 2026-11-26
    python tools/fetch_dw_kurz.py --dump-html .tmp/dw  # keep raw pages for debugging
    python tools/fetch_dw_kurz.py --from-html page.html --date 2026-11-26  # offline parse test
"""
from __future__ import annotations

import argparse
import html as htmllib
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable, Iterable

try:
    from zoneinfo import ZoneInfo
    BERLIN = ZoneInfo("Europe/Berlin")
except Exception:  # pragma: no cover - tzdata missing
    BERLIN = timezone(timedelta(hours=1))

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "tools" / "dw_kurz.json"
ARCHIVE = ROOT / "data" / "dw_kurz"
SCHEMA = 1
USER_AGENT = "Mozilla/5.0 (compatible; german-learning-site/1.0; personal study tool)"
YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August",
             "September", "Oktober", "November", "Dezember"]

Fetcher = Callable[[str], "tuple[str, bytes]"]


# ---------------------------------------------------------------- utilities

def norm(text: str | None) -> str:
    text = (text or "").replace("­", "").replace("​", "")
    return " ".join(text.split())


def fetch(url: str, timeout: int = 20) -> tuple[str, bytes]:
    """Return (final_url, body). Redirects are followed."""
    request = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept-Language": "de-DE,de;q=0.9",
    })
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.geturl(), response.read()


def decode(body: bytes) -> str:
    head = body[:2048].decode("ascii", "ignore")
    match = re.search(r"charset=[\"']?([A-Za-z0-9_-]+)", head)
    for encoding in ([match.group(1)] if match else []) + ["utf-8", "windows-1252"]:
        try:
            return body.decode(encoding)
        except (LookupError, UnicodeDecodeError):
            continue
    return body.decode("utf-8", "replace")


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def berlin_date(iso: str) -> date | None:
    try:
        moment = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(BERLIN).date()


DATE_IN_TEXT = re.compile(r"(?<!\d)(\d{1,2})\.\s?(\d{1,2})\.\s?(20\d{2})(?!\d)")
DATE_IN_SLUG = re.compile(r"(?<!\d)(\d{2})[-_.]?(\d{2})[-_.]?(20\d{2})(?!\d)")
DATE_ISO = re.compile(r"(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)")
DATE_LONG = re.compile(r"(?<!\d)(\d{1,2})\.\s*(" + "|".join(MONTHS_DE) + r")\s+(20\d{2})", re.I)


def _safe_date(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def dates_in(text: str) -> list[date]:
    """Every plausible date mentioned in a title, anchor text or URL slug."""
    found: list[date] = []
    for d, m, y in DATE_IN_TEXT.findall(text):
        found.append(_safe_date(int(y), int(m), int(d)))
    for d, m, y in DATE_LONG.findall(text):
        month = next(i for i, name in enumerate(MONTHS_DE, 1) if name.lower() == m.lower())
        found.append(_safe_date(int(y), month, int(d)))
    for y, m, d in DATE_ISO.findall(text):
        found.append(_safe_date(int(y), int(m), int(d)))
    for d, m, y in DATE_IN_SLUG.findall(text):
        found.append(_safe_date(int(y), int(m), int(d)))
    unique: list[date] = []
    for item in found:
        if item and item not in unique:
            unique.append(item)
    return unique


def mentions_date(text: str, day: date) -> bool:
    return day in dates_in(text)


def urls_in(text: str) -> list[str]:
    urls = []
    for raw in re.findall(r"https?://[^\s<>\"')\]]+", text or ""):
        url = raw.rstrip(".,;:!?»“”")
        if url not in urls:
            urls.append(url)
    return urls


def is_host(url: str, hosts: Iterable[str]) -> bool:
    host = (urllib.parse.urlsplit(url).hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in hosts)


def contains_keyword(text: str, keywords: Iterable[str]) -> bool:
    low = norm(text).lower()
    return any(k.lower() in low for k in keywords)


# ---------------------------------------------------------------- feeds

def parse_youtube_feed(xml_bytes: bytes) -> list[dict]:
    """YouTube Atom feed -> [{video_id, title, published, url, description}]."""
    root = ET.fromstring(xml_bytes)
    entries = []
    for node in root.iter():
        if local_name(node.tag) != "entry":
            continue
        item = {"video_id": "", "title": "", "published": "", "url": "", "description": ""}
        for child in node.iter():
            name = local_name(child.tag)
            if name == "videoid" and child.text:
                item["video_id"] = child.text.strip()
            elif name == "title" and child.text and not item["title"]:
                item["title"] = norm(child.text)
            elif name == "published" and child.text:
                item["published"] = child.text.strip()
            elif name == "link" and child.attrib.get("rel", "alternate") == "alternate" and not item["url"]:
                item["url"] = child.attrib.get("href", "")
            elif name == "description" and child.text:
                item["description"] = child.text.strip()
        if not item["video_id"]:
            match = re.search(r"(?:v=|/shorts/|youtu\.be/)([A-Za-z0-9_-]{11})", item["url"])
            item["video_id"] = match.group(1) if match else ""
        if YOUTUBE_ID.match(item["video_id"]) and item["title"]:
            entries.append(item)
    return entries


def parse_rss_items(xml_bytes: bytes) -> list[dict]:
    """Generic RSS/Atom items with the full description kept: [{title, url, description, published}]."""
    root = ET.fromstring(xml_bytes)
    items = []
    for node in root.iter():
        if local_name(node.tag) not in ("item", "entry"):
            continue
        item = {"title": "", "url": "", "description": "", "published": ""}
        for child in node:
            name = local_name(child.tag)
            if name == "title":
                item["title"] = norm(child.text)
            elif name == "link":
                href = child.attrib.get("href") or (child.text or "").strip()
                if href and not item["url"]:
                    item["url"] = href
            elif name in ("description", "summary", "encoded", "content") and child.text:
                if len(child.text) > len(item["description"]):
                    item["description"] = child.text
            elif name in ("pubdate", "published", "updated", "date") and child.text and not item["published"]:
                item["published"] = child.text.strip()
        if item["title"]:
            items.append(item)
    return items


def episode_day(title: str, published: str) -> date | None:
    """Prefer the date in the title ("Kurz und leicht vom 26.11.2026"), else the publish date in Berlin."""
    found = dates_in(title)
    if found:
        return found[0]
    if published:
        day = berlin_date(published)
        if day:
            return day
        try:
            from email.utils import parsedate_to_datetime
            return parsedate_to_datetime(published).astimezone(BERLIN).date()
        except (TypeError, ValueError):
            return None
    return None


def headlines_from_description(text: str) -> list[str]:
    """Bullet lines such as "- EU: Verteidigungspaket für die Ukraine"."""
    heads: list[str] = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or "http" in line:
            continue
        parts = re.split(r"(?:^|\s)[-–•▪]\s+", " " + line)
        bullets = [norm(p) for p in parts[1:] if norm(p)]
        if re.match(r"^[-–•▪]\s", line) and bullets:
            heads.extend(bullets)
    cleaned = []
    for h in heads:
        h = re.sub(r"\s*#\S+", "", h).strip(" .")
        if 3 <= len(h) <= 120 and h not in cleaned:
            cleaned.append(h)
    return cleaned[:6]


# ---------------------------------------------------------------- HTML -> blocks

BLOCK_TAGS = {
    "p", "li", "dt", "dd", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "blockquote",
    "figcaption", "div", "section", "article", "header", "main", "aside", "ul", "ol", "dl",
    "table", "tr", "summary", "details", "figure",
}
HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
SKIP_TAGS = {"script", "style", "noscript", "svg", "template", "nav", "footer", "form",
             "button", "select", "iframe", "head", "picture", "video", "audio"}


class BlockParser(HTMLParser):
    """Flattens HTML into a list of text blocks, remembering bold lead-ins.

    Each block: {"tag": "p"|"h2"|"li"|"dt"|"dd"|..., "text": str, "lead": str}
    where ``lead`` is the bold text the block starts with (glossary terms are
    usually bold: "<strong>die Waffenruhe</strong> – …").
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[dict] = []
        self.stack: list[str] = []
        self.skip = 0
        self.bold = 0
        self.buf: list[tuple[str, bool]] = []
        self.links: list[dict] = []
        self._anchor: dict | None = None
        self.title = ""
        self._in_title = False
        self.meta: dict[str, str] = {}

    # -- helpers
    def _tag(self) -> str:
        for tag in reversed(self.stack):
            if tag in HEADINGS:
                return tag
        return self.stack[-1] if self.stack else "div"

    def flush(self) -> None:
        if not self.buf:
            return
        text = norm("".join(t for t, _ in self.buf))
        lead = ""
        if text:
            started = False
            for chunk, is_bold in self.buf:
                if not chunk.strip():
                    if started:
                        lead += chunk
                    continue
                if is_bold:
                    lead += chunk
                    started = True
                else:
                    break
            self.blocks.append({"tag": self._tag(), "text": text, "lead": norm(lead)})
        self.buf = []

    # -- parser callbacks
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta":
            key = attrs.get("property") or attrs.get("name") or ""
            if key and attrs.get("content"):
                self.meta[key.lower()] = attrs["content"]
            return
        if tag == "title" and not self.title:
            self._in_title = True
        if tag in SKIP_TAGS:
            self.skip += 1
            return
        if self.skip:
            return
        if tag == "br":
            self.flush()
            return
        if tag in ("strong", "b"):
            self.bold += 1
        if tag == "a":
            self._anchor = {"href": attrs.get("href") or "", "text": ""}
        if tag in BLOCK_TAGS:
            self.flush()
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if tag in SKIP_TAGS:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        if tag in ("strong", "b"):
            self.bold = max(0, self.bold - 1)
        if tag == "a" and self._anchor is not None:
            self._anchor["text"] = norm(self._anchor["text"])
            self.links.append(self._anchor)
            self._anchor = None
        if tag in BLOCK_TAGS:
            self.flush()
            if tag in self.stack:
                while self.stack:
                    if self.stack.pop() == tag:
                        break

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self.skip:
            return
        if self._anchor is not None:
            self._anchor["text"] += data
        self.buf.append((data, self.bold > 0))

    def close(self):
        super().close()
        self.flush()


def parse_blocks(markup: str) -> BlockParser:
    parser = BlockParser()
    try:
        parser.feed(markup)
        parser.close()
    except Exception:  # malformed markup: keep whatever was read
        parser.flush()
    return parser


# ---------------------------------------------------------------- Manuskript / Glossar

MANUSKRIPT = re.compile(r"^(manuskript|transkript|skript|text zum video|der text)\b", re.I)
GLOSSAR = re.compile(r"^(glossar|wortschatz|vokabeln?|wörter|wortliste)\b", re.I)
STORY = re.compile(r"^(nachricht|meldung|thema)\s*\d+\b", re.I)
STOP = re.compile(
    r"^(übungen?|aufgaben?|arbeitsbl[aä]tt|fragen zum|test\b|quiz|mehr zum thema|mehr aus|"
    r"audios? und videos?|weitere|ähnliche|teilen|feedback|impressum|datenschutz|newsletter|"
    r"downloads?|zum download|lernmaterial|nächste|vorherige|kommentare|das könnte|empfehlung|"
    r"alle folgen|alle sendungen|links?\b|zur übersicht|mehr folgen|copyright)", re.I)
SEPARATORS = re.compile(r"\s+[–—-]\s+|\s*:\s+|\t")


def is_heading(block: dict) -> bool:
    if block["tag"] in HEADINGS:
        return True
    text = block["text"]
    return bool(block["lead"]) and block["lead"] == text and len(text) <= 60


def parse_gloss_entry(block: dict) -> dict | None:
    """"die Waffenruhe – hier: Zeit ohne Kämpfe" -> {term, definition}."""
    text = block["text"]
    if block["tag"] == "dt":
        return {"term": text, "definition": ""} if 0 < len(text) <= 80 else None
    term = definition = ""
    lead = block["lead"]
    if lead and text.startswith(lead) and lead != text:
        term = lead
        definition = text[len(lead):].lstrip(" –—-:,\t")
    else:
        parts = SEPARATORS.split(text, maxsplit=1)
        if len(parts) == 2:
            term, definition = parts
    term = term.strip(" :–—-")
    definition = definition.strip()
    if not term or not definition:
        return None
    if len(term) > 80 or len(term.split()) > 8 or len(definition) > 400:
        return None
    if term.endswith((".", "?", "!")):
        return None
    return {"term": term, "definition": definition}


def looks_like_gloss(block: dict) -> bool:
    """A bold lead-in followed by a dash: a glossary line even outside a "Glossar" heading."""
    lead, text = block["lead"], block["text"]
    if not lead or lead == text or len(lead.split()) > 6 or len(text) > 260:
        return False
    rest = text[len(lead):].lstrip()
    return rest[:1] in ("–", "—", "-", ":")


ABBREVIATIONS = {
    "z", "b", "d", "h", "u", "a", "o", "s", "bzw", "ca", "dr", "nr", "st", "usw", "vgl", "evtl", "inkl",
    "mio", "mrd", "prof", "sog", "ggf", "etc", "bspw", "jh", "min", "max", "str", "tel", "abs", "art",
    "bzgl", "zb", "dt", "engl", "frz", "gegr", "hl", "jr", "mr", "mrs", "geb", "ehem", "v", "chr", "n",
}
BOUNDARY = re.compile(r"([.!?…]+)([\"“”»«')]*)\s+(?=[\"„“»«(]?[A-ZÄÖÜ0-9])")


def split_sentences(paragraph: str) -> list[str]:
    text = norm(paragraph)
    if not text:
        return []
    sentences, start = [], 0
    for match in BOUNDARY.finditer(text):
        end = match.end(2)
        before = text[start:match.start(1)]
        last = re.split(r"\s", before)[-1] if before else ""
        word = last.strip("(\"„“").rstrip(".")
        if match.group(1) == ".":
            if word.lower() in ABBREVIATIONS or (len(word) == 1 and word.isalpha()):
                continue
            if word.isdigit() and len(word) <= 2:  # "am 3. Oktober"
                continue
        sentences.append(text[start:end].strip())
        start = match.end()
    tail = text[start:].strip()
    if tail:
        sentences.append(tail)
    return [s for s in sentences if s]


def extract_from_blocks(blocks: list[dict]) -> dict:
    """Find the Manuskript and Glossar in a flat block list.

    Returns {"stories": [{"heading", "paragraphs"}], "glossary": [{"term", "definition", "story"}],
    "marker": bool} where ``marker`` says whether a Manuskript/Nachricht heading was found.
    """
    start = None
    for i, block in enumerate(blocks):
        if MANUSKRIPT.match(block["text"]) and len(block["text"]) <= 60:
            start = i
            break
    if start is None:
        for i, block in enumerate(blocks):
            if is_heading(block) and STORY.match(block["text"]):
                start = i - 1
                break
    stories: list[dict] = []
    glossary: list[dict] = []
    if start is None:
        stories = _densest_paragraph_run(blocks)
        for block in blocks:
            if looks_like_gloss(block):
                entry = parse_gloss_entry(block)
                if entry:
                    glossary.append(dict(entry, story=None))
        return {"stories": stories, "glossary": glossary, "marker": False}

    mode = "text"
    current: dict | None = None
    pending_term: dict | None = None

    def story_index() -> int | None:
        return len(stories) - 1 if stories else None

    def new_story(heading: str) -> dict:
        # "Nachricht 1" followed by the real headline: keep one story, not an empty one.
        if stories and not stories[-1]["paragraphs"]:
            prev = stories[-1]
            if not prev["heading"] or STORY.match(prev["heading"]):
                prev["heading"] = heading
            else:
                prev["heading"] = f"{prev['heading']} – {heading}"
            return prev
        story = {"heading": heading, "paragraphs": []}
        stories.append(story)
        return story

    def short_bold(block: dict) -> bool:
        return bool(block["lead"]) and block["lead"] == block["text"] and \
            len(block["text"]) <= 60 and len(block["text"].split()) <= 8

    for block in blocks[start + 1:]:
        text = block["text"]
        real_heading = block["tag"] in HEADINGS
        if mode == "glossary" and not real_heading:
            if pending_term is not None and (block["tag"] == "dd" or not short_bold(block)) \
                    and not parse_gloss_entry(block):
                pending_term["definition"] = text
                glossary.append(pending_term)
                pending_term = None
                continue
            if GLOSSAR.match(text) and len(text) <= 30:
                continue
            if STOP.match(text) and len(text) <= 40:
                break
            if STORY.match(text):
                mode, pending_term = "text", None
                current = new_story(text)
                continue
            entry = parse_gloss_entry(block)
            if entry and entry["definition"]:
                glossary.append(dict(entry, story=story_index()))
            elif entry or short_bold(block):
                pending_term = {"term": text, "definition": "", "story": story_index()}
            continue
        if is_heading(block):
            if GLOSSAR.match(text):
                mode, pending_term = "glossary", None
                continue
            if STOP.match(text):
                break
            if MANUSKRIPT.match(text):
                mode = "text"
                continue
            mode = "text"
            current = new_story(text)
            continue
        # text mode
        if looks_like_gloss(block):
            entry = parse_gloss_entry(block)
            if entry:
                glossary.append(dict(entry, story=story_index()))
                continue
        if STOP.match(text) and len(text) <= 40:
            break
        if current is None:
            current = new_story("")
        current["paragraphs"].append(text)

    # Drop empty stories and point glossary entries at the remaining ones.
    remap, kept = {}, []
    for i, story in enumerate(stories):
        if story["paragraphs"]:
            remap[i] = len(kept)
            kept.append(story)
    for entry in glossary:
        old = entry.get("story")
        if old is not None:
            while old >= 0 and old not in remap:
                old -= 1
            entry["story"] = remap.get(old)
    return {"stories": kept, "glossary": _dedupe_glossary(glossary), "marker": True}


def _densest_paragraph_run(blocks: list[dict]) -> list[dict]:
    """No Manuskript heading: take the longest run of sentence-like paragraphs."""
    best: list[str] = []
    run: list[str] = []
    for block in blocks + [{"tag": "h2", "text": "", "lead": ""}]:
        sentence_like = block["tag"] in ("p", "li", "div", "blockquote") and \
            len(block["text"]) >= 40 and block["text"].rstrip()[-1:] in ".!?“\""
        if sentence_like:
            run.append(block["text"])
        else:
            if len(run) > len(best):
                best = run
            run = []
    return [{"heading": "", "paragraphs": best}] if len(best) >= 3 else []


def _dedupe_glossary(entries: list[dict]) -> list[dict]:
    seen, out = set(), []
    for entry in entries:
        key = entry["term"].lower()
        if entry.get("definition") and key not in seen:
            seen.add(key)
            out.append(entry)
    return out


def _walk_json(value, strings: list[str], pairs: list[dict], key: str = "") -> None:
    if isinstance(value, dict):
        lowered = {k.lower(): v for k, v in value.items() if isinstance(k, str)}
        term = next((lowered[k] for k in ("term", "word", "wort", "lemma") if isinstance(lowered.get(k), str)), None)
        meaning = next((lowered[k] for k in ("definition", "meaning", "explanation", "erklaerung", "erklärung")
                        if isinstance(lowered.get(k), str)), None)
        if term and meaning and len(term) <= 80 and len(meaning) <= 400:
            pairs.append({"term": norm(_strip_tags(term)), "definition": norm(_strip_tags(meaning))})
        for k, v in value.items():
            _walk_json(v, strings, pairs, str(k))
    elif isinstance(value, list):
        for v in value:
            _walk_json(v, strings, pairs, key)
    elif isinstance(value, str):
        if len(value) > 80 and re.search(r"<(p|h\d|strong|li|dt)\b", value):
            strings.append(value)
        elif key.lower() in ("articlebody", "manuscript", "manuskript", "transcript") and len(value) > 200:
            strings.append("".join(f"<p>{htmllib.escape(line)}</p>" for line in value.splitlines() if line.strip()))


def _strip_tags(text: str) -> str:
    return htmllib.unescape(re.sub(r"<[^>]+>", " ", text))


def embedded_json(markup: str) -> tuple[str, list[dict]]:
    """HTML fragments and term/definition pairs hidden in the page's JSON (Next.js, Apollo, JSON-LD)."""
    strings: list[str] = []
    pairs: list[dict] = []
    decoder = json.JSONDecoder()
    for match in re.finditer(r"<script\b([^>]*)>(.*?)</script>", markup, re.S | re.I):
        attrs, body = match.group(1), match.group(2).strip()
        data = None
        if "json" in attrs.lower() or "__NEXT_DATA__" in attrs:
            try:
                data = json.loads(body)
            except ValueError:
                data = None
        else:
            state = re.search(r"(?:__APOLLO_STATE__|__INITIAL_STATE__|__PRELOADED_STATE__|__NUXT__)\s*=\s*", body)
            if state:
                try:
                    data, _ = decoder.raw_decode(body[state.end():])
                except ValueError:
                    data = None
        if data is not None:
            _walk_json(data, strings, pairs)
    return "<div>" + "\n".join(strings) + "</div>", pairs


def parse_episode_page(markup: str) -> dict:
    """Best Manuskript + Glossar from a DW page: {"title", "stories", "glossary", "marker", "text"}."""
    page = parse_blocks(markup)
    candidates = [extract_from_blocks(page.blocks)]
    fragment, pairs = embedded_json(markup)
    if len(fragment) > 20:
        candidates.append(extract_from_blocks(parse_blocks(fragment).blocks))
    best = max(candidates, key=lambda c: (c["marker"], content_score(c)))
    if not best["glossary"] and pairs:
        best["glossary"] = _dedupe_glossary([dict(p, story=None) for p in pairs])
    title = norm(page.meta.get("og:title") or page.title)
    h1 = next((b["text"] for b in page.blocks if b["tag"] == "h1"), "")
    best["title"] = h1 or title
    best["text"] = " ".join(b["text"] for b in page.blocks[:400]) + " " + title
    best["links"] = page.links
    return best


def content_score(parsed: dict) -> int:
    sentences = sum(len(split_sentences(p)) for s in parsed.get("stories", []) for p in s["paragraphs"])
    return sentences + 2 * len(parsed.get("glossary", []))


# ---------------------------------------------------------------- episode record

SPEECH_ABBR = {
    r"\betw\.": "etwas", r"\bjmdn\.": "jemanden", r"\bjmdm\.": "jemandem", r"\bjmds\.": "jemandes",
    r"\bjdn\.": "jemanden", r"\bjdm\.": "jemandem", r"\bjds\.": "jemandes", r"\bjmd\.": "jemand",
}


def speech_text(term: str) -> str:
    """What TTS should read for a glossary term: no "|" markers, no grammar notes in brackets."""
    text = term.replace("|", "").replace("·", "")
    for pattern, repl in SPEECH_ABBR.items():
        text = re.sub(pattern, repl, text)
    text = re.sub(r"\((?:Pl|Sg|Akk|Dat|Gen|Nom|n|m|f|ugs|umg|hier|Plural|Singular)\.?[^)]*\)", "", text, flags=re.I)
    text = re.sub(r",\s*-\w*$", "", text)  # "der Vertrag, -¨e"
    return norm(text).strip(" ,;")


def build_episode(day: date, video: dict | None, page_url: str, parsed: dict | None,
                  headlines: list[str], level: str, now: str) -> dict:
    stories_out, glossary_out = [], []
    counter = 0
    parsed = parsed or {"stories": [], "glossary": []}
    for story in parsed["stories"]:
        sentences = []
        for paragraph in story["paragraphs"]:
            for sentence in split_sentences(paragraph):
                counter += 1
                sentences.append({"id": f"s{counter}", "de": sentence})
        if sentences:
            stories_out.append({"heading": story["heading"], "sentences": sentences})
    for n, entry in enumerate(parsed["glossary"], 1):
        story = entry.get("story")
        glossary_out.append({
            "id": f"g{n}",
            "term": entry["term"],
            "say": speech_text(entry["term"]),
            "definition": entry["definition"],
            "story": story if isinstance(story, int) and 0 <= story < len(stories_out) else None,
        })
    if not headlines:
        headlines = [s["heading"] for s in stories_out
                     if s["heading"] and not STORY.match(s["heading"]) and len(s["heading"]) <= 120][:6]
    status = "ok" if counter >= 3 else ("partial" if counter or glossary_out else "video_only")
    episode = {
        "schema": SCHEMA,
        "id": day.isoformat(),
        "date": day.isoformat(),
        "title": f"Kurz und leicht vom {day:%d.%m.%Y}",
        "level": level,
        "status": status,
        "video": None,
        "source": {
            "provider": "Deutsche Welle",
            "copyright": "© Deutsche Welle",
            "program_url": "https://www.dw.com/kurzundleicht",
            "url": page_url,
            "fetched_at": now,
        },
        "headlines": headlines,
        "stories": stories_out,
        "glossary": glossary_out,
    }
    if video:
        episode["video"] = {
            "youtube_id": video["video_id"],
            "title": video["title"],
            "published": video.get("published", ""),
            "url": f"https://www.youtube.com/watch?v={video['video_id']}",
        }
    return episode


def episode_score(episode: dict | None) -> int:
    if not episode:
        return -1
    sentences = sum(len(s["sentences"]) for s in episode.get("stories", []))
    return sentences + 2 * len(episode.get("glossary", []))


# ---------------------------------------------------------------- archive

def stable(episode: dict) -> str:
    copy = json.loads(json.dumps(episode))
    copy.get("source", {}).pop("fetched_at", None)
    return json.dumps(copy, ensure_ascii=False, sort_keys=True)


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def load_archive(archive: Path) -> dict[str, dict]:
    episodes = {}
    for path in sorted((archive / "episodes").glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            print(f"  skipped broken archive file {path.name}: {exc}", file=sys.stderr)
            continue
        if isinstance(data, dict) and data.get("id"):
            episodes[data["id"]] = data
    return episodes


def build_index(episodes: dict[str, dict]) -> dict:
    items = []
    for key in sorted(episodes, reverse=True):
        ep = episodes[key]
        items.append({
            "id": ep["id"],
            "date": ep["date"],
            "title": ep["title"],
            "status": ep.get("status", ""),
            "youtube_id": (ep.get("video") or {}).get("youtube_id", ""),
            "sentences": sum(len(s["sentences"]) for s in ep.get("stories", [])),
            "glossary": len(ep.get("glossary", [])),
            "headlines": ep.get("headlines", [])[:4],
        })
    updated = max((ep.get("source", {}).get("fetched_at", "") for ep in episodes.values()), default="")
    return {"schema": SCHEMA, "updated": updated, "latest": items[0]["id"] if items else "", "episodes": items}


def save_episode(archive: Path, episode: dict, previous: dict | None) -> bool:
    if previous and stable(previous) == stable(episode):
        return False
    write_json(archive / "episodes" / f"{episode['id']}.json", episode)
    return True


def prune(archive: Path, episodes: dict[str, dict], today: date, keep_days: int) -> list[str]:
    removed = []
    cutoff = (today - timedelta(days=keep_days)).isoformat()
    for key in list(episodes):
        if key < cutoff:
            (archive / "episodes" / f"{key}.json").unlink(missing_ok=True)
            del episodes[key]
            removed.append(key)
    return removed


# ---------------------------------------------------------------- main flow

def load_config(path: Path = CONFIG_PATH) -> dict:
    config = json.loads(path.read_text(encoding="utf-8"))
    config.setdefault("title_keywords", ["Kurz und leicht"])
    config.setdefault("dw_hosts", ["dw.com"])
    config.setdefault("lookback_days", 7)
    config.setdefault("retry_partial_days", 3)
    config.setdefault("keep_days", 365)
    config.setdefault("max_page_fetches", 6)
    config.setdefault("level", "A2")
    return config


class Run:
    def __init__(self, config: dict, archive: Path, fetcher: Fetcher, today: date,
                 dump_dir: Path | None = None, log: Callable[[str], None] = print):
        self.config, self.archive, self.fetcher, self.today = config, archive, fetcher, today
        self.dump_dir, self.log = dump_dir, log
        self.warnings: list[str] = []
        self.fetches = 0
        self._program_links: list[tuple[str, str]] | None = None
        self._cache: dict[str, tuple[str, str, bytes] | None] = {}

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        self.log("  warning: " + message)

    def get(self, url: str) -> tuple[str, str, bytes] | None:
        """(final_url, text, raw_body); each URL is fetched at most once per run."""
        if url in self._cache:
            return self._cache[url]
        try:
            final, body = self.fetcher(url)
        except Exception as exc:  # network trouble must never fail the build
            self.warn(f"{url}: {type(exc).__name__}: {exc}")
            self._cache[url] = None
            return None
        text = decode(body)
        if self.dump_dir:
            self.dump_dir.mkdir(parents=True, exist_ok=True)
            name = re.sub(r"[^A-Za-z0-9]+", "_", url)[-120:] + ".html"
            (self.dump_dir / name).write_text(text, encoding="utf-8")
        result = (final or url, text, body)
        self._cache[url] = result
        return result

    def in_window(self, day: date | None) -> bool:
        return bool(day) and self.today - timedelta(days=self.config["lookback_days"]) <= day <= self.today + timedelta(days=1)

    # -- sources
    def youtube_entries(self) -> list[dict]:
        for url in self.config.get("youtube_feeds", []):
            got = self.get(url)
            if not got:
                continue
            try:
                entries = parse_youtube_feed(got[2])
            except ET.ParseError as exc:
                self.warn(f"{url}: feed not readable ({exc})")
                continue
            if entries:
                self.log(f"youtube: {len(entries)} videos from {url}")
                return entries
        return []

    def program_links(self) -> list[tuple[str, str]]:
        """(absolute_url, anchor_text) for every link on the overview pages."""
        if self._program_links is not None:
            return self._program_links
        links: list[tuple[str, str]] = []
        for url in self.config.get("program_pages", []):
            got = self.get(url)
            if not got:
                continue
            final, text, _ = got
            for anchor in parse_blocks(text).links:
                href = urllib.parse.urljoin(final, anchor["href"])
                if href.startswith("http") and is_host(href, self.config["dw_hosts"]):
                    links.append((href.split("#")[0], anchor["text"]))
        self._program_links = links
        return links

    def candidates(self) -> dict[date, dict]:
        keywords = self.config["title_keywords"]
        found: dict[date, dict] = {}
        for entry in self.youtube_entries():
            if not contains_keyword(entry["title"], keywords) or "/shorts/" in entry["url"]:
                continue
            day = episode_day(entry["title"], entry["published"])
            if not self.in_window(day):
                continue
            slot = found.setdefault(day, {"links": [], "description": ""})
            if "video" not in slot:  # the feed is newest first
                slot["video"] = entry
                slot["description"] = entry["description"]
                slot["links"] += [u for u in urls_in(entry["description"]) if is_host(u, self.config["dw_hosts"])]
        for url in self.config.get("dw_feeds", []):
            got = self.get(url)
            if not got:
                continue
            try:
                items = parse_rss_items(got[2])
            except ET.ParseError as exc:
                self.warn(f"{url}: feed not readable ({exc})")
                continue
            for item in items:
                if not contains_keyword(item["title"] + " " + item["url"], keywords + ["kurzundleicht", "kurz-und-leicht"]):
                    continue
                day = episode_day(item["title"], item["published"])
                if not self.in_window(day):
                    continue
                slot = found.setdefault(day, {"links": [], "description": ""})
                if item["url"]:
                    slot["links"].append(item["url"])
                if len(item["description"]) > 400:
                    slot.setdefault("feed_html", item["description"])
        return found

    def add_program_candidates(self, found: dict[date, dict]) -> None:
        for href, text in self.program_links():
            for day in dates_in(text + " " + urllib.parse.unquote(href)):
                if self.in_window(day):
                    slot = found.setdefault(day, {"links": [], "description": ""})
                    if href not in slot["links"]:
                        slot["links"].append(href)

    # -- one day
    def best_page(self, day: date, slot: dict) -> tuple[str, dict | None]:
        best_url, best = "", None
        if slot.get("feed_html"):
            parsed = parse_episode_page(slot["feed_html"])
            if content_score(parsed):
                best_url, best = slot["links"][0] if slot["links"] else "", parsed
        tried = 0
        specific = set(slot["links"])
        queue = list(dict.fromkeys(slot["links"] + [u for u in self.config.get("program_pages", [])]))
        for url in queue:
            if tried >= self.config["max_page_fetches"]:
                break
            tried += 1
            got = self.get(url)
            if not got:
                continue
            final, markup, _ = got
            parsed = parse_episode_page(markup)
            generic = url not in specific or url in self.config.get("program_pages", [])
            if generic and not mentions_date(parsed["text"] + " " + final, day):
                continue  # an overview page showing some other day's episode
            if best is None or content_score(parsed) > content_score(best):
                best_url, best = final, parsed
            if best and best["marker"] and content_score(best) >= 10:
                break
        return best_url, best

    def process(self, refetch: str | None = None) -> dict:
        archive_episodes = load_archive(self.archive)
        found = self.candidates()
        needs_program = not found or any(
            not archive_episodes.get(d.isoformat()) or archive_episodes[d.isoformat()].get("status") != "ok"
            for d in found)
        if refetch:
            day = date.fromisoformat(refetch)
            found.setdefault(day, {"links": [], "description": ""})
            needs_program = True
        if needs_program and self.config.get("program_pages"):
            self.add_program_candidates(found)
        if not found:
            self.log("no Kurz und leicht episode in the last "
                     f"{self.config['lookback_days']} days (weekend, holiday or feeds unavailable); archive unchanged")
        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        written, skipped = [], []
        for day in sorted(found, reverse=True):
            key = day.isoformat()
            slot = found[day]
            previous = archive_episodes.get(key)
            video = slot.get("video")
            same_video = previous and (not video or (previous.get("video") or {}).get("youtube_id") == video["video_id"])
            if key != refetch and previous and same_video:
                if previous.get("status") == "ok":
                    skipped.append(key)
                    continue
                if (self.today - day).days > self.config["retry_partial_days"]:
                    skipped.append(key)
                    continue
            page_url, parsed = self.best_page(day, slot)
            headlines = headlines_from_description(slot.get("description", ""))
            episode = build_episode(day, video, page_url, parsed, headlines, self.config["level"], now)
            if previous and episode_score(previous) > episode_score(episode):
                # Never replace a richer copy with a poorer one (e.g. DW page temporarily down).
                keep = json.loads(json.dumps(previous))
                if video and not keep.get("video"):
                    keep["video"] = episode["video"]
                episode = keep
            if not previous and not video and episode["status"] == "video_only":
                self.warn(f"{key}: no video and no transcript found; nothing stored")
                continue
            if save_episode(self.archive, episode, previous):
                written.append(key)
                archive_episodes[key] = episode
                self.log(f"{key}: {episode['status']} · {episode_score(episode)} points · "
                         f"{sum(len(s['sentences']) for s in episode['stories'])} sentences · "
                         f"{len(episode['glossary'])} Glossar · page {page_url or '-'}")
            else:
                skipped.append(key)
        removed = prune(self.archive, archive_episodes, self.today, self.config["keep_days"])
        index_path = self.archive / "index.json"
        index = build_index(archive_episodes)
        old_index = None
        if index_path.exists():
            try:
                old_index = json.loads(index_path.read_text(encoding="utf-8"))
            except ValueError:
                old_index = None
        if old_index != index:
            write_json(index_path, index)
        return {"written": written, "unchanged": skipped, "removed": removed,
                "warnings": self.warnings, "episodes": len(archive_episodes)}


def step_summary(result: dict) -> None:
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    lines = ["### DW Kurz und leicht", ""]
    lines.append(f"- new or updated: {', '.join(result['written']) or 'none'}")
    lines.append(f"- unchanged: {', '.join(result['unchanged']) or 'none'}")
    lines.append(f"- episodes in archive: {result['episodes']}")
    for warning in result["warnings"][:10]:
        lines.append(f"- ⚠️ {warning}")
    with open(path, "a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--archive", type=Path, default=ARCHIVE)
    parser.add_argument("--config", type=Path, default=CONFIG_PATH)
    parser.add_argument("--refetch", metavar="YYYY-MM-DD", help="fetch this day again even if it is complete")
    parser.add_argument("--dump-html", type=Path, metavar="DIR", help="save every fetched page here")
    parser.add_argument("--from-html", type=Path, metavar="FILE", help="parse a saved page and print the result")
    parser.add_argument("--date", help="date for --from-html (YYYY-MM-DD)")
    parser.add_argument("--strict", action="store_true", help="exit 1 when nothing could be fetched")
    args = parser.parse_args(argv)

    if args.from_html:
        day = date.fromisoformat(args.date) if args.date else datetime.now(BERLIN).date()
        parsed = parse_episode_page(decode(args.from_html.read_bytes()))
        episode = build_episode(day, None, str(args.from_html), parsed, [], "A2", "")
        print(json.dumps({k: episode[k] for k in ("status", "headlines", "stories", "glossary")},
                         ensure_ascii=False, indent=1))
        return 0

    config = load_config(args.config)
    today = datetime.now(BERLIN).date()
    run = Run(config, args.archive, fetch, today, dump_dir=args.dump_html)
    try:
        result = run.process(refetch=args.refetch)
    except Exception as exc:  # last line of defence: the site build must go on
        print(f"dw fetch failed unexpectedly: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1 if args.strict else 0
    print("dw kurz und leicht:", json.dumps({k: v for k, v in result.items() if k != "warnings"}, ensure_ascii=False))
    step_summary(result)
    if args.strict and not result["written"] and result["warnings"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
