"""Check feed parsing, news merging and the bundled lesson content."""

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_site", ROOT / "tools" / "build_site.py")
mod = importlib.util.module_from_spec(SPEC)
sys.modules["build_site"] = mod
SPEC.loader.exec_module(mod)

RSS = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Feed</title>
<item><title>Erste &amp; wichtigste Meldung</title><link>https://example.org/a</link>
<description>&lt;p&gt;Ein &lt;b&gt;kurzer&lt;/b&gt; Text.&lt;/p&gt;</description>
<pubDate>Mon, 16 Nov 2026 06:00:00 +0100</pubDate></item>
<item><title>Ohne Link</title></item>
<item><title>Zweite Meldung</title><link>https://example.org/b</link></item>
</channel></rss>"""

ATOM = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title>
<entry><title>Atom-Meldung</title><link rel="alternate" href="https://example.org/c"/>
<summary>Zusammenfassung</summary><updated>2026-11-16T05:00:00Z</updated></entry>
</feed>"""

RDF = b"""<?xml version="1.0" encoding="utf-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"
 xmlns:dc="http://purl.org/dc/elements/1.1/">
<item rdf:about="https://example.org/d"><title>RDF-Meldung</title><link>https://example.org/d</link>
<dc:date>2026-11-16T07:30:00+01:00</dc:date></item>
</rdf:RDF>"""


class ParseFeedTest(unittest.TestCase):
    def test_rss_items_are_cleaned_and_incomplete_ones_dropped(self):
        items = mod.parse_feed(RSS, "Quelle")
        self.assertEqual([i["title"] for i in items], ["Erste & wichtigste Meldung", "Zweite Meldung"])
        self.assertEqual(items[0]["teaser"], "Ein kurzer Text.")
        self.assertEqual(items[0]["published"], "2026-11-16T05:00:00+00:00")
        self.assertEqual(items[0]["source"], "Quelle")

    def test_atom_and_rdf_are_supported(self):
        atom = mod.parse_feed(ATOM, "A")
        self.assertEqual(atom[0]["url"], "https://example.org/c")
        self.assertEqual(atom[0]["teaser"], "Zusammenfassung")
        rdf = mod.parse_feed(RDF, "R")
        self.assertEqual(rdf[0]["title"], "RDF-Meldung")
        self.assertEqual(rdf[0]["published"], "2026-11-16T06:30:00+00:00")

    def test_long_teasers_are_shortened(self):
        text = mod.shorten("Wort " * 100)
        self.assertLessEqual(len(text), mod.TEASER_LIMIT + 2)
        self.assertTrue(text.endswith("…"))


class BuildNewsTest(unittest.TestCase):
    def test_broken_feed_is_reported_and_others_are_interleaved(self):
        original = mod.SITE_DATA
        with tempfile.TemporaryDirectory() as tmp:
            mod.SITE_DATA = Path(tmp)
            try:
                def fake_fetch(url):
                    if "tagesschau" in url:
                        return RSS
                    if "deutschlandfunk" in url:
                        return ATOM
                    raise OSError("offline")
                result = mod.build_news(fake_fetch)
                payload = json.loads((Path(tmp) / "news.json").read_text(encoding="utf-8"))
            finally:
                mod.SITE_DATA = original
        germany = next(g for g in payload["groups"] if g["id"] == "deutschland")
        self.assertEqual([i["url"] for i in germany["items"]],
                         ["https://example.org/a", "https://example.org/c", "https://example.org/b"])
        munich = next(g for g in payload["groups"] if g["id"] == "muenchen")
        self.assertEqual(munich["items"], [])
        self.assertTrue(munich["fallback_url"].startswith("https://"))
        self.assertEqual(len(result["errors"]), 3)


class LessonLoadingTest(unittest.TestCase):
    def test_lesson_files_may_be_lists_or_wrapped_and_bad_entries_are_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = Path(tmp) / "a.json"
            a.write_text(json.dumps([{"episode_id": "S01E01"}, {"note": "no id"}, "text"]), encoding="utf-8")
            b = Path(tmp) / "b.json"
            b.write_text(json.dumps({"lessons": [{"episode_id": "S02E03"}]}), encoding="utf-8")
            c = Path(tmp) / "c.json"
            c.write_text("{not json", encoding="utf-8")
            self.assertEqual([x["episode_id"] for x in mod.read_lessons(a)], ["S01E01"])
            self.assertEqual([x["episode_id"] for x in mod.read_lessons(b)], ["S02E03"])
            self.assertEqual(mod.read_lessons(c), [])

    def test_every_repository_lesson_reaches_the_site(self):
        original = mod.SITE_DATA
        with tempfile.TemporaryDirectory() as tmp:
            mod.SITE_DATA = Path(tmp)
            try:
                counts = mod.build_friends()
                built = json.loads((Path(tmp) / "friends.json").read_text(encoding="utf-8"))
            finally:
                mod.SITE_DATA = original
        expected = set()
        for path in (ROOT / "data" / "subtitle_lessons").glob("*.json"):
            expected |= {x["episode_id"] for x in mod.read_lessons(path)}
        self.assertEqual(set(built["lessons"]), expected)
        self.assertEqual(counts["episodes"], 236)
        self.assertTrue(set(built["lessons"]) <= set(built["subtitled"]) | set(built["lessons"]))
        for lesson in built["lessons"].values():
            for word in lesson["vocabulary"]:
                self.assertNotIn("source_cue_id", word)


class ContentTest(unittest.TestCase):
    def load(self, name):
        return json.loads((ROOT / "site" / "content" / name).read_text(encoding="utf-8"))

    def test_citizenship_questions_have_four_distinct_options(self):
        data = self.load("einbuergerung.json")
        self.assertGreaterEqual(len(data["questions"]), 30)
        for q in data["questions"]:
            self.assertEqual(len(q["opts"]), 4, q["q"])
            self.assertEqual(len(set(q["opts"])), 4, q["q"])
            self.assertTrue(q["zh"] and q["why"], q["q"])

    def test_driving_phrases_are_unique_pairs(self):
        data = self.load("fahrpruefung.json")
        pairs = [tuple(i) for g in data["groups"] for i in g["items"]]
        self.assertEqual(len(pairs), len({p[0] for p in pairs}))
        self.assertEqual(len(pairs), len({p[1] for p in pairs}))

    def test_life_zones_and_friends_cards_are_well_formed(self):
        for zone in self.load("life.json"):
            self.assertTrue(zone["role_de"])
            for phrase in zone["phrases"]:
                self.assertEqual(len(phrase), 3)
        episodes = json.loads((ROOT / "friends_episodes_236.json").read_text(encoding="utf-8"))
        known = {e["episode_id"] for e in episodes}
        for episode_id, entry in self.load("friends_cards.json")["episodes"].items():
            self.assertIn(episode_id, known)
            for before, after, options, answer, zh in entry["drill"]:
                self.assertEqual(len(options), 3)
                self.assertIn(answer, (0, 1, 2))


if __name__ == "__main__":
    unittest.main()
