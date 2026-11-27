"""DW translations (tools/translate_dw.py): Gemini answers, validation, model fallback and site merge."""

import importlib.util
import io
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "dw_kurz" / "episode_2026-11-26.json"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "tools" / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


tr = load("translate_dw", "translate_dw.py")
site = load("build_site_for_translate", "build_site.py")


def answer_for(prompt: str, extra_bad: bool = True, coverage: float = 1.0) -> dict:
    """What a well-behaved model would return for the prompt (plus some junk to be filtered)."""
    data = json.loads(prompt[prompt.index("{"):])
    sentences = data["sentences"][:max(0, round(len(data["sentences"]) * coverage))]
    out = {"sentences": [], "glossary": [], "headlines": [f"標題{n}" for n, _ in enumerate(data["headlines"])]}
    for s in sentences:
        words = [{"i": int(w.split("=", 1)[0]), "lemma": w.split("=", 1)[1], "zh": "義"} for w in s["words"]]
        if extra_bad:
            words.append({"i": 999, "lemma": "x", "zh": "y"})
        out["sentences"].append({"id": s["id"], "zh": f"中文 {s['id']}", "words": words})
    if extra_bad:
        out["sentences"].append({"id": "s999", "zh": "不存在", "words": []})
    out["glossary"] = [{"id": g["id"], "zh": f"詞 {g['id']}"} for g in data["glossary"]]
    return out


class FakeGemini:
    def __init__(self, script=None, coverage=1.0):
        self.calls = []
        self.script = list(script or [])
        self.coverage = coverage

    def __call__(self, url, payload, headers):
        self.calls.append({"url": url, "payload": payload, "headers": headers})
        if self.script:
            status, body = self.script.pop(0)
            if status != 200:
                return status, body
        prompt = payload["contents"][0]["parts"][0]["text"]
        text = json.dumps(answer_for(prompt, coverage=self.coverage), ensure_ascii=False)
        return 200, {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def quiet(_message):
    pass


class TranslateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.archive = Path(self.tmp.name) / "archive"
        (self.archive / "episodes").mkdir(parents=True)
        shutil.copy(FIXTURE, self.archive / "episodes" / "2026-11-26.json")
        self.episode = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def tearDown(self):
        self.tmp.cleanup()

    def translation(self):
        return json.loads((self.archive / "translations" / "2026-11-26.json").read_text(encoding="utf-8"))

    def test_tokenisation_matches_the_site(self):
        # Same literal as tests/test_dw_games.js ("tokenize keeps every character …").
        self.assertEqual(tr.words("Die USA-Regierung hat’s am 3. Mai gesagt: „Wir kommen!“"),
                         ["Die", "USA-Regierung", "hat’s", "am", "3", "Mai", "gesagt", "Wir", "kommen"])

    def test_translation_is_validated_and_saved(self):
        fake = FakeGemini()
        result = tr.run(self.archive, "KEY", post=fake, log=quiet)
        self.assertEqual(result["translated"], ["2026-11-26"])
        self.assertEqual(fake.calls[0]["headers"], {"x-goog-api-key": "KEY"})
        self.assertIn("gemini-flash-latest:generateContent", fake.calls[0]["url"])
        self.assertIn("responseSchema", fake.calls[0]["payload"]["generationConfig"])
        saved = self.translation()
        self.assertEqual(saved["episode_hash"], tr.episode_hash(self.episode))
        self.assertEqual(saved["sentences"]["s1"]["zh"], "中文 s1")
        self.assertEqual(saved["sentences"]["s1"]["words"]["1"], {"l": "Waffenruhe", "zh": "義"})
        self.assertNotIn("999", saved["sentences"]["s1"]["words"])
        self.assertNotIn("s999", saved["sentences"])
        self.assertEqual(saved["glossary"]["g5"], "詞 g5")
        self.assertEqual(saved["headlines"], ["標題0", "標題1", "標題2"])

    def test_unchanged_episode_is_not_translated_again(self):
        tr.run(self.archive, "KEY", post=FakeGemini(), log=quiet)
        again = FakeGemini()
        result = tr.run(self.archive, "KEY", post=again, log=quiet)
        self.assertEqual(again.calls, [])
        self.assertEqual(result["unchanged"], ["2026-11-26"])

    def test_changed_transcript_gets_a_new_translation_and_stale_one_is_not_published(self):
        tr.run(self.archive, "KEY", post=FakeGemini(), log=quiet)
        self.episode["stories"][0]["sentences"][0]["de"] = "Die Waffenruhe hält."
        (self.archive / "episodes" / "2026-11-26.json").write_text(json.dumps(self.episode, ensure_ascii=False), encoding="utf-8")
        stale = tr.merge_translation(self.episode, self.translation())
        self.assertNotIn("zh", stale["stories"][0]["sentences"][0])
        fake = FakeGemini()
        tr.run(self.archive, "KEY", post=fake, log=quiet)
        self.assertEqual(len(fake.calls), 1)

    def test_model_fallback_and_schema_retry(self):
        fake = FakeGemini(script=[(404, {"error": {"message": "models/gemini-flash-latest is not found"}}),
                                  (400, {"error": {"message": "Invalid schema"}})])
        result = tr.run(self.archive, "KEY", post=fake, log=quiet)
        self.assertEqual(result["translated"], ["2026-11-26"])
        self.assertIn("gemini-2.5-flash:generateContent", fake.calls[1]["url"])
        self.assertNotIn("responseSchema", fake.calls[2]["payload"]["generationConfig"])
        self.assertEqual(self.translation()["model"], "gemini-2.5-flash")

    def test_rate_limit_and_bad_answers_save_nothing(self):
        result = tr.run(self.archive, "KEY", post=FakeGemini(script=[(429, {"error": {"message": "quota"}})]), log=quiet)
        self.assertEqual(result["failed"], ["2026-11-26"])
        self.assertFalse((self.archive / "translations" / "2026-11-26.json").exists())
        result = tr.run(self.archive, "KEY", post=FakeGemini(coverage=0.3), log=quiet)
        self.assertEqual(result["failed"], ["2026-11-26"])
        self.assertFalse((self.archive / "translations" / "2026-11-26.json").exists())

    def test_without_key_nothing_happens(self):
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": ""}), redirect_stdout(out):
            self.assertEqual(tr.main(["--archive", str(self.archive)]), 0)
        self.assertIn("skipped", out.getvalue())
        self.assertFalse((self.archive / "translations").exists())

    def test_site_build_publishes_chinese(self):
        tr.run(self.archive, "KEY", post=FakeGemini(), log=quiet)
        original = site.SITE_DATA
        site.SITE_DATA = Path(self.tmp.name) / "site_data"
        try:
            result = site.build_dw(self.archive)
            published = json.loads((site.SITE_DATA / "dw" / "2026-11-26.json").read_text(encoding="utf-8"))
        finally:
            site.SITE_DATA = original
        self.assertEqual(result["translated"], 1)
        first = published["stories"][0]["sentences"][0]
        self.assertEqual(first["zh"], "中文 s1")
        self.assertEqual(first["words"]["0"], {"l": "Die", "zh": "義"})
        self.assertEqual(published["glossary"][0]["zh"], "詞 g1")
        self.assertEqual(published["headlines_zh"][1], "標題1")
        self.assertTrue(published["translated"])

    def test_prompt_numbers_every_word(self):
        prompt = tr.build_prompt(self.episode)
        data = json.loads(prompt[prompt.index("{"):])
        self.assertEqual(data["sentences"][0]["words"][:3], ["0=Die", "1=Waffenruhe", "2=im"])
        self.assertTrue(re.search(r"繁體中文", prompt))


if __name__ == "__main__":
    unittest.main()
