"""Validate cross-batch deduplication and exact lesson/source references."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("build_subtitle_coverage", Path(__file__).resolve().parents[1] / "tools" / "build_subtitle_coverage.py")
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

SHA = "a" * 64
VERSION = "S05E08_aaaaaaaaaaaa"


def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def seed(root):
    put(root / "friends_episodes_236.json", [{"episode_id": "S05E08", "season": 5, "episode": 8}, {"episode_id": "S05E09", "season": 5, "episode": 9}])
    manifest = {"episodes": [{"episode_id": "S05E08", "canonical_version_id": VERSION, "versions": [{"version_id": VERSION, "subtitle_sha256": SHA}]}]}
    put(root / "data/subtitle_imports/one.json", manifest)
    return manifest


class CoverageTests(unittest.TestCase):
    def test_cross_batch_duplicate_counts_once_and_all_paths_remain(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            manifest = seed(root)
            put(root / "data/subtitle_imports/two.json", manifest)
            result = mod.build_coverage(root, "2026-11-16")
            self.assertEqual(result["counts"]["unique_subtitle_version_count"], 1)
            self.assertEqual(result["counts"]["episodes_with_subtitles"], 1)
            self.assertEqual(result["counts"]["episodes_with_lessons"], 0)
            self.assertEqual(len(result["episodes"][0]["batch_manifest_paths"]), 2)
            self.assertEqual(result["seasons"][0]["missing_subtitle_episode_ids"], ["S05E09"])
            self.assertNotIn(str(root), json.dumps(result))

    def test_matching_lesson_stays_on_its_exact_source(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            seed(root)
            new_sha = "b" * 64
            new_version = "S05E08_bbbbbbbbbbbb"
            put(root / "data/subtitle_imports/two.json", {"episodes": [{"episode_id": "S05E08", "canonical_version_id": new_version, "versions": [{"version_id": new_version, "subtitle_sha256": new_sha}]}]})
            put(root / "data/subtitle_lessons/lesson.json", [{"episode_id": "S05E08", "source_sha256": SHA}])
            result = mod.build_coverage(root, "2026-11-16")
            row = result["episodes"][0]
            self.assertEqual(row["lesson_source_version_id"], VERSION)
            self.assertEqual(row["lesson_source_sha256"], SHA)
            self.assertEqual(row["batch_reference_status"], "multiple_references_review_required")

    def test_wrong_lesson_hash_rejected_without_overwriting_previous_coverage(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            seed(root)
            mod.build_coverage(root, "2026-11-16")
            previous = (root / "data/subtitle_coverage.json").read_bytes()
            put(root / "data/subtitle_lessons/lesson.json", [{"episode_id": "S05E08", "source_sha256": "b" * 64}])
            with self.assertRaisesRegex(ValueError, "does not match"):
                mod.build_coverage(root, "2026-11-16")
            self.assertEqual((root / "data/subtitle_coverage.json").read_bytes(), previous)

    def test_unknown_episode_in_manifest_or_lesson_rejected(self):
        for target in ("manifest", "lesson"):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as d:
                root = Path(d)
                manifest = seed(root)
                if target == "manifest":
                    manifest["episodes"][0]["episode_id"] = "S99E99"
                    put(root / "data/subtitle_imports/one.json", manifest)
                else:
                    put(root / "data/subtitle_lessons/lesson.json", [{"episode_id": "S99E99", "source_sha256": SHA}])
                with self.assertRaisesRegex(ValueError, "Unknown episode"):
                    mod.build_coverage(root, "2026-11-16")


if __name__ == "__main__":
    unittest.main()
