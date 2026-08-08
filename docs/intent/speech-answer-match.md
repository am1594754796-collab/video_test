# Intent: 口头作答 — 语音识别与答案匹配

Status: **confirmed + SPEC 定稿 + 在线识别 V1.0 已记入 README** (2026-08-08)


## Module

**语音识别与答案匹配（Speech Answer Match）** — 与视觉识别解耦的 Python 模块。

## Confirmed intent

- **Outcome:** 外部已选定当前题时，本机麦克风采音 → 离线中文转写 → 与该题唯一标准答案模糊匹配；相似度 ≥ 90% 判对，并返回转写文本、匹配分、标准答案。
- **User:** 教室老师端流程 / 下游抢答判题模块。
- **Why now:** 举手之后需要可接入的「口头作答是否正确」能力。
- **Success:** 给定 `question_id`，一次听答流程产出可机读结果（transcript / score / passed / expected）。
- **Constraint:** 离线 ASR；中文；一题唯一标准答案；匹配阈值 90%。
- **Out of scope:** 语音选题、一题多候选同义答案、在线 ASR、计分 UI、抢答流程臂装、浏览器端识别。

## Related

- Spec: `docs/SPEC-speech-answer.md`（定稿）
- Plan: `tasks/plan-speech.md` · Todo: `tasks/todo-speech.md`
- Upstream: 外部模块选定 `question_id`
- Sibling: `SPEC.md`（视觉识别）
