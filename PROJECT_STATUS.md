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

## Movie learning: Good Bye, Lenin! (2003)

Original B1–B2 scene-based German/Traditional Chinese movie lessons based on the user-supplied German SRT have been added to `data/movie_lessons/good-bye-lenin-2003.json`. The source subtitle contains 1,202 cues, SHA-256 `a442d60bdf3b2f73e23805fa504296133b8b1b0aa67720b061c81c90383e8c79`. Eight scenes include 32 vocabulary items, 8 grammar topics, and 16 discussion questions, with source cue IDs and edition-specific timings. The subtitles are **not** redistributed in this public repository. `tools/build_site.py` publishes the authored lessons into `site/data/movies.json` on deployment. Video/audio synchronization has not been verified.

## Listening and speaking upgrade

The site now uses a centralized Web Speech interface in `site/speech.js` with German voices, playback diagnostics, adjustable rate, stop/play, and audio controls for the main German text elements across pages. Vocabulary cards show rotating contexts and offer a guided five-stage practice exercise, including optional browser speech recognition, local recording/replay and typing fallback. Built-in dialogue choices are scripted, not generative AI or phonetic scoring. See [listening and speaking guide](docs/listening_speaking.md). Device-dependent voice availability must be checked on the actual phone/browser; no audio recording is uploaded to the repo.

## DW "Kurz und leicht" daily video news (added 2026-11-27)

- `tools/fetch_dw_kurz.py` (stdlib only, settings in `tools/dw_kurz.json`) reads the YouTube RSS feed of "Deutsch lernen mit der DW" (channel `UCxUWIEL-USsiPak0Qy6_vVg`), keeps "Kurz und leicht" episodes, finds the matching DW page (video description links, `dw.com/kurzundleicht` overview, optional DW feeds) and parses Manuskript + Glossar from embedded JSON or HTML headings.
- Archive: `data/dw_kurz/episodes/YYYY-MM-DD.json` and `data/dw_kurz/index.json`, committed by the workflow (`contents: write`) only when content changes. Weekends, holidays and network errors leave it untouched and never fail the build.
- `tools/build_dw_audio.py` makes `de-DE-ConradNeural` MP3s for the newest 5 episodes into `site/audio/dw/` (Git-ignored, cached by `actions/cache`); `site/speech.js` merges `audio/dw/manifest.json`.
- `tools/build_site.py` publishes the archive to `site/data/dw/`. UI: `#/dw` in `site/app.js`; game generation is pure and tested in `site/dw_games.js` (`tests/test_dw_games.js`). Fetcher, publishing and audio keys: `tests/test_fetch_dw_kurz.py`.
- **Not yet verified against live DW pages**: the parser was written and tested against invented sample pages in `tests/fixtures/dw_kurz/` because the development environment could not reach dw.com or youtube.com. Check the first scheduled run's step summary; if the transcript or Glossar is empty, save the page with `--dump-html`, add it as a fixture and adjust `extract_from_blocks`.

## In-site AI teacher and Chinese meanings (added 2026-11-27)

- `site/teacher.js`: spoken conversation with Gemini Live over WebSocket from the browser (16 kHz PCM in, 24 kHz PCM out, input/output transcripts, loudspeaker echo gate, typed replies, feedback request, 15-minute session cap). The API key is pasted in the site's AI settings (`#/settings`) and stored only in that browser's localStorage. The newest Live model is picked from the key's model list; both setup-message shapes (fields in `generationConfig` or directly in `setup`) are tried and the working one remembered. Every former "copy prompt to ChatGPT" card now opens this teacher; `#/talk` is free conversation.
- `tools/translate_dw.py` (GitHub Actions, secret `GEMINI_API_KEY`) writes `data/dw_kurz/translations/YYYY-MM-DD.json`: sentence translations, base form + meaning per word, Glossar and headline Chinese, keyed to an episode-text hash. `tools/build_site.py` merges them. Without daily translations the DW lookup can translate a sentence on demand with the browser key.
- The DW page has no external links any more (DW/YouTube source links, DWDS and Google Translate buttons were removed; the source is credited as text).
- Not verified against the live Gemini service (no network access from the development environment); tested with a mock Live server in headless Chrome (fake microphone) and unit tests in `tests/test_teacher.js` and `tests/test_translate_dw.py`.
