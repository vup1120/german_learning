#!/usr/bin/env python3
"""Render the reviewed season lesson JSON files into readable Markdown guides."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def timestamp(ms: int) -> str:
    hours, remainder = divmod(ms, 3600000)
    minutes, remainder = divmod(remainder, 60000)
    seconds, milliseconds = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


def cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ")


def render(lessons: list[dict], season: int) -> str:
    lessons = sorted(lessons, key=lambda item: item["episode_id"])
    totals = {key: sum(len(lesson[key]) for lesson in lessons) for key in ("vocabulary", "grammar", "discussion", "practice")}
    lines = [f"# Friends 第{season}季字幕學習單", "",
             f"本頁涵蓋{len(lessons)}集：" + "、".join(lesson["episode_id"] for lesson in lessons) + "。", "",
             "這些學習單以提供的德文字幕為來源，採德文與繁體中文對照。摘要、例句、討論題與答案提示為原創教材；詞彙來源位置按字幕原檔核對。", "",
             "**使用方式：**先讀德文摘要，再以自己的觀看版本定位場景，完成口說或短文。沒有影片時，也可以用字幕完成閱讀、重述與討論。時間碼只適用於指定字幕版本，尚未與音訊核對。", "",
             f"本頁共{totals['vocabulary']}個詞彙項目、{totals['grammar']}個語法重點、{totals['discussion']}題討論與{totals['practice']}個場景練習。字幕中的音效、片名或檔案標籤不應當作角色台詞。", "",
             f"[JSON資料](../data/subtitle_lessons/season_{season:02d}.json) · [字幕涵蓋進度](../data/subtitle_coverage.json) · [接續進度](../PROJECT_STATUS.md)", ""]
    for lesson in lessons:
        lines += [f"## {lesson['episode_id']} — {lesson['title_de']}", "",
                  f"英文集名：{lesson['title_en']}", "",
                  f"字幕版本：`{lesson['source_version_id']}`。原檔名：`{lesson['source_member']}`。", "",
                  f"[本集來源紀錄](../data/subtitle_imports/{lesson['source_batch_id']}.json)", ""]
        for note in lesson.get("source_notes_zh", []):
            lines += ["來源備註：" + note, ""]
        lines += ["### 學習目標", ""]
        lines += ["- " + goal for goal in lesson["learning_goals_zh"]]
        lines += ["", "### 劇情閱讀", "", lesson["summary_de"], "", lesson["summary_zh"], "",
                  "### 詞彙與原創例句", "", "| 德文詞彙 | 繁中 | 原創例句與翻譯 | 字幕來源位置 |", "| --- | --- | --- | --- |"]
        for word in lesson["vocabulary"]:
            anchor = f"cue {word['source_cue_id']} · {timestamp(word['source_start_ms'])}–{timestamp(word['source_end_ms'])} · 詞形：{word['source_form']}"
            lines.append(f"| {cell(word['de'])} | {cell(word['zh'])} | {cell(word['example_de'])}<br>{cell(word['example_zh'])} | {cell(anchor)} |")
        lines += ["", "### 語法練習", ""]
        for index, point in enumerate(lesson["grammar"], 1):
            lines += [f"**{index}. {point['focus_zh']}**", "", point["explanation_zh"], "",
                      "原創例句：" + point["example_de"], "", point["example_zh"], "",
                      f"對應字幕：cue {point['source_cue_id']}，{timestamp(point['source_start_ms'])}–{timestamp(point['source_end_ms'])}。", ""]
        lines += ["### 討論", ""]
        for index, question in enumerate(lesson["discussion"], 1):
            lines += [f"{index}. **{question['level']}** — {question['question_de']}  ",
                      "   " + question["question_zh"], ""]
        lines += ["### 場景練習", ""]
        for index, task in enumerate(lesson["practice"], 1):
            lines += [f"**練習{index}｜{timestamp(task['start_ms'])}–{timestamp(task['end_ms'])}，cue {task['source_cue_start']}–{task['source_cue_end']}**", "",
                      task["task_de"], "", task["task_zh"], "", "參考方向：" + task["answer_hint_de"], "", task["answer_hint_zh"], ""]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."))
    args = parser.parse_args()
    target = args.root / "docs"
    target.mkdir(parents=True, exist_ok=True)
    for source in sorted((args.root / "data/subtitle_lessons").glob("season_*.json")):
        lessons = json.loads(source.read_text(encoding="utf-8"))
        season = int(source.stem.removeprefix("season_"))
        if not lessons or any(int(lesson["episode_id"][1:3]) != season for lesson in lessons):
            raise ValueError(f"Empty or mismatched season: {source.name}")
        filename = target / f"season_{season:02d}_subtitle_lessons.md"
        filename.write_text(render(lessons, season), encoding="utf-8")
        print(f"{filename.relative_to(args.root)}: {len(lessons)} lessons")


if __name__ == "__main__":
    main()
