# Spec: 口头作答 — 语音识别与答案匹配（Speech Answer Match）

> **Status:** **定稿 / Approved** — 2026-08-08（用户确认假设并定稿）  
> **模块定位：** 系统的 **Python 语音识别与答案匹配** 部分。  
> 职责边界：麦克风取音 → 离线中文 ASR → 按外部给定的 `question_id` 取唯一标准答案 → 模糊匹配（≥ 90%）→ 返回结构化结果。  
> **不包含** 选题、计分、抢答流程、浏览器识别。

## Objective

在线下教室场景中，当外部模块已选定当前题目后，在老师电脑本地用 Python **离线**采集学生口头作答，转成中文文本，并与答案库中该题的唯一标准答案做模糊匹配；相似度达到 **90%** 及以上视为答对。

### User stories

1. 作为下游模块，我能加载答案库，并指定当前 `question_id`。
2. 作为下游模块，我能触发一次「听答」：从默认麦克风录音，得到转写文本与匹配结果。
3. 作为下游模块，我也能在无麦克风场景下，直接传入已有文本做同样的模糊匹配（便于单测与调试）。
4. 作为开发者，我能用固定音频 / 文本 fixture 跑通匹配逻辑，而不依赖教室实机。

### Acceptance criteria

- [ ] 答案库可从本地文件加载；每题有唯一 `question_id` 与唯一标准答案字符串。
- [ ] 外部传入 `question_id`；未知 id 时明确失败（不静默猜题）。
- [ ] 能从本机默认麦克风录音（可配置时长 / 静音结束策略见行为细节）。
- [ ] 离线中文 ASR 输出转写文本（无网络依赖即可完成识别路径）。
- [ ] 转写结果与标准答案模糊匹配；相似度 ≥ **0.90** → `passed: true`。
- [ ] 返回至少：`question_id`、`transcript`、`expected`、`score`（0–1）、`passed`。
- [ ] 纯匹配逻辑有单元测试；不强制在 CI 中跑真实麦克风 / 大模型下载。

## Tech Stack

**已定技术基线（定稿锁定）：**

| Layer | Choice |
|-------|--------|
| Language | Python 3.10+（与现有 `python/` 一致） |
| ASR | `faster-whisper`（本地 Whisper，默认小模型如 `base` / `small`，`language="zh"`） |
| Mic | `sounddevice` 录音为 PCM / WAV |
| Fuzzy match | `rapidfuzz.fuzz.ratio`（归一化到 0–1）或等价；阈值 **0.90** |
| Answer bank | 本地 JSON |
| HTTP（可选，本切片可不做） | 可后续挂到现有 FastAPI；首版以可导入的库 API 为主 |
| Tests | `pytest`（已有 `python/tests/`） |

## Commands

```
# 虚拟环境（与现有一致）
cd python
.venv\Scripts\pip.exe install -r requirements.txt

# 单测（匹配与答案库；不依赖麦克风）
.venv\Scripts\python.exe -m pytest tests/test_answer_bank.py tests/test_fuzzy_match.py tests/test_speech_match.py -q

# 手动听答（实机麦克风；需已下载 Whisper 模型）
.venv\Scripts\python.exe -m speech_answer.cli --answers data/answers.sample.json --question Q1 --seconds 5
```

## Project Structure

```
docs/
  intent/speech-answer-match.md   → 已确认意图
  SPEC-speech-answer.md           → 本规格
python/
  speech_answer/                  → 【本模块】
    __init__.py                   → 对外导出
    answer_bank.py                → 加载 / 按 id 取唯一答案
    fuzzy_match.py                → 文本归一化 + 模糊匹配
    asr.py                        → 离线 Whisper 转写
    mic.py                        → 麦克风录音
    match_service.py              → 编排：听答 / 纯文本匹配
    cli.py                        → 命令行演示
  data/
    answers.sample.json           → 示例答案库
  tests/
    test_answer_bank.py
    test_fuzzy_match.py
    test_speech_match.py          → 编排（mock ASR）
  requirements.txt                → 追加本模块依赖
```

与视觉模块关系：并列、解耦；不修改 `src/vision/` 行为。现有 `server.py`（人物排序）首版可不合并本模块路由。

## Code Style

- 匹配与答案库为纯函数 / 无 IO 核心，便于单测。
- ASR / 麦克风用适配器隔离；测试中 mock。
- 对外分数统一 **0.0–1.0**；阈值常量 `MATCH_THRESHOLD = 0.90`。
- 文本匹配前做轻量归一化（去首尾空白、统一全半角标点、去除无意义空白）；**不做**同义改写（一题唯一答案）。

```python
# Good: pure match; no mic / model
def fuzzy_score(transcript: str, expected: str) -> float:
    ...

def is_match(transcript: str, expected: str, threshold: float = 0.90) -> bool:
    return fuzzy_score(transcript, expected) >= threshold

# Good: service returns a fact for callers
@dataclass(frozen=True)
class MatchResult:
    question_id: str
    transcript: str
    expected: str
    score: float
    passed: bool
```

## Testing Strategy

| Level | What | Where |
|-------|------|--------|
| Unit | 答案库加载、未知 id、唯一答案取出 | `tests/test_answer_bank.py` |
| Unit | 归一化、刚好 ≥/＜ 0.90、完全相同 / 完全不同 | `tests/test_fuzzy_match.py` |
| Unit | 编排：给定 mock transcript → 正确 `passed` | `tests/test_speech_match.py` |
| Manual | 实机麦 + 中文短句 vs 示例答案库 | `python -m speech_answer.cli` |

- CI / 默认可只跑纯逻辑单测；Whisper 权重不进仓库。
- 不强制录制真实语音进 git；可用文本注入路径验证。

## Boundaries

### Always

- 标明本模块为 **语音识别与答案匹配**；不内置计分。
- 题目由外部传入 `question_id`；模块不自行选题。
- 一题唯一标准答案；匹配阈值默认 0.90。
- 离线 ASR 路径不得依赖公网识别 API。
- 改阈值或答案库 schema 时同步更新本 SPEC 与测试。

### Ask first

- 换成其他 ASR 引擎（FunASR、vosk 等）。
- 把本模块 HTTP 路由并入 `server.py` 或另起端口。
- 默认 Whisper 模型体积 / 精度档位变更（`tiny` / `base` / `small` / `medium`）。
- 一题多候选答案或同义扩展。

### Never

- 在本模块内写死加分、姓名、抢答胜者逻辑。
- 用在线 Google / 云厂商 ASR 冒充「离线版」。
- 提交 API 密钥或教室真实录音到仓库。
- 未知 `question_id` 时静默落到某一题。

## Success Criteria

1. 示例答案库 + 文本注入：相同答案 `passed=true` 且 `score>=0.90`；明显不同 `passed=false`。
2. 边界：相似度算法下「刚好过线 / 差一线」有单测锁定阈值行为。
3. 实机（可选演示）：`cli` 能录音并打印 `MatchResult`。
4. 与视觉模块无强制耦合；意图文档与本 SPEC 一致。

## Behavior details

### Answer bank (JSON)

```json
{
  "questions": [
    { "id": "Q1", "answer": "北京" },
    { "id": "Q2", "answer": "光合作用" }
  ]
}
```

- `id` 唯一；`answer` 唯一标准答案（字符串）。
- 加载时若重复 `id` → 报错。

### Listening

- 默认：录制固定秒数（如 5s），或「最大时长 + 尾部静音结束」（实现时二选一，CLI 可配）。
- 采样：16 kHz mono，供 Whisper 使用。

### Matching

- `char_score = rapidfuzz.fuzz.ratio(norm(a), norm(b)) / 100.0`
- `pinyin_score = rapidfuzz.fuzz.ratio(pinyin_TONE3(a), pinyin_TONE3(b)) / 100.0`
- `score = max(char_score, pinyin_score)`（同音错字可过线）
- `passed = score >= 0.90`
- 拼音用 `pypinyin` `Style.TONE3`（带调号），减轻「北京 / 背景」这类不同调误判；不做语义向量。

## Resolved decisions（定稿）

1. **ASR：** `faster-whisper`，默认模型 `base`，`language="zh"`；权重本机缓存，离线推理。
2. **录音：** `sounddevice`，默认固定约 5 秒（CLI 可配）。
3. **匹配：** `max(字形 ratio, 拼音 TONE3 ratio)` → `[0,1]`；阈值 **0.90**；轻量归一化 + 同音容错。
4. **答案库：** 本地 JSON（`id` + 唯一 `answer`）。
5. **交付：** `python/speech_answer/` 库 API + CLI + pytest；网页：`speech.html`（离线 Whisper 录音上传）、`speech-online.html`（浏览器 Web Speech 在线听写 → `/api/speech/match-text`）；FastAPI 已挂载语音路由。
6. **CI：** 只跑纯逻辑 / mock / match-text API 单测；不强制下载 Whisper、不跑真实麦克风。

## Open Questions

- 无。后续变更须先改本 SPEC 再实现。
