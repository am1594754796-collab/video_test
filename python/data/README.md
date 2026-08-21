# 答案库（自己配置 · 相对路径指向）

本目录存放**可自行编辑**的题目/答案 JSON。使用时用**相对 `python/` 的路径**指向目标文件。

## 给你改的文件

| 文件 | 说明 |
|------|------|
| **`answers.json`** | **默认答案库**。直接改这里的 `id` / `answer`。 |
| **`answers.path`** | 一行相对路径，决定启动时加载哪个 JSON（可改成别的库）。 |
| `answers.sample.json` | 格式示例，可复制成 `week1.json` 等再改。 |

## 相对路径怎么写

一律相对 **`python/`** 目录（不是仓库根目录）：

| 你想用的文件 | 相对路径写法 |
|--------------|--------------|
| `python/data/answers.json` | `data/answers.json` |
| `python/data/week1.json` | `data/week1.json` |

### 三种用法（任选）

1. **改 `answers.path`**（推荐，持久）  
   打开 `answers.path`，把路径改成例如：
   ```
   data/week1.json
   ```
   重启 Python API 后生效。

2. **网页输入框**  
   语音页填相对路径 → 点「加载答案库」（会写入 `answers.path`）。

3. **环境变量**  
   ```bat
   set SPEECH_ANSWERS_PATH=data/week1.json
   ```
   （在 `python/` 下启动 uvicorn 时生效；可为相对或绝对路径。）

4. **CLI**  
   ```bat
   cd python
   .venv\Scripts\python.exe -m speech_answer.cli --answers data/answers.json --question Q1 --text 北京
   ```

## JSON 格式（自己加题）

选择题（推荐 · 支持扬声器读题干 + A/B/C/D）：

```json
{
  "questions": [
    {
      "id": "Q1",
      "prompt": "中国的首都是哪里？",
      "options": {
        "A": "上海",
        "B": "北京",
        "C": "广州",
        "D": "深圳"
      },
      "answer": "北京"
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 题号，须唯一 |
| `answer` | 是 | 标准答案（用于匹配；**不会**被扬声器读出） |
| `prompt` | 否 | 题干；读题时朗读 |
| `options` | 否 | `A`/`B`/`C`/`D` 选项文本；读题时朗读 |

短答旧格式仍可用：`{ "id": "Q1", "answer": "北京" }`（无题干/选项则无法完整读题）。

匹配 ≥90%，含同音容错。改完 JSON 后：若 API 已在跑，在网页再点一次「加载答案库」，或重启 uvicorn。

**读题：** 语音页选题后点「扬声器读题」（Chrome/Edge，本机扬声器）。

## 统一 API 配置（`api.env`）

所有云端 Key **只放一个文件**：

```
python/data/api.env
```

从模板复制：

```bat
copy python\data\api.env.example python\data\api.env
```

编辑 `api.env`：

```
LLM_API_KEY=你的Key
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_CHAT_MODEL=qwen-plus
LLM_VISION_MODEL=qwen-vl-plus
SPEECH_SEMANTIC_MODE=online
VISION_FACE_MODE=qwen
```

| 变量 | 用途 |
|------|------|
| `LLM_API_KEY` | 语音语义 + 千问人脸 **共用** |
| `LLM_CHAT_MODEL` | 语音答对语义判分 |
| `LLM_VISION_MODEL` | 人脸检测（须 `qwen-vl-*`） |

`api.env` 已 gitignore，**不要提交**。改完后重启 uvicorn。

旧文件 `online.env` 仍会加载（兼容），但新配置请只维护 `api.env`。

## 线上语义判分（整句）

见上方 `api.env` 中 `SPEECH_SEMANTIC_MODE=online` 与 `LLM_CHAT_MODEL`。

## 换机移植

`git clone` 后本目录会一起带走。确认存在：

```
python/data/answers.json
python/data/answers.path
```
