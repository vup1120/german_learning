#!/usr/bin/env python3
"""Import user-supplied SRT ZIPs without publishing their subtitle text.

Python 3.10+; standard library only. Example:
  python tools/import_subtitles.py /path/to/uploads \
    --private-dir local_subtitles --manifest data/subtitle_imports/batch.json \
    --batch-id batch_2026-11-16_s05 --processed-on 2026-11-16

The manifest contains hashes, source filenames, timing statistics and version
relationships. Original SRT bytes, full cue JSON and readable cue text are
written only under --private-dir. Keep that directory out of version control.
Timestamps refer to each supplied subtitle edition, not verified video/audio.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import html
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys
from zipfile import BadZipFile, ZipFile

MAX_MEMBER_BYTES = 10 * 1024 * 1024
MAX_SUBTITLE_OCCURRENCES = 1000
EPISODE_RE = re.compile(r"(?<![A-Za-z0-9])s(\d{1,2})[._ -]*e(\d{1,2})(?!\d)", re.I)
TIME_RE = re.compile(r"^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$")
HTML_TAG_RE = re.compile(r"</?[A-Za-z][^>]*>")
ASS_TAG_RE = re.compile(r"\{\\[^}]*\}")
METADATA_RE = re.compile(r"^(?:Edited at https?://\S+|\[German\s*-\s*SDH\])$", re.I)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def infer_episode(name: str) -> str | None:
    found = {f"S{int(m[1]):02d}E{int(m[2]):02d}" for m in EPISODE_RE.finditer(name)}
    if len(found) > 1:
        raise ValueError(f"Conflicting episode identifiers in filename: {name}")
    return next(iter(found), None)


def safe_member_name(name: str) -> bool:
    # ZIP names use '/', but reject Windows separators and drive prefixes too.
    return bool(name) and "\x00" not in name and "\\" not in name and ":" not in name and not PurePosixPath(name).is_absolute() and ".." not in PurePosixPath(name).parts


def decode_subtitle(data: bytes) -> tuple[str, str]:
    if b"\x00" in data:
        raise ValueError("NUL bytes: unsupported encoding or non-text subtitle")
    try:
        return data.decode("utf-8-sig"), "utf-8-sig" if data.startswith(b"\xef\xbb\xbf") else "utf-8"
    except UnicodeDecodeError:
        # No replacement characters: an undecodable input must be reviewed.
        return data.decode("cp1252"), "cp1252"


def timestamp_ms(value: str) -> int:
    match = TIME_RE.fullmatch(value)
    if not match:
        raise ValueError(f"Malformed SRT timestamp: {value}")
    h, m, s, ms = map(int, match.groups())
    return ((h * 60 + m) * 60 + s) * 1000 + ms


def clean_text(text: str) -> str:
    return " ".join(html.unescape(HTML_TAG_RE.sub("", ASS_TAG_RE.sub("", text))).split())


def parse_srt(text: str) -> tuple[list[dict], list[str]]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        raise ValueError("Empty subtitle")
    cues: list[dict] = []
    warnings: list[str] = []
    ids: set[int] = set()
    for block_no, block in enumerate(re.split(r"\n[ \t]*\n+", normalized), 1):
        lines = block.split("\n")
        if len(lines) < 3 or not re.fullmatch(r"[0-9]+", lines[0].strip()):
            raise ValueError(f"Invalid SRT cue block {block_no}")
        cue_id = int(lines[0])
        if cue_id <= 0 or cue_id in ids:
            raise ValueError(f"Invalid or duplicate cue ID {cue_id}")
        ids.add(cue_id)
        times = re.split(r"\s+-->\s+", lines[1].strip())
        if len(times) != 2:
            raise ValueError(f"Invalid timing line at cue {cue_id}")
        start, end = (timestamp_ms(t) for t in times)
        if end <= start:
            raise ValueError(f"Non-positive duration at cue {cue_id}")
        original = "\n".join(lines[2:])
        clean = clean_text(original)
        if not clean:
            raise ValueError(f"Empty text at cue {cue_id}")
        if cues and start < cues[-1]["start_ms"]:
            warnings.append(f"non_monotonic_start_at_cue_{cue_id}")
        if cues and start < cues[-1]["end_ms"]:
            warnings.append(f"overlap_before_cue_{cue_id}")
        cues.append({
            "cue_id": cue_id, "sequence": block_no,
            "start_ms": start, "end_ms": end,
            "start_timestamp": times[0], "end_timestamp": times[1],
            "text_original": original, "text_clean": clean,
            "kind": "file_metadata" if METADATA_RE.fullmatch(clean) else "subtitle",
        })
    if [c["cue_id"] for c in cues] != list(range(1, len(cues) + 1)):
        warnings.append("cue_ids_not_contiguous_from_one")
    return cues, warnings


def compare_versions(reference: dict, alternate: dict) -> dict:
    a = [c for c in reference["cues"] if c["kind"] != "file_metadata"]
    b = [c for c in alternate["cues"] if c["kind"] != "file_metadata"]
    matcher = difflib.SequenceMatcher(a=[c["text_clean"] for c in a], b=[c["text_clean"] for c in b], autojunk=False)
    pairs = [(a[i], b[j]) for tag, a1, a2, b1, b2 in matcher.get_opcodes() if tag == "equal" for i, j in zip(range(a1, a2), range(b1, b2))]
    offsets = [y["start_ms"] - x["start_ms"] for x, y in pairs]
    changed = [{"reference_cue_ids": [c["cue_id"] for c in a[a1:a2]], "alternate_cue_ids": [c["cue_id"] for c in b[b1:b2]], "operation": tag} for tag, a1, a2, b1, b2 in matcher.get_opcodes() if tag != "equal"]
    relation = "same_text_retimed" if len(pairs) == len(a) == len(b) else "overlapping_edited_version" if matcher.ratio() >= 0.8 else "different_content_review_required"
    return {
        "reference_version_id": reference["version_id"], "alternate_version_id": alternate["version_id"],
        "relationship": relation, "matching_content_cues": len(pairs),
        "reference_content_cues": len(a), "alternate_content_cues": len(b),
        "text_sequence_similarity": round(matcher.ratio(), 6), "changed_cue_groups": changed,
        "matching_cue_start_offset_ms_range": [min(offsets), max(offsets)] if offsets else None,
        "single_constant_start_offset": bool(offsets) and len(set(offsets)) == 1,
        "concatenate_automatically": False,
    }


def select_reference(versions: list[dict]) -> tuple[dict, str]:
    if len(versions) == 1:
        return versions[0], "Only unique subtitle version supplied for this episode; audio remains unverified."
    # This is a reproducible provisional reference, never a claim about audio accuracy.
    ranked = sorted(versions, key=lambda v: (
        not any("bluray" in n.lower() for n in v["source_members"]),
        any(c["text_clean"].lower().startswith("edited at ") for c in v["cues"]),
        v["version_id"],
    ))
    return ranked[0], "Provisional lesson reference: prefer the explicitly named BluRay release for consistency with this batch, then a file without an editor-credit cue. All alternatives are retained; audio and playback synchronization are unverified."


def discover_archives(inputs: list[Path]) -> list[Path]:
    found: dict[str, Path] = {}
    for value in inputs:
        candidates = sorted(value.glob("*.zip")) if value.is_dir() else [value]
        for path in candidates:
            if not path.is_file() or path.suffix.lower() != ".zip":
                raise ValueError(f"Expected ZIP file: {path}")
            found[str(path.resolve())] = path
    if not found:
        raise ValueError("No ZIP files found")
    return sorted(found.values(), key=lambda p: (p.name, str(p.resolve())))


def import_archives(inputs: list[Path], private_dir: Path, manifest_path: Path, batch_id: str, processed_on: str) -> dict:
    archives = discover_archives(inputs)
    versions: dict[str, dict] = {}
    archive_records: list[dict] = []
    occurrences: list[dict] = []
    for archive in archives:
        archive_hash = digest(archive.read_bytes())
        archive_episode = infer_episode(archive.name)
        member_records = []
        with ZipFile(archive) as zf:
            for info in zf.infolist():
                if info.is_dir() or not info.filename.lower().endswith(".srt"):
                    continue
                if not safe_member_name(info.filename) or stat.S_ISLNK(info.external_attr >> 16):
                    raise ValueError(f"Unsafe ZIP member: {info.filename}")
                if info.flag_bits & 1:
                    raise ValueError(f"Encrypted ZIP member is unsupported: {info.filename}")
                if info.file_size > MAX_MEMBER_BYTES or info.file_size > max(1, info.compress_size) * 1000:
                    raise ValueError(f"Oversized or excessive-compression ZIP member: {info.filename}")
                if len(occurrences) >= MAX_SUBTITLE_OCCURRENCES:
                    raise ValueError("Too many subtitle members in one batch")
                member_episode = infer_episode(info.filename)
                if archive_episode and member_episode and archive_episode != member_episode:
                    raise ValueError(f"Archive/member episode conflict: {archive.name} / {info.filename}")
                episode = member_episode or archive_episode
                if not episode:
                    raise ValueError(f"Missing episode identifier: {info.filename}")
                raw = zf.read(info)
                text, encoding = decode_subtitle(raw)
                cues, warnings = parse_srt(text)
                content_hash = digest(raw)
                if content_hash in versions and versions[content_hash]["episode_id"] != episode:
                    raise ValueError("Identical subtitle bytes assigned to different episodes")
                record = {"archive_name": archive.name, "archive_sha256": archive_hash, "member_name": info.filename, "subtitle_sha256": content_hash, "episode_id": episode, "duplicate_content": content_hash in versions}
                occurrences.append(record)
                member_records.append({"member_name": info.filename, "subtitle_sha256": content_hash, "episode_id": episode, "duplicate_content": record["duplicate_content"]})
                if content_hash not in versions:
                    versions[content_hash] = {"episode_id": episode, "version_id": f"{episode}_{content_hash[:12]}", "subtitle_sha256": content_hash, "encoding": encoding, "raw": raw, "cues": cues, "warnings": warnings, "source_members": [], "source_archives": []}
                version = versions[content_hash]
                if info.filename not in version["source_members"]:
                    version["source_members"].append(info.filename)
                version["source_archives"].append({"archive_name": archive.name, "archive_sha256": archive_hash})
        if not member_records:
            raise ValueError(f"No SRT members found in archive: {archive.name}")
        archive_records.append({"archive_name": archive.name, "archive_sha256": archive_hash, "subtitle_members": member_records})

    # Validate the complete batch before writing any output.
    episodes = []
    for episode in sorted({v["episode_id"] for v in versions.values()}):
        group = [v for v in versions.values() if v["episode_id"] == episode]
        reference, reason = select_reference(group)
        comparisons = [compare_versions(reference, v) for v in group if v is not reference]
        public_versions = []
        for v in sorted(group, key=lambda v: v["version_id"]):
            content_cues = [c for c in v["cues"] if c["kind"] != "file_metadata"]
            public_versions.append({
                "version_id": v["version_id"], "subtitle_sha256": v["subtitle_sha256"],
                "source_members": v["source_members"], "source_archives": v["source_archives"],
                "encoding": v["encoding"], "byte_count": len(v["raw"]),
                "caption_type_hint": "SDH indicated by subtitle file contents" if any(c["text_clean"].lower() == "[german - sdh]" for c in v["cues"]) else "not established",
                "cue_count": len(v["cues"]), "content_cue_count": len(content_cues),
                "metadata_cue_ids": [c["cue_id"] for c in v["cues"] if c["kind"] == "file_metadata"],
                "first_cue_start_ms": min(c["start_ms"] for c in v["cues"]),
                "last_cue_end_ms": max(c["end_ms"] for c in v["cues"]),
                "last_content_cue_end_ms": max(c["end_ms"] for c in content_cues),
                "warnings": v["warnings"],
            })
        episodes.append({
            "episode_id": episode, "language": "de", "subtitle_available": True,
            "audio_verified": False, "timing_version_specific": True,
            "canonical_version_id": reference["version_id"], "canonical_selection_status": "provisional_lesson_reference",
            "canonical_selection_reason": reason, "versions": public_versions, "version_comparisons": comparisons,
        })
    manifest = {
        "schema_version": "1.0", "batch_id": batch_id, "processed_on": processed_on,
        "source_type": "user_supplied_subtitle_archives", "public_manifest_contains_subtitle_text": False,
        "audio_verified": False, "timing_version_specific": True,
        "input_archive_count": len(archives), "subtitle_occurrence_count": len(occurrences),
        "unique_subtitle_version_count": len(versions), "duplicate_subtitle_occurrence_count": len(occurrences) - len(versions),
        "episode_count": len(episodes),
        "canonical_cue_count_total": sum(next(v["cue_count"] for v in e["versions"] if v["version_id"] == e["canonical_version_id"]) for e in episodes),
        "archives": archive_records, "episodes": episodes,
    }
    private_dir.mkdir(parents=True, exist_ok=True)
    for v in versions.values():
        base = private_dir / v["version_id"]
        base.with_suffix(".srt").write_bytes(v["raw"])
        private = {"episode_id": v["episode_id"], "version_id": v["version_id"], "source_member": v["source_members"][0], "subtitle_sha256": v["subtitle_sha256"], "encoding": v["encoding"], "audio_verified": False, "timing_version_specific": True, "cues": v["cues"]}
        base.with_suffix(".json").write_text(json.dumps(private, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        base.with_suffix(".txt").write_text("\n".join(f"{c['cue_id']:03d} [{c['start_timestamp']} --> {c['end_timestamp']}] {c['text_clean']}" for c in v["cues"]) + "\n", encoding="utf-8")
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("inputs", nargs="+", type=Path, help="ZIP files or directories containing ZIP files")
    parser.add_argument("--private-dir", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--batch-id", required=True)
    parser.add_argument("--processed-on", required=True, help="User-facing ISO date, YYYY-MM-DD")
    args = parser.parse_args()
    try:
        result = import_archives(args.inputs, args.private_dir, args.manifest, args.batch_id, args.processed_on)
    except (OSError, ValueError, UnicodeError, BadZipFile) as exc:
        print(f"Import failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({key: result[key] for key in ("batch_id", "input_archive_count", "subtitle_occurrence_count", "unique_subtitle_version_count", "duplicate_subtitle_occurrence_count", "episode_count", "canonical_cue_count_total")}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
