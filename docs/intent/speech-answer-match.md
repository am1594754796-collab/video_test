# Intent: 口头作答 — 语音识别与答案匹配

Status: **在线路径为准**（2026-10：离线 Whisper 页已移除）

## Module

**语音识别与答案匹配（Speech Answer Match）** — 与视觉识别解耦；听写在浏览器，匹配在 Python。

## Confirmed intent（当前）

- **Outcome:** 外部已选定当前题时，浏览器实时听写 → Python 模糊/语义匹配；相似度 ≥ 90% 判对。
- **User:** 教室老师端流程 / 下游抢答判题模块。
- **Success:** 给定 `question_id`，听答流程产出可机读结果（transcript / score / passed / expected）。
- **Constraint:** 中文；一题唯一标准答案；匹配阈值 90%；需联网（Web Speech + 可选线上语义）。
- **Removed:** 离线 Whisper 录音上传页（`speech.html`）与相关 ASR 依赖。

## Related

- Spec: `docs/SPEC-speech-answer.md`（定稿）
- Plan: `tasks/plan-speech.md` · Todo: `tasks/todo-speech.md`
- Upstream: 外部模块选定 `question_id`
- Sibling: `SPEC.md`（视觉识别）
