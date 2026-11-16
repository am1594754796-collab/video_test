"""Convert a numbered A–D Word question bank into this project's JSON format.

Usage from python/:
    .venv/Scripts/python.exe -m speech_answer.import_docx_bank source.docx data/new_bank.json
"""

from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from speech_answer.answer_bank import AnswerBank


W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
QUESTION = re.compile(r"^\s*(\d+)[.．、]\s*(.+)$")
OPTION = re.compile(r"^\s*([A-D])[.．、]\s*(.+)$", re.IGNORECASE)
ANSWER = re.compile(r"^\s*答案\s*[:：]\s*([A-D])\s*$", re.IGNORECASE)


def paragraphs(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))
    return [
        "".join(node.text or "" for node in paragraph.iter(W + "t")).strip()
        for paragraph in root.iter(W + "p")
    ]


def convert(path: Path) -> dict:
    questions = []
    current = None
    for line in paragraphs(path):
        if not line:
            continue
        match = QUESTION.match(line)
        if match:
            number = int(match.group(1))
            if number != len(questions) + 1:
                raise ValueError(f"题号不连续：{number}")
            current = {"id": f"Q{number:02d}", "prompt_parts": [match.group(2)], "options": {}, "answer": None}
            questions.append(current)
            continue
        if current is None:
            raise ValueError(f"题号前出现内容：{line}")
        match = OPTION.match(line)
        if match:
            key = match.group(1).upper()
            if key in current["options"]:
                raise ValueError(f"{current['id']} 的选项 {key} 重复")
            current["options"][key] = match.group(2).strip()
            continue
        match = ANSWER.match(line)
        if match:
            current["answer"] = match.group(1).upper()
            continue
        if current["options"] or current["answer"]:
            raise ValueError(f"{current['id']} 选项或答案之后出现无法解析的内容：{line}")
        current["prompt_parts"].append(line)

    result = {"questions": []}
    for item in questions:
        if set(item["options"]) != set("ABCD") or item["answer"] not in item["options"]:
            raise ValueError(f"{item['id']} 缺少完整的 A–D 选项或标准答案")
        result["questions"].append({
            "id": item["id"],
            "prompt": "\n".join(item["prompt_parts"]),
            "options": item["options"],
            "answer": item["answer"],
        })
    if not result["questions"]:
        raise ValueError("未找到题目")
    AnswerBank.from_dict(result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="将 Word 选择题转换为独立 JSON 题库")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error(f"目标文件已存在，未覆盖：{args.output}")
    data = convert(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已生成 {args.output}，共 {len(data['questions'])} 题")


if __name__ == "__main__":
    main()
