"""Movie lessons are built into GitHub Pages without publishing source subtitles."""
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class MovieBuildTests(unittest.TestCase):
    def test_movie_metadata_and_cue_ranges(self):
        path = ROOT / "data/movie_lessons/good-bye-lenin-2003.json"
        m = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(m["movie_id"], "good-bye-lenin-2003")
        self.assertEqual(m["subtitle_source"]["cue_count"], 1202)
        self.assertFalse(m["subtitle_source"]["video_sync_verified"])
        self.assertEqual(len(m["chapters"]), 8)
        self.assertEqual(sum(len(c["vocabulary"]) for c in m["chapters"]), 32)
        self.assertEqual(sum(len(c["discussion"]) for c in m["chapters"]), 16)
        for scene in m["chapters"]:
            self.assertGreater(scene["source_end_ms"], scene["source_start_ms"])
            self.assertGreater(scene["source_cue_end"], scene["source_cue_start"])
            for word in scene["vocabulary"]:
                self.assertGreaterEqual(word["source_cue_id"], scene["source_cue_start"])
                self.assertLessEqual(word["source_cue_id"], scene["source_cue_end"])

    def test_site_contains_movie_lessons(self):
        spec = importlib.util.spec_from_file_location("dq_build", ROOT / "tools/build_site.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        info = mod.build_movies()
        self.assertEqual(info, {"movies": 1, "chapters": 8})
        published = json.loads((mod.SITE_DATA / "movies.json").read_text(encoding="utf-8"))
        self.assertEqual(len(published["movies"]), 1)
        self.assertEqual(len(published["movies"][0]["chapters"]), 8)
        self.assertFalse((mod.SITE_DATA / "good-bye-lenin-2003.srt").exists())


if __name__ == "__main__":
    unittest.main()
