"""DW "Kurz und leicht": feed and page parsing, archive updates, site publishing and audio keys."""

import importlib.util
import json
from datetime import date
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "dw_kurz"


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tools" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


dw = load("fetch_dw_kurz", "fetch_dw_kurz.py")
site = load("build_site_for_dw", "build_site.py")
audio = load("build_dw_audio", "build_dw_audio.py")

FEED = "https://www.youtube.com/feeds/videos.xml?channel_id=UCxUWIEL-USsiPak0Qy6_vVg"
PROGRAM = "https://www.dw.com/kurzundleicht"
EP26 = "https://learngerman.dw.com/de/kurz-und-leicht-vom-26112026/l-70000001"
EP25 = "https://learngerman.dw.com/de/kurz-und-leicht-vom-25112026/l-70000000"
EP24 = "https://learngerman.dw.com/de/kurz-und-leicht-vom-24112026/l-69999999"


def fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def fake_web(pages: dict[str, tuple[str, bytes]], calls: list[str] | None = None):
    def fetcher(url):
        if calls is not None:
            calls.append(url)
        if url not in pages:
            raise OSError(f"offline: {url}")
        final, body = pages[url]
        return final or url, body
    return fetcher


def full_web():
    return {
        FEED: ("", fixture("youtube_feed.xml")),
        PROGRAM: ("https://learngerman.dw.com/de/kurz-und-leicht/s-1", fixture("program.html")),
        EP26: ("", fixture("episode_headings.html")),
        EP25: ("", fixture("episode_dl.html")),
        EP24: ("", fixture("episode_next.html")),
    }


def quiet(_message):
    pass


class FeedTest(unittest.TestCase):
    def test_youtube_feed_entries(self):
        entries = dw.parse_youtube_feed(fixture("youtube_feed.xml"))
        self.assertEqual([e["video_id"] for e in entries], ["AbCdEfGhI_1", "qbtwkT0ul6o", "ZZZZZZZZZZZ", "prevDay0001"])
        episode = entries[1]
        self.assertIn("Kurz und leicht vom 26.11.2026", episode["title"])
        self.assertEqual(episode["url"], "https://www.youtube.com/watch?v=qbtwkT0ul6o")
        self.assertIn("learngerman.dw.com", episode["description"])

    def test_episode_day_prefers_title_then_berlin_publish_date(self):
        self.assertEqual(dw.episode_day("Kurz und leicht vom 26.11.2026", "2026-11-20T10:00:00Z"), date(2026, 11, 26))
        # 23:30 UTC is already the next day in Munich.
        self.assertEqual(dw.episode_day("Kurz und leicht", "2026-11-26T23:30:00+00:00"), date(2026, 11, 27))
        self.assertIsNone(dw.episode_day("Kurz und leicht", ""))

    def test_dates_in_titles_slugs_and_long_form(self):
        self.assertIn(date(2026, 11, 26), dw.dates_in("kurz-und-leicht-vom-26112026/l-70000001"))
        self.assertIn(date(2026, 11, 24), dw.dates_in("24. November 2026"))
        self.assertIn(date(2026, 11, 3), dw.dates_in("vom 3.11.2026"))
        self.assertEqual(dw.dates_in("Artikel a-12345678"), [])

    def test_headlines_from_description(self):
        text = "- Waffenruhe im Nahen Osten verlängert\n- Bahnstreik in Bayern\nMehr: https://dw.com/x #deutschlernen"
        self.assertEqual(dw.headlines_from_description(text), ["Waffenruhe im Nahen Osten verlängert", "Bahnstreik in Bayern"])


class PageParsingTest(unittest.TestCase):
    def test_headings_layout_with_glossary_per_story(self):
        parsed = dw.parse_episode_page(fixture("episode_headings.html").decode("utf-8"))
        self.assertTrue(parsed["marker"])
        self.assertEqual([s["heading"] for s in parsed["stories"]],
                         ["Waffenruhe im Nahen Osten verlängert", "Bahnstreik in Bayern", "Rekordschnee in den Alpen"])
        terms = {g["term"]: g for g in parsed["glossary"]}
        self.assertEqual(list(terms), ["die Waffenruhe", "etwas verlängern", "streiken", "die Gewerkschaft, -en",
                                       "aus|fallen", "gesperrt"])
        self.assertEqual(terms["streiken"]["story"], 1)
        self.assertEqual(terms["gesperrt"]["definition"], "geschlossen; man darf dort nicht fahren")
        # Exercises after the transcript and the footer stay out.
        text = " ".join(p for s in parsed["stories"] for p in s["paragraphs"])
        self.assertNotIn("Frage 1", text)
        self.assertNotIn("Deutsche Welle", text)

    def test_definition_list_layout(self):
        parsed = dw.parse_episode_page(fixture("episode_dl.html").decode("utf-8"))
        self.assertEqual([g["term"] for g in parsed["glossary"]], ["das Gesetz, -e", "der Kritiker, -", "das Siegtor"])
        self.assertEqual(len(parsed["stories"]), 1)
        self.assertNotIn("Hier herunterladen.", parsed["stories"][0]["paragraphs"])

    def test_embedded_json_layout(self):
        parsed = dw.parse_episode_page(fixture("episode_next.html").decode("utf-8"))
        self.assertEqual(dw.content_score(parsed), 4 + 2 * 2)
        self.assertEqual(parsed["glossary"][1], {"term": "der Eintritt", "definition": "das Geld, das man für den Besuch bezahlt", "story": None})

    def test_separate_term_and_definition_blocks(self):
        markup = """<h2>Manuskript</h2><p>Die Preise steigen. Viele Menschen sparen. Das ist schwer.</p>
        <h3>Glossar</h3><p><strong>steigen</strong></p><p>höher werden</p><p><strong>sparen</strong></p><p>weniger Geld ausgeben</p>"""
        parsed = dw.parse_episode_page(markup)
        self.assertEqual([(g["term"], g["definition"]) for g in parsed["glossary"]],
                         [("steigen", "höher werden"), ("sparen", "weniger Geld ausgeben")])

    def test_page_without_markers_uses_densest_paragraph_run(self):
        markup = "<nav><p>Menü</p></nav><div><p>Kurzer Satz.</p></div><article>" + "".join(
            f"<p>Das ist der {n}. lange Satz in einem Text über das Wetter in Bayern.</p>" for n in range(1, 5)) + "</article>"
        parsed = dw.parse_episode_page(markup)
        self.assertFalse(parsed["marker"])
        self.assertEqual(len(parsed["stories"][0]["paragraphs"]), 4)

    def test_sentence_splitting_keeps_abbreviations_dates_and_quotes(self):
        self.assertEqual(dw.split_sentences(
            "Viele Züge fallen aus, z. B. zwischen München und Augsburg. Der Streik dauert bis zum 28. November. "
            "Sie sagte: „Wir kommen.“ Dann ging sie. Das war 2025. Danach kam Dr. Meier."),
            ["Viele Züge fallen aus, z. B. zwischen München und Augsburg.", "Der Streik dauert bis zum 28. November.",
             "Sie sagte: „Wir kommen.“", "Dann ging sie.", "Das war 2025.", "Danach kam Dr. Meier."])

    def test_speech_text_for_glossary_terms(self):
        self.assertEqual(dw.speech_text("aus|fallen"), "ausfallen")
        self.assertEqual(dw.speech_text("die Gewerkschaft, -en"), "die Gewerkschaft")
        self.assertEqual(dw.speech_text("jmdn. etw. fragen"), "jemanden etwas fragen")
        self.assertEqual(dw.speech_text("der Vertrag (Pl. Verträge)"), "der Vertrag")


class ArchiveRunTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.archive = Path(self.tmp.name)
        self.config = dw.load_config()

    def tearDown(self):
        self.tmp.cleanup()

    def run_once(self, pages, today=date(2026, 11, 26), calls=None, **kw):
        return dw.Run(self.config, self.archive, fake_web(pages, calls), today, log=quiet).process(**kw)

    def episode(self, key):
        return json.loads((self.archive / "episodes" / f"{key}.json").read_text(encoding="utf-8"))

    def test_first_run_stores_episodes_and_index(self):
        result = self.run_once(full_web())
        self.assertEqual(result["written"], ["2026-11-26", "2026-11-25", "2026-11-24"])
        ep = self.episode("2026-11-26")
        self.assertEqual(ep["status"], "ok")
        self.assertEqual(ep["video"]["youtube_id"], "qbtwkT0ul6o")
        self.assertEqual(ep["source"]["url"], EP26)
        self.assertEqual(ep["headlines"][1], "Bahnstreik in Bayern")
        self.assertEqual(ep["stories"][0]["sentences"][0], {"id": "s1", "de": "Die Waffenruhe im Nahen Osten wird um zwei Wochen verlängert."})
        self.assertEqual(ep["glossary"][4]["say"], "ausfallen")
        # Found only on the overview page: no video, transcript still kept.
        self.assertIsNone(self.episode("2026-11-24")["video"])
        index = json.loads((self.archive / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(index["latest"], "2026-11-26")
        self.assertEqual([e["id"] for e in index["episodes"]], ["2026-11-26", "2026-11-25", "2026-11-24"])
        self.assertEqual(index["episodes"][0]["glossary"], 6)

    def test_second_run_changes_nothing_and_fetches_only_the_feed(self):
        self.run_once(full_web())
        before = {p.name: p.read_bytes() for p in self.archive.rglob("*.json")}
        calls = []
        result = self.run_once(full_web(), calls=calls)
        self.assertEqual(result["written"], [])
        self.assertEqual(calls, [FEED])
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.archive.rglob("*.json")})

    def test_offline_or_weekend_run_is_harmless(self):
        self.run_once(full_web())
        before = {p.name: p.read_bytes() for p in self.archive.rglob("*.json")}
        result = self.run_once({}, today=date(2026, 11, 28))
        self.assertEqual(result["written"], [])
        self.assertTrue(result["warnings"])
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.archive.rglob("*.json")})
        empty = dw.Run(self.config, Path(self.tmp.name) / "fresh", fake_web({}), date(2026, 11, 28), log=quiet).process()
        self.assertEqual(empty["episodes"], 0)
        self.assertTrue((Path(self.tmp.name) / "fresh" / "index.json").exists())

    def test_video_without_dw_page_is_kept_and_retried_later(self):
        pages = {FEED: ("", fixture("youtube_feed.xml"))}
        self.run_once(pages)
        self.assertEqual(self.episode("2026-11-26")["status"], "video_only")
        self.assertEqual(self.episode("2026-11-26")["headlines"][0], "Waffenruhe im Nahen Osten verlängert")
        result = self.run_once(full_web())
        self.assertIn("2026-11-26", result["written"])
        self.assertEqual(self.episode("2026-11-26")["status"], "ok")

    def test_richer_copy_is_never_replaced_by_poorer_one(self):
        self.run_once(full_web())
        pages = {FEED: ("", fixture("youtube_feed.xml"))}  # DW down
        self.run_once(pages, refetch="2026-11-26")
        self.assertEqual(len(self.episode("2026-11-26")["glossary"]), 6)

    def test_overview_page_showing_another_day_is_not_used(self):
        pages = {FEED: ("", fixture("youtube_feed.xml")), PROGRAM: ("", fixture("episode_headings.html"))}
        self.run_once(pages, today=date(2026, 11, 26))
        # The 25th has a video but only the 26th's page is reachable: no wrong transcript.
        self.assertEqual(self.episode("2026-11-25")["stories"], [])

    def test_old_episodes_are_pruned(self):
        self.run_once(full_web())
        self.config["keep_days"] = 1
        self.run_once({}, today=date(2026, 11, 26))
        self.assertEqual(sorted(p.stem for p in (self.archive / "episodes").glob("*.json")), ["2026-11-25", "2026-11-26"])

    def test_cli_parses_saved_page(self):
        import contextlib
        import io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = dw.main(["--from-html", str(FIXTURES / "episode_dl.html"), "--date", "2026-11-25"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["status"], "ok")


class PublishTest(unittest.TestCase):
    def test_build_dw_copies_archive_and_rebuilds_index(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "archive"
            dw.Run(dw.load_config(), archive, fake_web(full_web()), date(2026, 11, 26), log=quiet).process()
            (archive / "episodes" / "notes.json").write_text('{"id": "../x"}', encoding="utf-8")
            original = site.SITE_DATA
            site.SITE_DATA = Path(tmp) / "site_data"
            try:
                result = site.build_dw(archive)
                published = sorted(p.name for p in (site.SITE_DATA / "dw").glob("*.json"))
            finally:
                site.SITE_DATA = original
        self.assertEqual(result, {"episodes": 3, "latest": "2026-11-26"})
        self.assertEqual(published, ["2026-11-24.json", "2026-11-25.json", "2026-11-26.json", "index.json"])

    def test_build_dw_without_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            original = site.SITE_DATA
            site.SITE_DATA = Path(tmp)
            try:
                result = site.build_dw(Path(tmp) / "missing")
                index = json.loads((Path(tmp) / "dw" / "index.json").read_text(encoding="utf-8"))
            finally:
                site.SITE_DATA = original
        self.assertEqual(result["episodes"], 0)
        self.assertEqual(index["episodes"], [])


class AudioKeyTest(unittest.TestCase):
    def test_keys_match_speech_js_chop(self):
        # speech.js splits after . ! ? ; : and joins the pieces with one space (see tests/test_dw_games.js).
        self.assertEqual(audio.client_key("Der FC Bayern hat 2:1 gewonnen."), "Der FC Bayern hat 2: 1 gewonnen.")
        self.assertEqual(audio.client_key("  hier:  nicht   stattfinden "), "hier: nicht stattfinden")

    def test_collects_terms_definitions_and_sentences_of_recent_episodes(self):
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp)
            dw.Run(dw.load_config(), archive, fake_web(full_web()), date(2026, 11, 26), log=quiet).process()
            texts = audio.collect_texts(archive, 1)
        self.assertIn("ausfallen", texts)
        self.assertIn("aus Protest nicht arbeiten", texts)
        self.assertIn("Einige Straßen sind gesperrt.", texts)
        self.assertNotIn("Das Siegtor fiel in der 89. Minute.", texts)  # older episode

    def test_missing_edge_tts_is_not_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(audio.main(["--archive", str(Path(tmp) / "none"), "--out", tmp]), 0)


if __name__ == "__main__":
    unittest.main()
