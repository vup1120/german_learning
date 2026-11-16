#!/usr/bin/env python3
"""Build a text-free coverage index from episode, subtitle and lesson data.

Python 3.10+, standard library only. Run from the repository root:
    python tools/build_subtitle_coverage.py --root . --updated-on 2026-11-16

The script reads friends_episodes_236.json, data/subtitle_imports/*.json and
data/subtitle_lessons/*.json, then writes data/subtitle_coverage.json. Existing
coverage is only replaced after all references validate. A missing lesson
directory is valid; a lesson pointing at an unknown subtitle hash is not.
"""

from __future__ import annotations

import argparse
from datetime import date
import json
from pathlib import Path
import re
import sys
import tempfile

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def require_sha(value, where: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ValueError(f"Invalid SHA-256 in {where}")
    return value


def build_coverage(root: Path, updated_on: str) -> dict:
    date.fromisoformat(updated_on)
    root = root.resolve()
    catalog = read_json(root / "friends_episodes_236.json")
    if not isinstance(catalog, list) or not catalog:
        raise ValueError("Episode catalog must be a non-empty array")
    episodes = {}
    for item in catalog:
        if not isinstance(item, dict) or not isinstance(item.get("episode_id"), str):
            raise ValueError("Invalid episode catalog record")
        episode_id = item["episode_id"]
        if episode_id in episodes:
            raise ValueError(f"Duplicate catalog episode: {episode_id}")
        season, episode = item.get("season"), item.get("episode")
        if not isinstance(season, int) or not isinstance(episode, int) or season <= 0 or episode <= 0:
            raise ValueError(f"Invalid season/episode numbers for {episode_id}")
        if episode_id != f"S{season:02d}E{episode:02d}":
            raise ValueError(f"Episode identifier does not match season/episode numbers: {episode_id}")
        episodes[episode_id] = {"season": season, "episode": episode}

    # A content hash identifies the same subtitle bytes across different ZIPs
    # and batches. Version IDs remain explicit aliases; none is silently moved.
    versions_by_sha = {}
    version_to_sha = {}
    episode_sources = {episode_id: {"hashes": set(), "version_ids": set(), "batches": set(), "references": set()} for episode_id in episodes}
    manifests = sorted((root / "data" / "subtitle_imports").glob("*.json"))
    for path in manifests:
        relative_path = path.relative_to(root).as_posix()
        manifest = read_json(path)
        if not isinstance(manifest, dict) or not isinstance(manifest.get("episodes"), list):
            raise ValueError(f"Invalid subtitle manifest: {relative_path}")
        seen_episodes = set()
        for record in manifest["episodes"]:
            episode_id = record.get("episode_id")
            if episode_id not in episodes:
                raise ValueError(f"Unknown episode {episode_id} in {relative_path}")
            if episode_id in seen_episodes:
                raise ValueError(f"Duplicate episode {episode_id} in {relative_path}")
            seen_episodes.add(episode_id)
            versions = record.get("versions")
            if not isinstance(versions, list) or not versions:
                raise ValueError(f"No subtitle versions for {episode_id} in {relative_path}")
            local_ids = set()
            for version in versions:
                version_id = version.get("version_id")
                if not isinstance(version_id, str) or not version_id:
                    raise ValueError(f"Missing version ID for {episode_id} in {relative_path}")
                if version_id in local_ids:
                    raise ValueError(f"Duplicate version ID {version_id} in {relative_path}")
                local_ids.add(version_id)
                sha = require_sha(version.get("subtitle_sha256"), f"{relative_path}/{version_id}")
                if version_id in version_to_sha and version_to_sha[version_id] != sha:
                    raise ValueError(f"Version ID {version_id} changes subtitle hash between batches")
                version_to_sha[version_id] = sha
                existing = versions_by_sha.setdefault(sha, {"episode_id": episode_id, "version_ids": set(), "batches": set()})
                if existing["episode_id"] != episode_id:
                    raise ValueError(f"Subtitle hash assigned to different episodes: {episode_id} and {existing['episode_id']}")
                existing["version_ids"].add(version_id)
                existing["batches"].add(relative_path)
                episode_sources[episode_id]["hashes"].add(sha)
                episode_sources[episode_id]["version_ids"].add(version_id)
                episode_sources[episode_id]["batches"].add(relative_path)
            reference_id = record.get("canonical_version_id")
            if reference_id not in local_ids:
                raise ValueError(f"Invalid canonical version for {episode_id} in {relative_path}")
            episode_sources[episode_id]["references"].add(reference_id)

    lesson_files = sorted((root / "data" / "subtitle_lessons").glob("*.json"))
    lessons = {}
    for path in lesson_files:
        relative_path = path.relative_to(root).as_posix()
        records = read_json(path)
        if not isinstance(records, list):
            raise ValueError(f"Lesson file must contain an array: {relative_path}")
        for lesson in records:
            if not isinstance(lesson, dict):
                raise ValueError(f"Invalid lesson record in {relative_path}")
            episode_id = lesson.get("episode_id")
            if episode_id not in episodes:
                raise ValueError(f"Unknown episode {episode_id} in {relative_path}")
            if episode_id in lessons:
                raise ValueError(f"Multiple lesson records for {episode_id}; consolidate them explicitly")
            sha = require_sha(lesson.get("source_sha256"), f"lesson {episode_id} in {relative_path}")
            source = versions_by_sha.get(sha)
            if source is None or source["episode_id"] != episode_id:
                raise ValueError(f"Lesson source hash does not match a known subtitle for {episode_id}")
            version_id = lesson.get("source_version_id")
            if version_id is not None:
                if version_id not in source["version_ids"] or version_to_sha.get(version_id) != sha:
                    raise ValueError(f"Lesson source version ID does not match its hash for {episode_id}")
            elif len(source["version_ids"]) == 1:
                version_id = next(iter(source["version_ids"]))
            else:
                raise ValueError(f"Lesson source has multiple version IDs for {episode_id}; specify source_version_id")
            lessons[episode_id] = {"path": relative_path, "source_sha256": sha, "source_version_id": version_id}

    coverage = []
    for episode_id, item in sorted(episodes.items(), key=lambda pair: (pair[1]["season"], pair[1]["episode"])):
        source = episode_sources[episode_id]
        lesson = lessons.get(episode_id)
        has_subtitles = bool(source["hashes"])
        reference_hashes = {version_to_sha[v] for v in source["references"]}
        coverage.append({
            "episode_id": episode_id, **item,
            "subtitle_available": has_subtitles, "lesson_available": lesson is not None,
            "status": "subtitle_lesson_ready" if lesson else "subtitle_available" if has_subtitles else "missing_subtitles",
            "audio_verified": False, "timing_version_specific": True,
            "unique_subtitle_version_count": len(source["hashes"]),
            "version_ids": sorted(source["version_ids"]), "subtitle_sha256s": sorted(source["hashes"]),
            "batch_manifest_paths": sorted(source["batches"]),
            "batch_reference_version_ids": sorted(source["references"]),
            "batch_reference_status": "none" if not reference_hashes else "consistent" if len(reference_hashes) == 1 else "multiple_references_review_required",
            "lesson_path": lesson["path"] if lesson else None,
            "lesson_source_version_id": lesson["source_version_id"] if lesson else None,
            "lesson_source_sha256": lesson["source_sha256"] if lesson else None,
        })
    seasons = []
    for season in sorted({item["season"] for item in coverage}):
        rows = [item for item in coverage if item["season"] == season]
        seasons.append({
            "season": season, "total_episode_count": len(rows),
            "episodes_with_subtitles": sum(item["subtitle_available"] for item in rows),
            "episodes_with_lessons": sum(item["lesson_available"] for item in rows),
            "missing_subtitle_episode_ids": [item["episode_id"] for item in rows if not item["subtitle_available"]],
            "missing_lesson_episode_ids": [item["episode_id"] for item in rows if not item["lesson_available"]],
        })
    result = {
        "schema_version": "1.0", "updated_on": updated_on,
        "content_type": "subtitle_coverage_metadata", "contains_subtitle_text": False,
        "audio_verified": False, "timing_version_specific": True,
        "counts": {
            "total_episode_count": len(episodes),
            "episodes_with_subtitles": sum(item["subtitle_available"] for item in coverage),
            "episodes_with_lessons": len(lessons),
            "unique_subtitle_version_count": len(versions_by_sha),
            "distinct_version_id_count": len(version_to_sha),
            "batch_manifest_count": len(manifests), "lesson_file_count": len(lesson_files),
        },
        "batch_manifest_paths": [p.relative_to(root).as_posix() for p in manifests],
        "lesson_file_paths": [p.relative_to(root).as_posix() for p in lesson_files],
        "seasons": seasons, "episodes": coverage,
    }
    destination = root / "data" / "subtitle_coverage.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_name = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=destination.parent, prefix=".subtitle_coverage_", suffix=".tmp", delete=False) as temporary:
            temporary_name = temporary.name
            json.dump(result, temporary, ensure_ascii=False, indent=2)
            temporary.write("\n")
        Path(temporary_name).replace(destination)
    finally:
        if temporary_name:
            Path(temporary_name).unlink(missing_ok=True)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--updated-on", required=True, help="User-facing ISO date, YYYY-MM-DD")
    args = parser.parse_args()
    try:
        result = build_coverage(args.root, args.updated_on)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        print(f"Coverage build failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result["counts"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
