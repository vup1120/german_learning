"""Focused regression tests for batch identity and SRT import correctness."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile, ZipInfo

SPEC = importlib.util.spec_from_file_location("import_subtitles", Path(__file__).resolve().parents[1] / "tools" / "import_subtitles.py")
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)

SRT = "1\r\n00:00:01,125 --> 00:00:02,875\r\n<i>Grüße!</i>\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,001\r\nNoch eine Zeile.\r\n"


class SubtitleImportTests(unittest.TestCase):
    def test_encoding_is_strict_and_preserves_umlauts(self):
        self.assertEqual(mod.decode_subtitle(SRT.encode("utf-8")), (SRT, "utf-8"))
        self.assertEqual(mod.decode_subtitle(SRT.encode("cp1252")), (SRT, "cp1252"))
        self.assertEqual(mod.decode_subtitle(b"\xef\xbb\xbf" + SRT.encode("utf-8"))[1], "utf-8-sig")
        with self.assertRaises(UnicodeDecodeError):
            mod.decode_subtitle(b"\x81")
        with self.assertRaises(ValueError):
            mod.decode_subtitle(b"1\x00")

    def test_timestamps_and_clean_text_preserve_original(self):
        cues, warnings = mod.parse_srt(SRT)
        self.assertEqual((cues[0]["start_ms"], cues[0]["end_ms"]), (1125, 2875))
        self.assertEqual(cues[0]["text_original"], "<i>Grüße!</i>")
        self.assertEqual(cues[0]["text_clean"], "Grüße!")
        self.assertEqual(mod.clean_text(r"{\an8}<i>groß &amp; klein</i>"), "groß & klein")
        self.assertEqual(warnings, [])

    def test_malformed_timestamps_and_duplicate_ids_are_rejected(self):
        for source in (
            SRT.replace("00:00:01,125", "00:60:01,125"),
            SRT.replace("00:00:02,875", "00:00:01,000"),
            SRT.replace("\r\n2\r\n", "\r\n1\r\n"),
            SRT.replace(" --> ", " -> "),
        ):
            with self.subTest(source=source):
                with self.assertRaises(ValueError):
                    mod.parse_srt(source)

    def test_unsafe_member_names_are_rejected(self):
        for name in ("../S05E08.srt", "/S05E08.srt", r"C:\S05E08.srt", r"..\S05E08.srt"):
            self.assertFalse(mod.safe_member_name(name), name)
        self.assertTrue(mod.safe_member_name("folder/S05E08.srt"))
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            archive = root / "S05E08.zip"
            with ZipFile(archive, "w") as z:
                z.writestr("../S05E08.srt", SRT)
            with self.assertRaisesRegex(ValueError, "Unsafe ZIP member"):
                mod.import_archives([archive], root / "private", root / "manifest.json", "test", "2026-11-16")
            self.assertFalse((root / "private").exists())

    def test_dedup_uses_subtitle_bytes_not_archive_hash(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            paths = []
            for i in (1, 2):
                path = root / f"S05E08_copy{i}.zip"
                with ZipFile(path, "w") as z:
                    entry = ZipInfo("Friends.S05E08.srt", date_time=(2020 + i, 1, 1, 0, 0, 0))
                    z.writestr(entry, SRT.encode("utf-8"))
                paths.append(path)
            result = mod.import_archives(paths, root / "private", root / "manifest.json", "test", "2026-11-16")
            self.assertEqual(result["input_archive_count"], 2)
            self.assertEqual(result["unique_subtitle_version_count"], 1)
            self.assertEqual(result["duplicate_subtitle_occurrence_count"], 1)
            self.assertNotEqual(result["archives"][0]["archive_sha256"], result["archives"][1]["archive_sha256"])
            self.assertEqual(len(result["episodes"][0]["versions"][0]["source_archives"]), 2)
            self.assertNotIn("Grüße", json.dumps(result, ensure_ascii=False))
            self.assertNotIn(str(root), json.dumps(result))
            private_srt = next((root / "private").glob("*.srt"))
            self.assertEqual(private_srt.read_bytes(), SRT.encode("utf-8"))

    def test_episode_conflict_rejected_before_output(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            archive = root / "S05E08.zip"
            with ZipFile(archive, "w") as z:
                z.writestr("Friends.S05E09.srt", SRT)
            with self.assertRaisesRegex(ValueError, "episode conflict"):
                mod.import_archives([archive], root / "private", root / "manifest.json", "test", "2026-11-16")
            self.assertFalse((root / "manifest.json").exists())

    def test_episode_identifiers_accept_archive_spelling(self):
        self.assertEqual(mod.infer_episode("friends.tv.s05.e09.ger.zip"), "S05E09")
        self.assertEqual(mod.infer_episode("Friends.S05E09.German.srt"), "S05E09")
        self.assertEqual(mod.infer_episode("01x18.The One With All The Poker.deu.srt"), "S01E18")
        self.assertEqual(mod.infer_episode("01X04.de.srt"), "S01E04")
        with self.assertRaises(ValueError):
            mod.infer_episode("S05E08-S05E09.srt")
        with self.assertRaises(ValueError):
            mod.infer_episode("S01E01.01x18.srt")

    def test_reviewed_resolution_handles_conflict_and_hidden_filename_error(self):
        for member_name, resolved in (("01x18.Poker.srt", "S01E18"), ("Friends.S01E01.srt", "S01E03")):
            with self.subTest(member=member_name), tempfile.TemporaryDirectory() as d:
                root = Path(d)
                archive = root / "S01E01.zip"
                with ZipFile(archive, "w") as z:
                    z.writestr(member_name, SRT.encode("utf-8"))
                resolution = {"archive_name": archive.name, "archive_sha256": mod.digest(archive.read_bytes()), "member_name": member_name, "subtitle_sha256": mod.digest(SRT.encode("utf-8")), "resolved_episode_id": resolved, "reviewed": True, "reviewed_on": "2026-11-16", "review_method": "subtitle_content_review", "reason": "Synthetic content review fixture.", "evidence_cue_ids": [1]}
                result = mod.import_archives([archive], root / "private", root / "manifest.json", "test", "2026-11-16", [resolution])
                self.assertEqual(result["episodes"][0]["episode_id"], resolved)
                self.assertEqual(result["reviewed_episode_resolution_count"], 1)
                source = result["episodes"][0]["versions"][0]["source_assignments"][0]
                self.assertEqual(source["archive_episode_id"], "S01E01")
                self.assertEqual(source["member_episode_id"], mod.infer_episode(member_name))
                self.assertEqual(source["episode_assignment_method"], "reviewed_content_resolution")
                self.assertEqual(next((root / "private").glob("*.srt")).read_bytes(), SRT.encode("utf-8"))

    def test_unreviewed_or_byte_mismatched_resolution_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            archive = root / "S01E01.zip"
            with ZipFile(archive, "w") as z:
                z.writestr("01x18.Poker.srt", SRT.encode("utf-8"))
            resolution = {"archive_name": archive.name, "archive_sha256": mod.digest(archive.read_bytes()), "member_name": "01x18.Poker.srt", "subtitle_sha256": "0" * 64, "resolved_episode_id": "S01E18", "reviewed": True, "reviewed_on": "2026-11-16", "review_method": "subtitle_content_review", "reason": "Synthetic content review fixture.", "evidence_cue_ids": [1]}
            with self.assertRaisesRegex(ValueError, "subtitle hash mismatch"):
                mod.import_archives([archive], root / "private", root / "manifest.json", "test", "2026-11-16", [resolution])
            resolution["subtitle_sha256"] = mod.digest(SRT.encode("utf-8"))
            resolution["reviewed"] = False
            with self.assertRaisesRegex(ValueError, "explicitly reviewed"):
                mod.import_archives([archive], root / "private", root / "manifest.json", "test", "2026-11-16", [resolution])
            self.assertFalse((root / "manifest.json").exists())

    def test_observed_sdh_credit_is_file_metadata(self):
        source = "1\n00:00:01,000 --> 00:00:02,000\nGerman SDH Subtitles by Untertitel: Gelula/SDI\n\n2\n00:00:03,000 --> 00:00:04,000\nHallo!\n"
        cues, _ = mod.parse_srt(source)
        self.assertEqual(cues[0]["kind"], "file_metadata")
        self.assertEqual(cues[1]["kind"], "subtitle")

    def test_retimed_variant_is_not_concatenated(self):
        a, _ = mod.parse_srt(SRT)
        b, _ = mod.parse_srt(SRT.replace("00:00:01,125", "00:00:01,100").replace("00:00:03,000", "00:00:02,900"))
        relation = mod.compare_versions({"version_id": "a", "cues": a}, {"version_id": "b", "cues": b})
        self.assertEqual(relation["relationship"], "same_text_retimed")
        self.assertFalse(relation["single_constant_start_offset"])
        self.assertFalse(relation["concatenate_automatically"])


if __name__ == "__main__":
    unittest.main()
