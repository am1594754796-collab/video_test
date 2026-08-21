# 教室抢答模块（视觉 + 语音）

教室场景本地网页：**视觉举手识别** + **语音作答匹配** + **独立计分板展示**（三页解耦）。

| 页面 | 地址 | 需要 | 说明 |
|------|------|------|------|
| 举手单人调试 | http://localhost:5173/ | Node.js | 调 margin / minFrames |
| **人物编号 · 视频回放检测** | http://localhost:5173/people-video.html | Node.js **+ Python** | 本地视频：编号 + 人脸绑座 + 举手 |
| 人物编号原版 | http://localhost:5173/people.html | Node.js **+ Python** | ~10FPS，Python 同步排序 |
| **计分板（仅展示）** | http://localhost:5173/scoreboard.html | 同域其它页即可 | 大号编号；最先举手持续闪烁；答对 +1 停闪 |
| **语音作答 · 在线识别 V2.0（推荐）** | http://localhost:5173/speech-online.html | Node.js **+ Python** · **联网** · Chrome/Edge | 实时听写 + DeepSeek 语义 + 10s 限时；通过/超时即停 |
| 语音作答 · 离线 Whisper | http://localhost:5173/speech.html | Node.js **+ Python** | 按下录音 → 上传 → 本机 Whisper |

视觉 / 语音各自独立运行；计分板通过浏览器跨标签页总线订阅二者事件，**本页不嵌相机、不嵌语音**。

仓库：https://github.com/am1594754796-collab/video_test

**换机配置语音 V2.0：** 见 [`docs/SETUP-speech-v2.md`](docs/SETUP-speech-v2.md)

---

## 三大功能：如何启动与注意事项

三个能力**各自独立网页**，可单独用，也可三开联调计分。首次使用前在仓库根目录执行一次：

```bat
npm.cmd install
cd python
python -m venv .venv
.venv\Scripts\pip.exe install -r requirements.txt
cd ..
```

| 端口 | 服务 |
|------|------|
| `5173` | Vite 前端（所有网页） |
| `8765` | Python API（编号排序 / 语音匹配） |

**不要同时开多个** `start-*.bat`（会抢同一套端口）。已有 Vite + API 在跑时，只需再开对应网页标签即可。

---

### 1. 视频解析（举手 / 编号）· 推荐快版

| 项 | 说明 |
|----|------|
| 启动 | 双击 `start-people-fast.bat` |
| 页面 | http://localhost:5173/people-fast.html |
| 需要 | Node.js + Python；本机相机；Chrome / Edge 优先 |
| 对照页 | `start-people.bat` → `people.html`（每帧排序，更慢） |

**操作：** 点「开始」→ 人数达到设定值并稳定后自动左→右锁定编号并绑人脸 → 举手 / 最先举手 →「下一轮」清赢家；「重新编号」可重排。

离线用本地视频验收同一套能力：`start-people-video.bat` → http://localhost:5173/people-video.html  

**注意：**

- 须用 **`http://localhost:5173`**（非 `file://`），否则无摄像头权限  
- Windows：设置 → 隐私 → 相机 → 允许浏览器使用  
- 页顶须显示 **Python API: 已连接**（排序依赖 `8765`）  
- 默认期望人数可在页内修改（调试常用 2；教室可改 1–6）  
- 短暂丢检会按座位位置尽量找回原号；大挪位请点「重新编号」

---

### 2. 语音作答 · 推荐在线 V2.0

| 项 | 说明 |
|----|------|
| 启动 | 双击 `start-speech-online.bat` |
| 页面 | http://localhost:5173/speech-online.html |
| 需要 | Node.js + Python；**联网**；麦克风；**Chrome / Edge** |
| 对照页 | `start-speech.bat` → `speech.html`（离线 Whisper，无实时听写） |

**操作：** 确认 API 已连接 → 选题 →「扬声器读题」（题干+ABCD）→「开始识别」→ **10 秒内**边说边匹配 → 答对即停 / 超时结束。

**注意：**

- 须先配置 `python/data/online.env`（从 `online.env.example` 复制），填入 DeepSeek Key；改完**重启** uvicorn。详见 [`docs/SETUP-speech-v2.md`](docs/SETUP-speech-v2.md)  
- `online.env` **不要提交 Git**  
- 答案库默认 `python/data/answers.json`（由 `answers.path` 指向）；选择题请写 `prompt` + `options` A–D  
- 匹配 ≥ **90%** 判对（字形 / 拼音 / 语义取最高）；读题**不会**念出 `answer`  
- 非 Chrome/Edge 或无网时，在线听写与语义可能不可用；读题需本机扬声器与中文语音包  

---

### 3. 计分板（仅展示）

| 项 | 说明 |
|----|------|
| 启动 | 双击 `start-scoreboard.bat`（会顺带打开视觉快版 + 语音页） |
| 页面 | http://localhost:5173/scoreboard.html |
| 需要 | 与视觉、语音页**同源同端口**（均为 `localhost:5173`）；本页**不**开相机、**不**开麦克风 |

**联调流程：**

1. 视觉页锁定编号 → 计分板出现大字 `#N`  
2. 最先举手 → 该号**持续闪烁**  
3. 语音页答对 → 该号 **积分 +1** 并**停闪**  
4. 视觉页点「下一轮」→ 再抢下一题  

无相机时可用模拟页验证总线：http://localhost:5173/bus-sim.html（先开计分板，再按 1→2→3 点按钮）。

**注意：**

- 计分板只**订阅**其它页事件（`BroadcastChannel`）；三页必须同一浏览器、同一主机名与端口  
- 只开计分板、不开视觉/语音 → 不会有编号与加分  
- 积分在当前标签页内存中，刷新计分板会清空积分  
- 答对停闪后，须在视觉页「下一轮」才会再次产生「最先举手」信号  

---

### 三页一起用时怎么开

**方式 A（推荐）：** 只跑一次 `start-scoreboard.bat`，它会起 API + Vite，并打开三页。

**方式 B：** 已用 `start-people-fast.bat` 或 `start-speech-online.bat` 起好服务后，在同一浏览器再打开其余地址即可，例如：

- http://localhost:5173/people-fast.html  
- http://localhost:5173/speech-online.html  
- http://localhost:5173/scoreboard.html  

**手动两终端（调试）：**

```bat
cd python
.venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8765
```

```bat
npm.cmd run dev
```

---

## 版本记录 · 语音识别 V2.0（当前）

**当前里程碑：语音识别 V2.0（已满足本轮测试需求）。**

以 **在线识别页**（`speech-online.html` / `start-speech-online.bat`）为准。相对 V1.0 新增：答案库相对路径切换、**DeepSeek 线上整句语义判分**、**10s 答题限时**（通过或超时均结束）。

| 能力 | 状态 |
|------|------|
| 外部已选定当前题（下拉 / `question_id`） | 已满足 |
| 答案库 JSON **相对路径**指向（`data/answers.json` 等） | 已满足 |
| **按下开始识别** 后 **实时转写**（Web Speech，`zh-CN`） | 已满足 |
| **边说边匹配**（字形 + 拼音 + 语义，总分 ≥ **90%**） | 已满足 |
| **同音容错**（拼音 TONE3） | 已满足 |
| **整句语义 · 线上**（DeepSeek `deepseek-chat`，OpenAI 兼容接口） | 已满足 |
| **限时 10s**：通过即停；超时自动结束并做最终匹配 | 已满足 |
| 判定通过后停止转写，后续语音不再识别 | 已满足 |

配套文件：

| 项 | 路径 |
|----|------|
| **移植配置手册（换机必看）** | **`docs/SETUP-speech-v2.md`** |
| 正式答案库 | `python/data/answers.json` |
| 当前指向 | `python/data/answers.path`（相对 `python/`） |
| 线上语义配置（含 Key，**不进 Git**） | `python/data/online.env` |
| 配置模板 | `python/data/online.env.example` |
| 说明 | `python/data/README.md` · 规格 `docs/SPEC-speech-answer.md` |

详细逐步配置（依赖 / 答案库 / DeepSeek / 启动验收）见：**[docs/SETUP-speech-v2.md](docs/SETUP-speech-v2.md)**。

### 如何配置到当前 V2.0 效果（摘要）

按顺序做即可在本机复现当前测试效果。

#### 1. 依赖与启动

```bat
npm.cmd install
cd python
python -m venv .venv
.venv\Scripts\pip.exe install -r requirements.txt
cd ..
start-speech-online.bat
```

或手动：终端 1 在 `python/` 启动 `uvicorn server:app --host 127.0.0.1 --port 8765`；终端 2 `npm run dev`；浏览器打开  
http://localhost:5173/speech-online.html  

需：**联网**、**Chrome / Edge**、麦克风权限。

#### 2. 答案库（题目 / 选项 / 标准答案）

编辑 `python/data/answers.json`。选择题推荐带题干与 A–D（供扬声器朗读）：

```json
{
  "id": "Q1",
  "prompt": "中国的首都是哪里？",
  "options": { "A": "上海", "B": "北京", "C": "广州", "D": "深圳" },
  "answer": "北京"
}
```

`answer` 只用于匹配，**不会**被扬声器读出。详见 `python/data/README.md`。

默认指向由 `python/data/answers.path` 决定，内容为相对 **`python/`** 的路径，例如：

```
data/answers.json
```

网页上方也可改相对路径后点「加载答案库」。

#### 3. DeepSeek 线上语义（整句解释）

```bat
copy python\data\online.env.example python\data\online.env
```

编辑 `python\data\online.env`（此文件已 gitignore，勿提交）：

```
SPEECH_SEMANTIC_MODE=online
SPEECH_LLM_API_KEY=你的DeepSeek密钥
SPEECH_LLM_BASE_URL=https://api.deepseek.com
SPEECH_LLM_MODEL=deepseek-chat
```

保存后 **重启** uvicorn。匹配分会显示「字形 · 拼音 · 语义」；总分 = 三者最大，≥90% 判对。

#### 4. 网页操作（与当前测试一致）

1. 确认页顶 Python API 已连接  
2. 选题（整句测 **Q3**）  
3. 点 **扬声器读题** → 朗读题干与 A/B/C/D（不含标准答案）  
4. **按下开始识别** → 开始 10s 倒计时与实时转写/匹配  
5. **答对** → 立即停止；**超时** → 自动结束并出最终结果  

#### 5. 可选开关

| 变量 | 作用 |
|------|------|
| `SPEECH_SEMANTIC_MODE=off` | 关闭语义，仅字形/拼音 |
| `SPEECH_SEMANTIC_MODE=offline` | 改用本地 BGE（需另下模型） |
| `SPEECH_ANSWERS_PATH=data/xxx.json` | 启动时指定答案库相对路径 |

**V2.0 基线不要改坏在线页主路径**（实时听写 + 线上语义 + 10s 限时）。

---

## 版本记录 · 语音作答 · 在线识别 V1.0（历史）

V1.0 基线：实时听写 + ≥90% 字形/拼音匹配 + 通过即停。整句线上语义与 10s 限时见上方 **V2.0**。

---

## 版本记录 · 视频解析 V1.0

**当前里程碑：视频解析 V1.0（已满足需求）。**

以 **人物编号快版**（`people-fast.html` / `start-people-fast.bat`）为准，能力已齐：

| 能力 | 状态 |
|------|------|
| 出镜人数达标后 Python **左→右编号一次并锁定** | 已满足 |
| 锁定后只做 **举手检测** + **谁先举手** 反馈 | 已满足 |
| 短暂丢检后按座位位置 **找回原编号**（减少 `#?`） | 已满足 |
| 需要人数可调（默认 2，教室可改 1–6） | 已满足 |

后续若做 V1.1+，在本记录下追加条目；**V1.0 基线不要改坏快版主路径。**

---

## 换机部署完整流程（推荐照此做）

在新电脑上按顺序执行。

### 0. 拿到代码

```bat
git clone https://github.com/am1594754796-collab/video_test.git
cd video_test
```

或解压项目 zip 后进入项目根目录（**不要**拷贝旧电脑的 `node_modules`、`python\.venv`）。

### 1. 安装 Node.js（必做）

```powershell
winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
```

装完后 **关闭并重新打开** 终端：

```powershell
node -v
npm.cmd -v
```

也可用官网 LTS：https://nodejs.org/

### 2. 安装 Python 3.12（人物数量页必做）

```powershell
winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements
```

重开终端后验证（若提示找不到，勾选安装器里的 **Add python.exe to PATH** 再装一次）：

```powershell
python --version
pip --version
```

建议版本：**Python 3.10+**（本机验证过 3.12）。

### 3. 安装前端依赖

在项目根目录：

```bat
npm.cmd install
```

### 4. 安装 Python 环境（虚拟环境，推荐）

在项目根目录执行（路径按你的实际目录）：

```bat
cd python
python -m venv .venv
.venv\Scripts\python.exe -m pip install --upgrade pip
.venv\Scripts\pip.exe install -r requirements.txt
.venv\Scripts\pip.exe install pytest
```

验证排序 API 依赖与单测：

```bat
cd python
.venv\Scripts\python.exe -m pytest tests -q
```

应看到类似：`3 passed`。

> **说明：** `.venv` 不要提交到 Git，也不要在电脑之间复制；每台机器各自 `python -m venv .venv` 再 `pip install`。

### 5. 启动

**只测举手（单人）：**

```bat
start.bat
```

或：

```bat
npm.cmd run dev
```

浏览器打开 http://localhost:5173/

**人物编号快版（推荐：达标锁定编号 → 举手竞态）：**

```bat
start-people-fast.bat
```

该脚本会：

1. 检查 Node / Python  
2. 必要时 `npm install`  
3. 必要时创建 `python\.venv` 并安装 `requirements.txt`  
4. 启动 `uvicorn`（`http://127.0.0.1:8765`）  
5. 启动 Vite，并打开 http://localhost:5173/people-fast.html  

**人物编号原版（约 10FPS，每帧等 Python）：**

```bat
start-people.bat
```

打开 http://localhost:5173/people.html  

**计分板（仅展示 · 需与视觉/语音同开三标签）：**

```bat
start-scoreboard.bat
```

打开 http://localhost:5173/scoreboard.html（脚本也会顺带打开视觉快版与语音页）。

流程：视觉页锁定编号 → 计分板大字显示各号 → 最先举手后该号**持续闪烁** → 语音页答对 → 该号 **+1 并停闪** → 视觉页点「下一轮」后再赛。三页须同源（均为 `localhost:5173`）。

**语音作答 · 在线识别 V2.0（推荐：实时听写 + DeepSeek 语义 + 10s 限时）：**

```bat
start-speech-online.bat
```

该脚本会启动 Python API + Vite，并打开 http://localhost:5173/speech-online.html  

要求：**联网**、**Chrome / Edge**；先配置 `python\data\online.env`（见上方 V2.0）。  
操作：选题 → 按下开始识别 → **10s 内**边说边匹配 → **通过或超时均自动结束**。

**语音作答 · 离线 Whisper（对照）：**

```bat
start-speech.bat
```

打开 http://localhost:5173/speech.html（按下录音 → 结束上传识别；首次会下载 Whisper 模型）。

#### 手动分两步启动（调试用）

终端 1 — Python API：

```bat
cd python
.venv\Scripts\uvicorn.exe server:app --host 127.0.0.1 --port 8765
```

终端 2 — 前端：

```bat
npm.cmd run dev
```

浏览器打开 http://localhost:5173/people-fast.html（推荐）或 `/people.html`（原版）或 `/speech-online.html`（语音在线 V1.0）  
页顶应显示 **Python API: 已连接**。

### 6. 相机权限

- 必须用 **http://localhost:5173**（或 HTTPS），否则浏览器不给摄像头  
- Windows：设置 → 隐私 → 相机 → 允许桌面应用 / 浏览器使用相机  

---

## 一键启动速查

> 三大功能的启动步骤与注意事项见上方 **[三大功能：如何启动与注意事项](#三大功能如何启动与注意事项)**。

| 脚本 | 作用 |
|------|------|
| `start.bat` / `start.ps1` | 举手单人调试 |
| `start-people-fast.bat` | **① 视频解析**（人物快版 V1.0 · 相机） |
| `start-people-video.bat` | **①′ 视频文件回放检测**（同逻辑，本地视频） |
| `start-people.bat` | 人物原版（~10FPS 同步排序） |
| `start-speech-online.bat` | **② 语音作答**（在线 V2.0） |
| `start-speech.bat` | 语音离线 Whisper |
| `start-scoreboard.bat` | **③ 计分板** + 顺带打开视觉/语音三标签 |

### PowerShell 报错「禁止运行脚本」

```powershell
npm.cmd run dev
```

或：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

`start.bat` 已使用 `npm.cmd`，一般可避开该问题。

---

## Python 环境说明（务必读）

| 项 | 内容 |
|----|------|
| 目录 | `python/` |
| 虚拟环境 | `python/.venv/`（本地生成，不入库） |
| 依赖清单 | `python/requirements.txt` |
| 排序核心 | `python/sort_people.py`（按躯干 x 左→右编号 1…N） |
| HTTP 服务 | `python/server.py`（FastAPI） |
| 健康检查 | `GET http://127.0.0.1:8765/api/health` |
| 排序接口 | `POST http://127.0.0.1:8765/api/people/sort` |
| 默认端口 | **8765** |
| 前端代理 | Vite 把 `/api/*` 转到 `127.0.0.1:8765`（见 `vite.config.ts`） |

`requirements.txt` 当前内容：

```
fastapi>=0.115.0
uvicorn[standard]>=0.32.0
pydantic>=2.0.0
```

人物页流程：

**快版（推荐）**

1. ~20FPS 检测出镜人数  
2. 当人数 **等于「需要人数」**（默认 2）并连续稳定若干帧 → **调用 Python 排序一次**，把左→右编号锁定到每人的 track  
3. 之后 **不再排序**，只做举手判定 + 最先举手反馈  
4. 「下一轮」只清空赢家；「重新编号」解除锁定，重新等人齐再排  

**原版**

1. 每帧检测并 **同步** 请求 Python 排序  
2. 同时做举手 / 最先举手（适合对照）  

### 快版 vs 原版

| 项 | `people-fast.html`（推荐） | `people.html`（原版） |
|----|---------------------------|----------------------|
| 相机 / 推理 | **≈20FPS** | ≈10FPS |
| Python 排序 | **人数达标后只排一次并锁定** | 每帧都排 |
| 锁定后 | 只跑举手 + 最先举手 | 持续重编号 |
| 需要人数 | 页上可调 1–6（默认 **2**） | 无 |
| 启动脚本 | `start-people-fast.bat` | `start-people.bat` |

---

## 常用前端命令

```bat
npm.cmd install
npm.cmd run dev
npm.cmd test
npm.cmd run build
npm.cmd run preview
npm.cmd run lint
```

| 命令 | 作用 |
|------|------|
| `npm.cmd run dev` | 开发预览（`/`、`/people-fast.html`、`/people.html`） |
| `npm.cmd test` | Vitest 前端单测 |
| `npm.cmd run build` | 产出 `dist/`（含三页） |

---

## 使用说明

### 举手单人调试（`/`）

1. 点 **打开相机**  
2. 上半身入画  
3. 举手 / 放下；可调 `margin`、`minFrames`  

| 参数 | 默认 | 说明 |
|------|------|------|
| `margin` | `0.05` | 腕相对肘的高度边距（越大越不易误报；不必过肩） |
| `minFrames` | `5` | 连续帧一致才翻转举手状态 |

### 人物编号快版（推荐 · `/people-fast.html`）· **视频解析 V1.0**

> **V1.0 已定稿：** 本页已满足「人数锁定编号 → 举手 → 最先举手」需求，作为视频解析模块正式基线。

流程：**等人齐 → Python 排一次号并锁定 → 只处理举手 / 谁先举手**。

1. 运行 `start-people-fast.bat`（或手动开 Python API + `npm.cmd run dev`）  
2. 打开 http://localhost:5173/people-fast.html  
3. 确认 **需要人数**（当前默认 **2**，可 1–6）  
4. 点 **打开相机**；人站好、上半身入画  
5. 人数达到设定值并稳定约 8 帧后，自动 Python 左→右编号并锁定  
6. 举手；**最先举手**闪烁；**下一轮**再赛；换人或重排点 **重新编号**  

#### 如何修改「需要人数」

| 改法 | 位置 | 说明 |
|------|------|------|
| **页面上改（推荐）** | 快版页控件「需要人数」 | 打开相机前 / 点「重新编号」前改即可，范围 1–6 |
| **改页面默认值** | `people-fast.html` → `#input-expected` 的 `value="2"` | 下次打开页面的默认人数 |
| **改代码回退默认** | `src/app/people-board-fast.ts` → `readExpectedCount()` 里的 `return 2` | 输入框无效时的回退值 |

教室若固定 6 人：把上表两处默认改成 `6`，或打开页面后把「需要人数」调到 6。

要点：

- 锁定前不做举手竞态，避免号还在变就判定  
- 锁定后编号跟人脸会话模板 + 座位位置：短暂丢检再出现优先按**人脸**找回原号，位置作兜底  
- 追踪放宽：更大匹配半径、约 3 秒丢检容忍  
- 锁定后编号跟 track，不再每帧打排序 API  
- API 失败时用本地左→右规则完成这一次锁定  
- 两人请尽量左右分开站；若对调座位后号乱了，点「重新编号」  

#### 编号变 `?` / 动一下就丢人时

常见原因：只按临时 `trackId` 记人，丢检后 ID 变了。快版已用「锁定座位 + 位置重绑」缓解。仍不稳时可：

1. 站稳后再等锁定；锁定后小范围活动通常可保持原号  
2. 不要长时间离开原站位（超过重绑距离约画面宽度的 35% 会认不回）  
3. 光照均匀、上半身入画  
4. 换人或大范围挪位后点 **重新编号**  

### 人物编号原版（`/people.html`）

每帧都请求 Python 排序（约 10FPS），适合对照。页内可跳转快版。

---

## 目录结构

```
video_test/
  start.bat / start.ps1      ← 举手单人一键启动
  start-people-fast.bat      ← 人物快版 + Python（推荐）
  start-people.bat           ← 人物原版 + Python
  index.html                 ← 举手单人调试
  people-fast.html           ← 人物编号快版（~20FPS）
  people.html                ← 人物编号原版（~10FPS）
  package.json
  vite.config.ts             ← 含 /api 代理到 :8765
  src/vision/                ← MediaPipe / 举手 / 去重 / 追踪 / 最先举手
  src/app/
    people-board-fast.ts     ← 快版逻辑
    people-board.ts          ← 原版逻辑
    people-board.css
  python/
    requirements.txt
    sort_people.py
    server.py
    tests/
  tests/vision/
  SPEC.md / docs/ / tasks/
```

---

## 本次变更记录（便于对照部署）

### 视频解析 V1.0（定稿）

- **结论：** 人物编号快版已满足当前需求，标记为 **视频解析 V1.0**。  
- **入口：** `people-fast.html` / `start-people-fast.bat`  
- **范围：** 人数达标锁定编号、**人脸绑定座位号**、举手判定、最先举手反馈；不含计分 / 抢答流程 / 姓名底库。  

以下为 V1.0 及此前已落地、换机部署时需要知道的内容：

1. **举手检测（MediaPipe Pose）**  
   - 浏览器 `@mediapipe/tasks-vision`  
   - 单人调试默认 `numPoses=1`，减轻一人双框 / 频闪  
   - 举手规则：腕高于肘 + 连续帧防抖（不必过肩）  

2. **人物数量 + 左→右编号 + 最先举手**  
   - 原版：`people.html` + `src/app/people-board.ts`（约 10FPS，同步等 Python）  
   - **快版：`people-fast.html`：人数达标 → Python 排序一次锁定 → 举手/最先举手**  
   - `FirstRaiseTracker` + `countLock`：锁定门闩与竞态  

3. **Python 排序服务**  
   - 虚拟环境 `.venv` + `requirements.txt`  
   - FastAPI + Uvicorn，端口 **8765**  
   - 单测：`python/tests/test_sort_people.py`  

4. **启动脚本**  
   - `start.bat`：仅前端举手页  
   - `start-people-fast.bat`：快版 + Python（推荐）  
   - `start-people.bat`：原版 + Python  

5. **仓库**  
   - 已推送：https://github.com/am1594754796-collab/video_test  
   - 忽略：`node_modules/`、`python/.venv/`、`dist/`、`*.zip`  

6. **Windows 注意点**  
   - PowerShell 下用 `npm.cmd`，避免 `npm.ps1` 执行策略错误  
   - 新电脑必须重装 Node / Python，并本地执行 `npm install` 与 `python -m venv`  

---

## 常见问题

**Q: `npm : 无法加载 … npm.ps1`**  
A: 用 `npm.cmd` 或 `start.bat`。

**Q: 人物页显示 Python API 未连接**  
A: 先开 `python` 下的 uvicorn，或重新运行 `start-people-fast.bat`；确认 8765 端口未被占用。未连接时该帧会回退本地编号。

**Q: `python` 命令不存在**  
A: 用 winget 重装 Python 3.12，并勾选加入 PATH；或试用 `py -3 --version`。

**Q: 打不开相机**  
A: 使用 localhost；检查系统相机权限。

**Q: 频闪 / 一人变两人 / 人突然消失**  
A: 优先用 **快版** `people-fast.html`（更高采样）；保证上半身入画、光照均匀。举手页用单人模式；人物页已做躯干去重。

**Q: 快版和原版选哪个？**  
A: 实机推荐快版（~20FPS + 同步 Python）。原版为 ~10FPS 对照。

**Q: 换电脑缺依赖**  
A: 不要复制 `node_modules` / `.venv`；按本文「换机部署完整流程」从第 1 步做起。

---

## 文档索引

- **需求汇总：** [`docs/需求/README.md`](docs/需求/README.md)  
- 规格：`SPEC.md`  
- 意图：`docs/intent/hand-raise-vision.md`  
- 任务：`tasks/todo.md`  
- 日志：`docs/worklog/`
