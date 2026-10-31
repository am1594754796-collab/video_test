# 教室抢答模块（视觉 + 语音）

教室场景本地网页：**视觉举手识别** + **CosyVoice 读题** + **A–D 语音作答** + **独立计分板**。完整抢答流程由 `start-classroom.bat` 启动，在一个页面中运行；视觉和计分板调试页仍可单独打开。

| 页面 | 地址 | 启动 | 需要 |
|------|------|------|------|
| 举手单人调试 | http://localhost:5173/ | `start.bat` | Node.js |
| **人物编号 · 视频回放检测** | http://localhost:5173/people-video.html | `start-people-video.bat` | **仅 Node.js** |
| **人物编号 · 相机快版** | http://localhost:5173/people-fast.html | `start-people-fast.bat` | **仅 Node.js** + 相机 |
| **计分板（仅展示）** | http://localhost:5173/scoreboard.html | `start-scoreboard.bat` | 同域其它页即可 |
| **正式题目展示：视觉 + 读题 + 语音作答** | http://localhost:5173/classroom.html | `start-classroom.bat` | Node.js **+ Python** · 摄像头、麦克风、联网 |
| **带实时画面的测试页** | http://localhost:5173/speech-online.html | 手动打开 | 同上 |

完整抢答页内置视觉检测；独立计分板通过浏览器跨标签页总线订阅事件。

仓库：https://github.com/am1594754796-collab/video_test

**换机 / 移植：** [`deploy/README.md`](deploy/README.md)  
**API 可插拔：** [`docs/API-PROVIDERS.md`](docs/API-PROVIDERS.md)  
**语音细则：** [`docs/SETUP-speech-v2.md`](docs/SETUP-speech-v2.md)

---

## 端口与单独启动约定

| 端口 | 服务 |
|------|------|
| `5173` | Vite 前端（所有网页共用） |
| `8765` | Python API（**读题**需要） |

- **不要同时开多个** `start-*.bat`（会抢 `5173`）。
- 已有 Vite 在跑时：只需在浏览器**另开标签**访问其它页面地址。
- 每个启动脚本**只打开自己的页面**；联调时自行打开其余标签。

---

## 最小配置 · 视频 / 相机检测

`people-video.html` 与 `people-fast.html` 共用：

`MediaPipe 多人 Pose 左→右编号 → 近距切开局部放大 → 严格举手（首帧满足即举手）`

**不依赖** Python API、`api.env`、千问 Key。

### 环境要求

| 项 | 要求 |
|----|------|
| Node.js | **18+** |
| 浏览器 | Chrome / Edge；须用 `http://localhost`，不要用 `file://` |
| 网络 | 安装时拉 npm；首次下载 MediaPipe 模型需访问 Google Storage |
| 视频页 | 本地浏览器可解码的视频（如 `mp4`） |
| 相机页 | 本机摄像头权限 |

### 一次性安装

```bat
npm.cmd install

mkdir public\mediapipe 2>nul
xcopy /E /I /Y node_modules\@mediapipe\tasks-vision\wasm public\mediapipe\wasm

mkdir public\mediapipe\models 2>nul
curl -L -o public\mediapipe\models\pose_landmarker_full.task ^
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"
```

模型说明见 [`public/mediapipe/README.md`](public/mediapipe/README.md)。

### 启动

```bat
npm.cmd run dev
REM 或双击对应 start-people-*.bat / start-people-video.bat
```

| 用途 | 地址 |
|------|------|
| 本地视频检测 | http://localhost:5173/people-video.html |
| 实时相机检测 | http://localhost:5173/people-fast.html |

**视频页：** 等「模型已就绪」→ 选视频 → **开始检测** → 设「需要人数」→ 锁定编号后举手。  
**相机页：** **打开相机** → 设人数 → 人齐锁定 → 举手 / **下一轮** / **重新编号**。

---

## 读题 · CosyVoice

### 完整抢答工作流程

1. 首次准备：安装 Node/Python 依赖与 MediaPipe 模型，并运行 `python -m speech_answer.prebuild_audio` 生成题目和倒计时 MP3。
2. 双击 `start-classroom.bat`。脚本检查 MediaPipe 和预生成音频，等待 Python API（8765）与 Vite（5173）就绪，然后自动打开正式题目展示页 `classroom.html` 和独立计分板页。保持脚本窗口运行；结束时在窗口按 Enter 停止本次启动的服务。浏览器允许摄像头和麦克风。
3. 正式页默认检测 6 人并从左到右编号；排序锁定之前「开始本题」不可点击。若人数需要调整，输入 1–6 后点「重新检测人数并排序」。重新编号会重置本页演示分数。
4. 选择题目，点「开始本题」。系统读题，随后播放举手倒计时；倒计时内提前举手扣 1 分。
5. 倒计时结束后，视觉识别锁定最先举手者。浏览器开始听取 A–D；每个 5 秒窗口以最后一次有效选项为准，未听到就继续听。
6. 系统按标准答案判题并计分（对 +1，错 −1，最低 0），展示判题结果和分数 5 秒后自动朗读下一题，之后重复倒计时、抢答和听答流程。只有第一题需要点「开始本题」。末题展示 5 秒后结束；可手动选题重新开始。

「停止本轮」可中止播放、倒计时或听答；独立计分板 `scoreboard.html` 会由脚本自动打开。计分板固定显示 1–6 号，打开时同步已有分数，判题后实时更新。

| 项 | 说明 |
|----|------|
| 启动 | `start-speech-online.bat`（会起 Python API + Vite，只开读题页） |
| 页面 | http://localhost:5173/speech-online.html |
| 需要 | Node + Python；联网；Chrome / Edge |

**操作：** 先预生成语音 → 运行 `start-classroom.bat` → 允许摄像头和麦克风 → 设参与人数并等待编号锁定 → 选题并点「开始本题」。系统播放题目 MP3、播举手倒计时，检测最先举手者，自动听 A–D 选项（每 5 秒一轮，取最后一次），按对错 ±1 分并自动进入下一题。末题结束后停下。

**预生成语音**（改题后重跑）：

```bat
cd python
.venv\Scripts\python.exe -m speech_answer.prebuild_audio
```

MP3 写在 `python/data/audio/`（见该目录 README）。

**配置：**

```bat
npm.cmd install
cd python
python -m venv .venv
.venv\Scripts\pip.exe install -r requirements.txt
cd ..
copy deploy\api.env.example python\data\api.env
```

编辑 `python\data\api.env`，只填 `LLM_API_KEY=...`，改完**重启** uvicorn。详见 [`deploy/README.md`](deploy/README.md)。

题库默认 `python/data/answers.json`（由 `answers.path` 指向），读题使用其中的 `prompt` / `options`。

---

## 计分板

| 项 | 说明 |
|----|------|
| 启动 | `start-scoreboard.bat`（**只开计分板**） |
| 页面 | http://localhost:5173/scoreboard.html |

联调：另开视觉页（同源同端口）→ 锁定编号 → 最先举手闪烁 → 视觉页「下一轮」。读题页不参与计分。

---

## 扫码打分（独立）

与上面的计分板无关。本机 Flask 服务，手机扫六个二维码，分数记到你指定的编号。

| 项 | 说明 |
|----|------|
| 启动 | `start-score-qr.bat` |
| 管理页 | http://127.0.0.1:8000 （改编号、看二维码、看总分和平均分） |
| 按编号调用 | `GET http://127.0.0.1:8000/api/summary/编号` → `count`、`total`、`average` |
| 数据 | `python/score_qr/data/scores.db`（不进 Git） |

手机和电脑需在同一 Wi-Fi。首次运行若系统询问防火墙，选择允许访问。

---

## 一键启动速查

| 脚本 | 打开页面 |
|------|----------|
| `start.bat` / `start.ps1` | 举手单人调试 `/` |
| `start-people-fast.bat` | 相机多人检测 |
| `start-people-video.bat` | 视频回放检测 |
| `start-scoreboard.bat` | 计分板 |
| `start-classroom.bat` | 完整抢答：视觉 + 读题 + 语音作答（含 Python API） |
| `start-speech-online.bat` | 同上，旧入口保留 |
| `start-python-api.bat` | 仅 Python API（8765） |
| `start-score-qr.bat` | 扫码打分（8000，独立） |

已有服务在跑时，浏览器直接打开上表地址即可，无需再跑第二个 `start-*`。

---

## 常用命令

```bat
npm.cmd install
npm.cmd run dev
npm.cmd test
npm.cmd run build
```

Python 测试（在 `python/` 且已激活 `.venv`）：

```bat
python -m pytest tests -q
```

---

## 目录结构（当前保留）

```
video_test/
  index.html                 ← 单人举手调试
  people-fast.html           ← 多人相机
  people-video.html          ← 视频回放
  scoreboard.html            ← 计分板
  classroom.html             ← 正式题目展示（隐藏实时画面）
  speech-online.html         ← 带画面的测试页
  start-*.bat / start.ps1
  public/mediapipe/          ← WASM + Pose 模型
  src/vision/                ← MediaPipe / 编号 / 举手
  src/app/                   ← 各页入口脚本
  python/                    ← 语音匹配 API（8765）
  deploy/                    ← 换机配置
  docs/ / tests/
```

---

## 常见问题

**Q: 同时开了多个 start，端口冲突**  
A: 只保留一个 Vite；其余页面用浏览器标签打开。

**Q: 语音页显示 API 未连接**  
A: 用 `start-speech-online.bat`，或先跑 `start-python-api.bat` 再 `npm run dev`。

**Q: 打不开相机**  
A: 使用 `http://localhost:5173`；检查系统相机权限。

**Q: 换电脑缺依赖**  
A: 不要复制 `node_modules` / `.venv`；按 [`deploy/README.md`](deploy/README.md) 重装。

---

## 文档索引

- 需求汇总：[`docs/需求/README.md`](docs/需求/README.md)
- 换机：[`deploy/README.md`](deploy/README.md)
- 语音配置：[`docs/SETUP-speech-v2.md`](docs/SETUP-speech-v2.md)
- 规格：`SPEC.md` · 任务：`tasks/` · 日志：`docs/worklog/`
