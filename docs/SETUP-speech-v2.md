# 语音识别 V2.0 · 移植配置手册

> **换机总入口（含人脸 + 语义统一 `api.env`）：** [`deploy/README.md`](../deploy/README.md)  
> **换 API 厂商：** [`API-PROVIDERS.md`](./API-PROVIDERS.md)

> 目标：换机 `git clone` 后，按本文配置，复现当前能力：  
> **Web Speech 实时听写 + 答案库相对路径 + 线上语义 + ≥90% 匹配 + 10s 限时（通过/超时即停）**。  
> 页面：http://localhost:5173/speech-online.html  
> 一键脚本：`start-speech-online.bat`

---

## 0. 你需要准备什么

| 项 | 要求 |
|----|------|
| 系统 | Windows（本项目 bat 按 Windows 编写） |
| Node.js | LTS（能跑 `npm` / Vite） |
| Python | 3.10+（推荐 3.12） |
| 浏览器 | **Chrome 或 Edge**（Web Speech） |
| 网络 | 要联网（听写 + DeepSeek API） |
| 麦克风 | 系统允许浏览器使用麦克风 |
| DeepSeek Key | 自行在 DeepSeek 开放平台申请（**不要提交到 Git**） |

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
| `python/data/api.env` | **否**（gitignore） | **推荐**：统一 Key（语音+人脸），每台机器新建 |
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

## 5. 配置统一 API（语音语义 + 千问人脸）

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

- LLM_API_KEY：语音与人脸 **共用** 一把 Key
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

1. 页顶显示 **Python 匹配 API: 已连接**  
2. 答案库路径为 `data/answers.json`（或你配置的路径），题目下拉有内容  
3. 选 **Q3** → **按下开始识别**  
4. 出现 **剩余 Ns** 倒计时（共 **10s**）  
5. 说话时转写实时更新，分数含 **字形 · 拼音 · 语义**  
6. **答对（≥90%）** → 立即停止听写  
7. **未答对直到 10s** → 自动结束并给出最终匹配结果  

---

## 7. 匹配规则（当前实现）

总分 = **max(字形相似度, 拼音相似度, 语义分)**  

- 阈值：**≥ 0.90** 判通过  
- 语义：DeepSeek Chat 判「学生说法是否答对标准答案」（适合整句口语）  
- 无 Key / 语义失败时：仍可用字形 + 拼音（语义项可能为「—」）

限时：**10 秒**（写在前端 `speech-board-online.ts` 的 `ANSWER_LIMIT_MS`）

---

## 8. 常用可选环境变量

| 变量 | 示例 | 作用 |
|------|------|------|
| `SPEECH_SEMANTIC_MODE` | `online` / `offline` / `off` | 语义模式 |
| `SPEECH_LLM_API_KEY` | `sk-...` | 线上模型密钥 |
| `SPEECH_LLM_BASE_URL` | `https://api.deepseek.com` | API 根地址 |
| `SPEECH_LLM_MODEL` | `deepseek-chat` | 模型名 |
| `SPEECH_ANSWERS_PATH` | `data/answers.json` | 启动时指定答案库（相对 `python/`） |
| `SPEECH_SEMANTIC` | `0` | 强制关闭语义 |

---

## 9. 故障速查

| 现象 | 处理 |
|------|------|
| Python API: 未连接 | 确认 8765 已起；Vite 代理 `/api` → `127.0.0.1:8765` |
| 语义一直是「—」 | 检查 `online.env` 是否存在、Key 是否正确；重启 API |
| 不识别语音 | 换 Chrome/Edge；检查麦克风权限；须 localhost/HTTPS |
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
