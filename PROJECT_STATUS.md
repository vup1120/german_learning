# German learning project status

Updated: 2026-11-16. Completed subtitle batches: 2.
Repository: https://github.com/vup1120/german_learning

## Current content

The general catalogue covers all 236 episodes. Detailed subtitle-based lessons are ready for 18 episodes, with 108 vocabulary entries, 36 grammar points, 54 discussion questions and 36 scene exercises. The sources comprise 25 distinct subtitle versions from 20 uploaded ZIPs.

| Season | Received and taught episodes | Count | Guide |
| --- | --- | ---: | --- |
| 1 | S01E01–S01E04, S01E18 | 5 | [Season 1](docs/season_01_subtitle_lessons.md) |
| 4 | S04E18 | 1 | [Season 4](docs/season_04_subtitle_lessons.md) |
| 5 | S05E01–S05E05, S05E08–S05E14 | 12 | [Season 5](docs/season_05_subtitle_lessons.md) |

[Structured coverage](data/subtitle_coverage.json) is the authoritative list of available versions, lesson paths and missing episodes. Every lesson retains its exact source hash, cue IDs and millisecond timings. Audio/video synchronization remains unverified.

## Website source

The supplied Deutsch-Quest site is integrated at the repository root. It includes life-situation learning, the Friends catalogue and subtitle lessons, news, citizenship practice, driving-test German, daily tasks and spaced review.

- `python tools/build_site.py --no-news` builds the Friends data offline.
- `python -m http.server 8000 --directory site` serves a local preview.
- `.github/workflows/site.yml` builds and deploys the `site/` directory on pushes to `main`, manual runs and the supplied daily 04:30 UTC schedule.
- All 18 current detailed lessons are loaded automatically from `data/subtitle_lessons/`; generated `site/data/` files are ignored by Git and rebuilt for deployment.

## Batch records

- [Batch 01](data/subtitle_imports/batch_2026-11-16_s05.json): 10 ZIPs, 11 SRT occurrences, 8 unique versions, 7 episodes. Duplicate occurrences are S05E09, S05E10 and S05E11. S05E13 has two edited alternatives, not two parts.
- [Batch 02](data/subtitle_imports/batch_2026-11-16_02.json): 10 ZIPs, 17 SRT occurrences, 17 unique versions, 11 additional episodes. Five files use Windows-1252 and twelve use UTF-8 with BOM.

## Reviewed episode corrections

The [resolution record](data/subtitle_resolutions/batch_2026-11-16_02.json) binds each correction to exact archive and subtitle hashes:

1. The pilot ZIP also contains the independent poker episode S01E18.
2. In the S01E04 ZIP, the BluRay member named S01E03 actually contains S01E04.
3. In that same ZIP, the BluRay member named S01E04 actually contains S01E03.

These assignments were checked against subtitle contents, not inferred from the archive title. Original names and bytes remain preserved. Lesson guides identify the mismatches where relevant. Minor source spelling and character defects are kept in original files; original teaching examples use standard German.

## Remaining subtitles

- Season 5: S05E06–S05E07 and S05E15–S05E24, 12 episodes.
- Season 1: S01E05–S01E17 and S01E19–S01E24, 19 episodes.
- Season 4: S04E01–S04E17 and S04E19–S04E24, 23 episodes.
- Other seasons: no subtitle sources have been supplied yet; their general summaries are already in the 236-episode catalogue.

## Next conversation or upload

Attach the next batch and share this repository link. Read this file and the coverage JSON first, compare incoming subtitle hashes, inspect ambiguous episode assignments, then add lessons and rebuild coverage. Do not silently switch an existing lesson to another subtitle edition.

The combined `friends_subtitles_processed.zip` download contains all 25 source versions, full parsed cues and both manifests. Attach that file if a later conversation needs earlier full source text. This public repository stores metadata, original lesson material and import tools.

Follow [the import workflow](docs/subtitle_workflow.md). After reviewed lesson edits, run the coverage builder and the guide renderer. The static web platform source is implemented under `site/`; `tools/build_site.py` prepares its data, and `.github/workflows/site.yml` defines GitHub Pages deployment. Deployment success is tracked in GitHub Actions. Accounts and cross-device progress are not implemented; progress stays in the browser.
