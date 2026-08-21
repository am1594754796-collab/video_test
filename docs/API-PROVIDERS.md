# API Providers（可插拔接口）

教室项目把**人脸检测**与**答对语义**做成 Provider：页面只打本机 API，换厂商时改 `api.env` + 加一个实现类，不必改前端。

换机配置入口：[`deploy/README.md`](../deploy/README.md)

---

## 配置（`python/data/api.env`）

**换机 / 教室部署：只填 `LLM_API_KEY`。** 其余已内置：

| 内置项 | 取值 |
|--------|------|
| 网关 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| 语义模型 | `qwen-plus` |
| 人脸模型 | `qwen-vl-plus` |
| 人脸 Provider | `qwen` |
| 语义 Provider | `online` |

下面变量仅开发者覆盖用（测试或换厂商），不要写进换机模板：

| 变量 | 含义 |
|------|------|
| `LLM_API_KEY` | 共用密钥（**唯一对外项**） |
| `LLM_BASE_URL` | OpenAI 兼容根路径 |
| `LLM_CHAT_MODEL` | 文本模型（语义） |
| `LLM_VISION_MODEL` | 视觉模型（人脸，须多模态） |
| `VISION_FACE_PROVIDER` | 人脸实现 `qwen` \| `off`（骨架：`openai`） |
| `SPEECH_SEMANTIC_PROVIDER` | 语义实现 `online` \| `off`（另有本地 `offline`） |

兼容旧名：`VISION_FACE_MODE`、`SPEECH_SEMANTIC_MODE`（未设 `*_PROVIDER` 时生效）。

---

## 目录与协议

```
python/providers/
  base.py                 # FaceDetector / SemanticJudge Protocol
  face/
    factory.py            # get_face_detector()
    qwen.py               # 已实现（包装 vision_face.detect_faces_qwen）
    off.py
    openai_vision.py      # 骨架，未接线
  semantic/
    factory.py            # get_semantic_judge()
    online.py             # 已实现（包装 semantic_online）
    off.py
    deepseek.py           # 骨架；也可把 BASE_URL 指到 DeepSeek 用 online
```

### FaceDetector

```python
class FaceDetector(Protocol):
    name: str
    def configured(self) -> bool: ...
    def detect(self, image_base64: str, *, max_faces: int = 6, mime: str = "image/jpeg") -> list[dict]: ...
    def status(self) -> dict: ...
```

返回框归一化到 `[0,1]`，字段：`x_min,y_min,width,height,score`（可含 `cx,cy`）。HTTP：`POST /api/vision/detect-faces`。

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

## 如何新增一个人脸厂商

1. 在 `python/providers/face/` 新建 `my_vendor.py`，实现与 `QwenFaceDetector` 相同方法。
2. 在 `face/factory.py` 的 `get_face_detector()` 注册：

```python
if name == "my_vendor":
    return MyVendorFaceDetector()
```

3. `api.env` 设 `VISION_FACE_PROVIDER=my_vendor`，填好该厂商需要的 Key / URL / Model。
4. 重启 uvicorn；`GET /api/health` 看 `vision_face_provider` / `vision_face_configured`。

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

- `vision_face_provider` / `vision_face_configured`
- `speech_semantic_provider` / `speech_semantic_configured`

`POST /api/vision/detect-faces` 响应可含 `provider` 字段。

---

## 未做（后续切片）

- 大目录按 vision/speech/scoreboard 物理拆分
- `server.py` 拆成 FastAPI router
- 真正接通 `openai_vision` / `deepseek` 骨架类
