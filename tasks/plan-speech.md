# Implementation Plan: 语音识别与答案匹配（Speech Answer Match）

## Overview

按定稿 `docs/SPEC-speech-answer.md`，在 `python/speech_answer/` 落地离线中文听答模块：答案库 → 模糊匹配（≥0.90）→ 麦克风录音 → faster-whisper 转写 → 编排返回 `MatchResult`。不含选题、计分、HTTP 合并进 `server.py`。

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| 先纯函数（答案库 + fuzzy）+ pytest，再接 mic/ASR | 阈值与 schema 可无硬件验证；失败成本最低 |
| `faster-whisper` + 默认 `base` | 定稿锁定；中文离线够用，体积可接受 |
| `rapidfuzz.ratio` / 100，阈值常量 `0.90` | 与 SPEC 一致；行为可用边界单测锁定 |
| mic / ASR 适配器隔离 | 单测 mock；CLI 实机 |
| 首版不做 FastAPI 路由 | SPEC Ask first；保持与人物排序 API 解耦 |

## Dependency Graph

```
answer_bank (JSON load / get by id)
    │
fuzzy_match (normalize + score + threshold)
    │
match_service.match_text(question_id, transcript)
    │
    ├── mic.record_wav(seconds)
    │       │
    │       └── asr.transcribe_zh(audio_path) ──→ match_service.listen_and_match
    │
    └── cli（演示）
```

## Tasks (ordered)

### T1 — 答案库 + 模糊匹配（纯逻辑竖切）

**Description:** 加载 JSON 答案库；按 `question_id` 取唯一答案；文本归一化 + `rapidfuzz` 评分；`MatchResult` / `match_text`。

**Acceptance:**
- [ ] 重复 id / 未知 id 明确报错
- [ ] 完全相同 → `passed=true`，`score>=0.90`
- [ ] 明显不同 → `passed=false`
- [ ] 阈值边界有单测（≥0.90 / ＜0.90）

**Verify:** `python -m pytest tests/test_answer_bank.py tests/test_fuzzy_match.py tests/test_speech_match.py -q`（本任务先落地前两个 + match_text）

**Files:** `python/speech_answer/{__init__,answer_bank,fuzzy_match,match_service}.py`, `python/data/answers.sample.json`, `python/tests/test_*.py`, `python/requirements.txt`

**Scope:** Medium

### T2 — 麦克风录音适配器

**Description:** `sounddevice` 录制 16 kHz mono WAV，固定秒数可配。

**Acceptance:**
- [ ] 可写出临时 WAV；采样率/声道符合 SPEC
- [ ] 无麦环境单测可跳过或 mock

**Verify:** 单元 mock；实机可选

**Dependencies:** T1

**Files:** `python/speech_answer/mic.py`, tests as needed

**Scope:** Small

### T3 — 离线 ASR（faster-whisper）

**Description:** 封装 `transcribe_zh(path) -> str`；`language="zh"`；模型名可配，默认 `base`。

**Acceptance:**
- [ ] 无网络调用公网 ASR
- [ ] 可对 fixture/mock 注入；真实模型不进仓库

**Verify:** mock 单测；实机手动

**Dependencies:** T2（可并行于接口，但 listen 编排依赖两者）

**Files:** `python/speech_answer/asr.py`, `requirements.txt`

**Scope:** Medium

### T4 — 编排 + CLI

**Description:** `listen_and_match(question_id, …)`；`python -m speech_answer.cli --answers … --question Q1 --seconds 5`。

**Acceptance:**
- [ ] 返回完整 `MatchResult`
- [ ] CLI 打印 transcript / score / passed / expected

**Verify:** mock 编排单测 + 可选实机 CLI

**Dependencies:** T1–T3

**Files:** `python/speech_answer/cli.py`, `match_service.py`, `tests/test_speech_match.py`

**Scope:** Small

## Checkpoint — After T1

- 纯逻辑单测全绿；不依赖 Whisper/麦克风即可证明匹配契约。

## Checkpoint — After T4

- mock 听答路径绿；README / 模块头注明离线语音模块；实机 CLI 由用户本机验证。

## Risks

| Risk | Mitigation |
|------|------------|
| Whisper 首次下载大、CPU 慢 | 默认 `base`；文档说明；允许 `--model tiny` |
| 中文 ASR 误识导致难达 90% | 首版不做拼音容错；实机后再 Ask first |
| sounddevice 驱动问题（Windows） | mic 隔离；文本注入路径始终可用 |

## Out of scope（本计划）

- 并入 `server.py`、一题多答案、在线 ASR、与视觉模块强耦合、计分 UI
