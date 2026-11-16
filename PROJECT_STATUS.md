# German learning project status

Updated: 2026-11-16. Repository: https://github.com/vup1120/german_learning

## Completed

- A 236-episode German/Traditional Chinese learning catalogue, workbook, CSV and JSON.
- Ten original practice dialogues independent of the programme's dialogue.
- First subtitle batch received: S05E08 through S05E14.
- Ten ZIP uploads processed into eight unique subtitle versions for seven episodes; three duplicate SRT occurrences identified.
- Seven original detailed lessons based on the supplied subtitles, each with six vocabulary items, two grammar points, three discussion questions and two scene exercises.
- Source hashes, cue IDs and millisecond timings recorded for lesson references.
- A repeatable import tool and coverage builder for future uploads.

## Where to continue

- [Detailed Season 5 lessons](docs/season_05_subtitle_lessons.md)
- [Lesson JSON](data/subtitle_lessons/season_05.json)
- [Coverage and missing episodes](data/subtitle_coverage.json)
- [First batch import record](data/subtitle_imports/batch_2026-11-16_s05.json)
- [Import workflow](docs/subtitle_workflow.md)

## Pending material

Season 5 still needs S05E01–S05E07 and S05E15–S05E24: 17 episodes. No subtitles for the other seasons have been supplied in this project yet. Their general learning summaries are already available in the original catalogue.

S05E13 has two edited subtitle versions, not two parts. Keep both; the release-named BluRay version is the provisional source for the current lesson. All timings remain specific to their source version. No video or German audio comparison has been performed.

The full source subtitles and parsed cue files are in the separate processed-source ZIP, while this repository stores metadata and original learning material. Attach that ZIP again if a later conversation needs the earlier full sources.

## Next upload

Process the next supplied batch, compare source hashes with existing import records, add or review the matching episode lessons, rebuild coverage, and update this status file. Do not assume an edited version has identical cue IDs or timings. The web platform itself remains to be implemented.
