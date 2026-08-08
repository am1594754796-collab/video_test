# Todo: 语音识别与答案匹配

依据：`docs/SPEC-speech-answer.md`（定稿）+ `tasks/plan-speech.md`  
范围：仅 Speech Answer Match；不含选题 / 计分 / HTTP 合并。

## Phase 1 — 纯逻辑

- [x] **T1** 答案库 + 模糊匹配 + `match_text`
  - Acceptance: 未知/重复 id 报错；≥0.90 判对；示例 JSON；单测绿
  - Verify: `cd python && .venv\Scripts\python.exe -m pytest tests/test_answer_bank.py tests/test_fuzzy_match.py tests/test_speech_match.py -q`
  - Files: `python/speech_answer/*`, `python/data/answers.sample.json`, `python/requirements.txt`

### Checkpoint — Match contract
- [x] 无硬件依赖下匹配契约锁定

## Phase 2 — 听答链路

- [x] **T2** 麦克风录音（16 kHz mono WAV，可配秒数）
  - Acceptance: 写出 WAV；可 mock
  - Verify: 代码审查 + 可选实机
  - Dependencies: T1

- [x] **T3** faster-whisper 中文离线转写
  - Acceptance: `transcribe_zh`；默认可配模型 `base`
  - Verify: mock 单测；实机可选
  - Dependencies: T2（接口可并行）

- [x] **T4** `listen_and_match` + CLI
  - Acceptance: 完整 `MatchResult`；CLI 可跑
  - Verify: mock 编排单测；`python -m speech_answer.cli …` 实机
  - Dependencies: T1–T3

### Checkpoint — Offline listen path
- [x] mock 单测绿；用户实机 CLI 确认中文听答（待本机麦克风）
