# API Providers（可插拔接口）

教室项目把云端能力做成可插拔配置。读题走 CosyVoice（`LLM_API_KEY`）；下列语义 Provider 为遗留代码，**读题页已不再调用匹配**。

换机配置入口：[`deploy/README.md`](../deploy/README.md)

---

## 配置（`python/data/api.env`）

**换机 / 教室部署：只填 `LLM_API_KEY`。** 其余已内置：

| 内置项 | 取值 |
|--------|------|
| 网关 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 语义模型 | `qwen-plus` |
| 读题 | `cosyvoice-v2` |
| 语义 Provider | `online` |

下面变量仅开发者覆盖用（测试或换厂商），不要写进换机模板：

| 变量 | 含义 |
|------|------|
| `LLM_API_KEY` | 共用密钥（**唯一对外项**） |
| `LLM_BASE_URL` | OpenAI 兼容根路径 |
| `LLM_CHAT_MODEL` | 文本模型（语义） |
| `SPEECH_SEMANTIC_PROVIDER` | 语义实现 `online` \| `off`（另有本地 `offline`） |

兼容旧名：`SPEECH_SEMANTIC_MODE`（未设 `SPEECH_SEMANTIC_PROVIDER` 时生效）。

---

## 目录与协议

```
python/providers/
  base.py                 # SemanticJudge Protocol
  semantic/
    factory.py            # get_semantic_judge()
    online.py             # 已实现（包装 semantic_online）
    off.py
    deepseek.py           # 骨架；也可把 BASE_URL 指到 DeepSeek 用 online
```

### SemanticJudge

```python
class SemanticJudge(Protocol):
    name: str
    def configured(self) -> bool: ...
    def score(self, transcript: str, expected: str) -> float | None: ...  # [0,1] or None
    def status(self) -> dict: ...
```

HTTP 匹配链路经 `speech_answer.semantic.semantic_score` → Provider。

---

**不要**在前端写第三方 API Key；一律经 `8765`。

---

## 如何新增一个语义厂商

1. 实现 `SemanticJudge`（可抄 `semantic/online.py`）。
2. 在 `semantic/factory.py` 注册，例如 `SPEECH_SEMANTIC_PROVIDER=my_llm`。
3. 若只是换 OpenAI 兼容网关：不必新类，改 `LLM_BASE_URL` + `LLM_CHAT_MODEL`，保持 `SPEECH_SEMANTIC_PROVIDER=online` 即可。

本地向量（`SPEECH_SEMANTIC_MODE=offline` / `auto` 回退）仍在 `speech_answer.semantic.SemanticScorer`，不经云 Provider。

---

## HTTP 状态字段

`GET /api/health` 额外包含：

- `speech_semantic_provider` / `speech_semantic_configured`
- `tts_model` / `tts_configured`

---

## 未做（后续切片）

- 大目录按 vision/speech/scoreboard 物理拆分
- `server.py` 拆成 FastAPI router
- 真正接通 `deepseek` 骨架类
