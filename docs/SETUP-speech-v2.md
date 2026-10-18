# 读题 · CosyVoice · 移植配置手册

> **换机总入口（读题统一 `api.env`）：** [`deploy/README.md`](../deploy/README.md)  
> **换 API 厂商：** [`API-PROVIDERS.md`](./API-PROVIDERS.md)

> 目标：换机 `git clone` 后，按本文配置，复现当前能力：  
> **CosyVoice 2 读题（语速可调、音色可指定）+ 题库相对路径。听写与答案匹配已移除。**  
> 页面：http://localhost:5173/speech-online.html  
> 一键脚本：`start-speech-online.bat`

---

## 0. 你需要准备什么

| 项 | 要求 |
|----|------|
| 系统 | Windows（本项目 bat 按 Windows 编写） |
| Node.js | LTS（能跑 `npm` / Vite） |
| Python | 3.10+（推荐 3.12） |
| 浏览器 | Chrome 或 Edge |
| 网络 | 要联网（CosyVoice） |
| 百炼 Key | 阿里云百炼 `LLM_API_KEY`（**不要提交到 Git**） |

仓库：https://github.com/am1594754796-collab/video_test  

**不要**从旧电脑拷贝 `node_modules`、`python\.venv`。

---

## 1. 拿到代码

```bat
git clone https://github.com/am1594754796-collab/video_test.git
cd video_test
```

或解压 zip 后进入项目根目录。

---

## 2. 安装依赖（必做）

### 2.1 前端

在项目根目录：

```bat
npm.cmd install
```

### 2.2 Python

```bat
cd python
python -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\pip.exe install -r requirements.txt
cd ..
```

若 PyPI 慢，可用清华镜像：

```bat
.venv\Scripts\pip.exe install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple --trusted-host pypi.tuna.tsinghua.edu.cn
```

---

## 3. 必配文件清单（移植时重点看）

| 文件 | 是否进 Git | 你要做什么 |
|------|------------|------------|
| `python/data/answers.json` | 是 | 改题目 / 标准答案 |
| `python/data/answers.path` | 是 | 一行相对路径，指向要用哪个 JSON |
| `python/data/api.env` | **否**（gitignore） | **推荐**：读题 Key，每台机器新建 |
| `python/data/api.env.example` | 是 | 复制模板用，勿把真 Key 写回 example |
| `python/data/online.env` | **否**（gitignore） | 旧配置，仍兼容；新机器请用 `api.env` |
| `python/data/online.env.example` | 是 | 旧模板 |

路径约定：相对路径一律相对 **`python/`** 目录。  
例：`data/answers.json` → 实际文件 `python/data/answers.json`。

---

## 4. 配置答案库

### 4.1 编辑题目与答案

打开 `python/data/answers.json`：

```json
{
  "questions": [
    { "id": "Q1", "answer": "北京" },
    { "id": "Q2", "answer": "光合作用" },
    {
      "id": "Q3",
      "answer": "植物利用阳光把二氧化碳和水转化成有机物并释放氧气"
    }
  ]
}
```

规则：

- `id` 唯一（网页下拉 / API 的 `question_id`）
- 一题只有一个 `answer`（字符串）
- 可复制多份如 `data/week1.json`，再用相对路径切换

### 4.2 指定当前使用哪个 JSON

编辑 `python/data/answers.path`（非注释的第一行）：

```
data/answers.json
```

也可在网页输入框改路径后点「加载答案库」（会写回 `answers.path`）。

改完 JSON 后：网页再点一次「加载答案库」，或重启 Python API。

---

## 5. 配置统一 API（CosyVoice 读题）

### 5.1 生成本地密钥文件

在项目根目录：

`at
copy python\data\api.env.example python\data\api.env
`

### 5.2 填写内容

用记事本打开 python\data\api.env，**只填 Key**：

```
LLM_API_KEY=这里填你的阿里云 DashScope（千问）密钥
```

说明：

- LLM_API_KEY：供 **CosyVoice 读题** 使用
- 读题默认模型 `cosyvoice-v2`、音色 `longxiaochun_v2`，页面语速滑块范围 0.5–2.0
- 要锁定复刻音色：在 `api.env` 设置 `TTS_VOICE=` 控制台音色 ID（须与 `TTS_MODEL` 匹配）
- 地址、模型、开关已内置，不要改
- 不要把填好 Key 的 api.env 提交到 Git
- 换机后必须重新创建并填写（不会随仓库带走）
- 旧文件 online.env 仍兼容，新配置请只用 api.env

### 5.3 生效方式

保存后 **重启** uvicorn（或重新运行启动脚本）。
server.py 启动时会自动加载 python/data/api.env（以及旧的 online.env）。

---

## 6. 启动与验收

### 6.1 一键启动（推荐）

```bat
start-speech-online.bat
```

会启动：

- Python API：http://127.0.0.1:8765  
- 网页：http://localhost:5173/speech-online.html  

### 6.2 手动启动

终端 1：

```bat
cd python
.venv\Scripts\uvicorn.exe server:app --host 127.0.0.1 --port 8765
```

终端 2（项目根）：

```bat
npm.cmd run dev
```

浏览器打开：http://localhost:5173/speech-online.html  

### 6.3 验收清单（与当前功能对齐）

1. 页顶显示 **Python API 已连接 · 读题 cosyvoice-v2**  
2. 题库路径为 `data/answers.json`（或你配置的路径），题目下拉有内容  
3. 选一题 → 调语速 → **扬声器读题**  
4. 听到题干与选项，**不念**标准答案  
5. **停止朗读**可立刻打断  

---

## 7. 读题说明

- 模型默认 `cosyvoice-v2`，音色默认 `longxiaochun_v2`  
- 语速：页面滑块 **0.5–2.0**  
- 朗读文本：题干 + 选项 A–D；**从不朗读** `answer` 字段  

---

## 8. 常用可选环境变量

| 变量 | 示例 | 作用 |
|------|------|------|
| `TTS_MODEL` | `cosyvoice-v2` | 读题模型 |
| `TTS_VOICE` | `longxiaochun_v2` | 系统或复刻音色 ID |
| `TTS_WORKSPACE_ID` | 业务空间 ID | 走新域名时填写 |
| `SPEECH_ANSWERS_PATH` | `data/answers.json` | 启动时指定题库（相对 `python/`） |

---

## 9. 故障速查

| 现象 | 处理 |
|------|------|
| Python API: 未连接 | 确认 8765 已起；Vite 代理 `/api` → `127.0.0.1:8765` |
| 读题未配置 / 503 | 检查 `api.env` 的 `LLM_API_KEY`；重启 API |
| 播报失败 | 看 API 日志；确认百炼已开通 CosyVoice v2 |
| 题目为空 | 检查 `answers.path` 与 JSON 是否存在、格式是否合法 |
| pip 安装失败 | 换清华镜像；勿复制旧 `.venv` |
| Git 推不上去 | 检查网络 / Clash 代理后再 `git push` |

---

## 10. 相关文档索引

| 文档 | 内容 |
|------|------|
| 本文 `docs/SETUP-speech-v2.md` | **移植配置总手册** |
| `README.md` → 语音识别 V2.0 | 版本能力与摘要 |
| `python/data/README.md` | 答案库路径说明 |
| `docs/SPEC-speech-answer.md` | 规格 |
| `docs/intent/speech-answer-match.md` | 意图确认 |

换机时：**优先按本文第 2～6 节做完**，即可对齐当前语音识别 V2.0 效果。
