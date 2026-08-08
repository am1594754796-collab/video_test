# 答案库（随仓库移植）

教室语音作答使用的**本地 JSON 答案库**在本目录，已纳入 Git，换机 `git clone` 后即可直接使用。

## 正式文件（默认加载）

| 文件 | 说明 |
|------|------|
| **`answers.json`** | **正式答案库**。Python API / 网页默认读这个文件。改题、改答案只改它，并提交到 Git。 |
| `answers.sample.json` | 示例副本（与正式文件同结构）。可对照格式；缺省时也可作回退。 |

完整路径（相对仓库根目录）：

```
python/data/answers.json
```

## 格式

```json
{
  "questions": [
    { "id": "Q1", "answer": "北京" },
    { "id": "Q2", "answer": "光合作用" }
  ]
}
```

- `id`：题目编号（网页下拉 / API 的 `question_id`），须唯一  
- `answer`：该题**唯一**标准答案（字符串）  
- 匹配：≥90% 模糊相似，含同音（拼音）容错  

## 换机后怎么用

1. `git clone` 本仓库（不要只拷 `node_modules` / `.venv`）  
2. 确认存在：`python/data/answers.json`  
3. 按需编辑该文件后，启动 `start-speech-online.bat`（或 `start-speech.bat`）  
4. 网页选题来自该文件；改完需**重启 Python API**（`uvicorn`）才会重新加载  

可选：用环境变量指向别的文件（一般不需要）：

```bat
set SPEECH_ANSWERS_PATH=E:\path\to\answers.json
```
