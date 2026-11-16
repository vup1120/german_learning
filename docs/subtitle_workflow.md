# Adding subtitle batches

The 236-episode catalogue remains the general learning overview. Subtitle-based lessons are an additional layer joined by `episode_id`, such as `S05E13`.

## Files and responsibilities

| Location | Contents |
| --- | --- |
| `friends_episodes_236.json` | Original catalogue, short summaries, vocabulary and questions for all episodes. |
| `data/subtitle_imports/*.json` | Import records: filenames, SHA-256 hashes, duplicates, versions, cue counts and timing metadata. |
| `data/subtitle_lessons/*.json` | Original teaching material based on supplied subtitles, with exact source-version and cue references. |
| `data/subtitle_coverage.json` | Current episode coverage, missing episodes and lesson availability. |
| `local_subtitles/` | Local source SRT files and complete parsed cues. This directory is ignored by Git. |

The public repository contains lesson content and source metadata. Full uploaded subtitle files and full cue text are kept in the separate processed-source download. A `subtitle_available` flag means a source was received and processed; it does not mean the public repository serves that source.

## Import a new batch

Use Python 3.10 or later; the tools use only the standard library. Put incoming ZIP files in `incoming_subtitles/` or another local directory.

```bash
python tools/import_subtitles.py incoming_subtitles \
  --private-dir local_subtitles \
  --manifest data/subtitle_imports/batch_YYYY-MM-DD_02.json \
  --batch-id batch_YYYY-MM-DD_02 \
  --processed-on YYYY-MM-DD
```

Replace the placeholder date and use a distinct batch ID for each upload. The importer reads SRT members directly, verifies episode identifiers, preserves original bytes, and writes normalized cue JSON separately. It rejects unsafe archive paths, malformed timestamps and conflicting episode labels. It never concatenates variants automatically.

Duplicate detection compares the actual SRT bytes. Two ZIP containers can have different hashes while containing identical subtitles. An edited subtitle is retained as another version even when most lines match. The coverage builder also deduplicates versions across different import batches.

## Create and review lessons

Use the exact subtitle version recorded in each lesson's `source_sha256`. Each vocabulary item and grammar point has a source cue ID and time range; scene exercises have a cue range. Original example sentences and answer hints are teaching material, not quotations from the programme.

For every lesson:

1. Check the episode ID and source SHA-256 against its import record.
2. Confirm each source expression exists in its cited cue.
3. Preserve the source's cue IDs and integer millisecond timings.
4. Exclude source-file credits from exercises. Distinguish sound descriptions from spoken dialogue when choosing listening tasks.
5. Review the German, Traditional Chinese and plot interpretation.
6. Leave `audio_verified` as `false` until the relevant audio has actually been compared.

Add the reviewed lesson to the appropriate season JSON array. Keep exactly one active lesson per episode in this layer. To replace a lesson's source edition, explicitly revise its source hash and all affected cue references.

Then rebuild coverage:

```bash
python tools/build_subtitle_coverage.py --root . --updated-on YYYY-MM-DD
python -m unittest discover -s tests -v
```

Update `PROJECT_STATUS.md` with the received episodes, unresolved version questions and next work. The coverage JSON is the structured record for subsequent batches.

## First batch: Season 5, episodes 8–14

The first batch contains 10 ZIP uploads and 11 SRT occurrences. Three occurrences repeat identical subtitle bytes: S05E09, S05E10 and S05E11. There are eight unique subtitle versions for seven episodes.

The seven provisional reference versions contain 2,438 cues in total, including seven trailing `[German - SDH]` file labels. After excluding those labels there are 2,431 content cues; this includes sound descriptions and does not imply 2,431 spoken dialogue turns.

S05E13 has two alternative versions of the same episode. The release-named BluRay file is the provisional lesson reference, matching the naming of the other six episodes. The second file has edited wording and timing. Its timing differences vary, so the two versions cannot be aligned by a single offset and must not be concatenated.

All seven reference files identify themselves as German SDH. This is a label in the supplied files, not an independent verification of their origin or their agreement with a particular German dub.

## Continuing in another conversation

Attach the next ZIP batch and share `https://github.com/vup1120/german_learning`. Ask to continue from `PROJECT_STATUS.md` and `data/subtitle_coverage.json`. Those files record the durable project state. If earlier full subtitles are needed again, attach the processed-source ZIP or select the relevant source files; the public repository intentionally contains their metadata and derived lessons only.

