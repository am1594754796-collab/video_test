# 教室抢答模块（视觉 + 语音）

教室场景本地网页：**视觉举手识别** + **语音作答匹配** + **独立计分板**。各页面解耦，**各自单独启动**（一个启动脚本只打开对应页面）。

| 页面 | 地址 | 启动 | 需要 |
|------|------|------|------|
| 举手单人调试 | http://localhost:5173/ | `start.bat` | Node.js |
| **人物编号 · 视频回放检测** | http://localhost:5173/people-video.html | `start-people-video.bat` / `.sh` | **仅 Node.js** |
| **人物编号 · 相机快版** | http://localhost:5173/people-fast.html | `start-people-fast.bat` | **仅 Node.js** + 相机 |
| **计分板（仅展示）** | http://localhost:5173/scoreboard.html | `start-scoreboard.bat` | 同域其它页即可 |
| **语音作答 · 在线识别** | http://localhost:5173/speech-online.html | `start-speech-online.bat` | Node.js **+ Python** · 联网 · Chrome/Edge |

视觉 / 语音各自独立；计分板通过浏览器跨标签页总线订阅事件，**本页不嵌相机、不嵌语音**。

仓库：https://github.com/am1594754796-collab/video_test

**换机 / 移植：** [`deploy/README.md`](deploy/README.md)  
**API 可插拔：** [`docs/API-PROVIDERS.md`](docs/API-PROVIDERS.md)  
**语音细则：** [`docs/SETUP-speech-v2.md`](docs/SETUP-speech-v2.md)

---

## 端口与单独启动约定

| 端口 | 服务 |
|------|------|
| `5173` | Vite 前端（所有网页共用） |
| `8765` | Python API（**仅语音作答**需要） |

- **不要同时开多个** `start-*.bat` / `.sh`（会抢 `5173`）。
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

```bash
npm install

mkdir -p public/mediapipe
# Linux / macOS：
ln -sfn ../../node_modules/@mediapipe/tasks-vision/wasm public/mediapipe/wasm

mkdir -p public/mediapipe/models
curl -L -o public/mediapipe/models/pose_landmarker_full.task \
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task"
```

模型说明见 [`public/mediapipe/README.md`](public/mediapipe/README.md)。

### 启动

```bash
npm run dev
# 或双击对应 start-people-*.bat / ./start-people-video.sh
```

| 用途 | 地址 |
|------|------|
| 本地视频检测 | http://localhost:5173/people-video.html |
| 实时相机检测 | http://localhost:5173/people-fast.html |

**视频页：** 等「模型已就绪」→ 选视频 → **开始检测** → 设「需要人数」→ 锁定编号后举手。  
**相机页：** **打开相机** → 设人数 → 人齐锁定 → 举手 / **下一轮** / **重新编号**。

---

## 语音作答 · 在线识别

| 项 | 说明 |
|----|------|
| 启动 | `start-speech-online.bat`（会起 Python API + Vite，只开语音页） |
| 页面 | http://localhost:5173/speech-online.html |
| 需要 | Node + Python；联网；麦克风；Chrome / Edge |

**操作：** API 已连接 → 选题 →「扬声器读题」→「开始识别」→ **10 秒内**边说边匹配 → 答对即停 / 超时结束。

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

答案库默认 `python/data/answers.json`（由 `answers.path` 指向）。匹配 ≥ **90%** 判对。

---

## 计分板

| 项 | 说明 |
|----|------|
| 启动 | `start-scoreboard.bat`（**只开计分板**） |
| 页面 | http://localhost:5173/scoreboard.html |

联调：另开视觉页 + 语音页（同源同端口）→ 锁定编号 → 最先举手闪烁 → 语音答对 +1 停闪 → 视觉页「下一轮」。

---

## 一键启动速查

| 脚本 | 打开页面 |
|------|----------|
| `start.bat` / `start.ps1` | 举手单人调试 `/` |
| `start-people-fast.bat` | 相机多人检测 |
| `start-people-video.bat` / `.sh` | 视频回放检测 |
| `start-scoreboard.bat` | 计分板 |
| `start-speech-online.bat` | 语音在线（含 Python API） |
| `start-python-api.bat` | 仅 Python API（8765） |

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
  speech-online.html         ← 语音在线
  start-*.bat / .sh
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
