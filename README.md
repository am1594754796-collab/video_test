# 举手行为检测（视觉识别模块）

教室场景视觉模块：**MediaPipe Pose** + 举手判定 + 人物数量 / 左→右编号 + 最先举手。

| 页面 | 地址 | 需要 | 说明 |
|------|------|------|------|
| 举手单人调试 | http://localhost:5173/ | Node.js | 调 margin / minFrames |
| **人物编号快版（推荐）** | http://localhost:5173/people-fast.html | Node.js **+ Python** | ~20FPS 相机，**Python 同步排序** |
| 人物编号原版 | http://localhost:5173/people.html | Node.js **+ Python** | ~10FPS，Python 同步排序 |

不含计分 / 抢答流程（解耦在其他模块）。

仓库：https://github.com/am1594754796-collab/video_test

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

**人物编号快版（推荐，~20FPS 相机 + Python 同步排序）：**

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

浏览器打开 http://localhost:5173/people-fast.html（推荐）或 `/people.html`（原版）  
页顶应显示 **Python API: 已连接**。

### 6. 相机权限

- 必须用 **http://localhost:5173**（或 HTTPS），否则浏览器不给摄像头  
- Windows：设置 → 隐私 → 相机 → 允许桌面应用 / 浏览器使用相机  

---

## 一键启动速查

| 脚本 | 作用 |
|------|------|
| `start.bat` / `start.ps1` | 举手单人调试 |
| `start-people-fast.bat` | **推荐** 人物快版 + Python（~20FPS 同步排序） |
| `start-people.bat` | 人物原版 + Python（~10FPS 同步排序） |

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

1. 浏览器按目标帧率采样相机，MediaPipe 检出人物（最多 6，含去重）  
2. 把本帧每人中心坐标 `{x,y}` **同步** POST 给 Python，等待左→右编号结果  
3. 页面显示「当前人数」、编号、举手 / 最先举手；API 断开时暂用本地排序  
4. 若上一帧排序尚未返回，跳过中间 rAF（避免重叠请求）  

### 快版 vs 原版

| 项 | `people-fast.html`（推荐） | `people.html`（原版） |
|----|---------------------------|----------------------|
| 相机 / 推理目标间隔 | **50ms ≈ 20FPS** | 100ms ≈ 10FPS |
| 排序请求 | **同步** `await` Python（与原版相同） | 同步 `await` Python |
| 漏检容忍 | `maxMissed=24`（约 1.2s） | `maxMissed=12`（约 1.2s） |
| 举手防抖 | 连续 5 帧 | 连续 4 帧 |
| 检测置信度 | 略松（0.50 / 0.50 / 0.45） | 0.55 / 0.55 / 0.50 |
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
| `margin` | `0.08` | 腕相对肩的高度边距（越大越不易误报） |
| `minFrames` | `5` | 连续帧一致才翻转举手状态 |

### 人物编号快版（推荐 · `/people-fast.html`）

适合教室实机：更高采样率（约 20FPS），编号仍走 Python **同步**接口。

1. 运行 `start-people-fast.bat`（或手动开 Python API + `npm.cmd run dev`）  
2. 打开 http://localhost:5173/people-fast.html  
3. 点 **打开相机**；上半身入画、光线尽量均匀  
4. 看「当前人数」、左→右编号；举手后防抖确认，**最先举手**会闪烁  
5. 点 **下一轮** 清空赢家再赛  

要点：

- 相机 / Pose 目标约 **20FPS**（间隔 50ms）  
- 每一有效帧都会 **等待** Python `/api/people/sort` 返回后再刷新编号与竞态  
- API 未连接或失败时，该帧回退本地左→右排序  

### 人物编号原版（`/people.html`）

对照用，约 **10FPS**，同样是 Python 同步排序。

1. `start-people.bat` 或手动启动 API  
2. 打开 http://localhost:5173/people.html  
3. 操作同快版（打开相机 → 举手 → 下一轮）  

页内可点「改用快版」跳转。

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

以下为本阶段已落地、换机部署时需要知道的内容：

1. **举手检测（MediaPipe Pose）**  
   - 浏览器 `@mediapipe/tasks-vision`  
   - 单人调试默认 `numPoses=1`，减轻一人双框 / 频闪  
   - 举手规则：腕高于肩 + 连续帧防抖  

2. **人物数量 + 左→右编号 + 最先举手**  
   - 原版：`people.html` + `src/app/people-board.ts`（约 10FPS，同步等 Python）  
   - **快版：`people-fast.html` + `src/app/people-board-fast.ts`（约 20FPS 相机，Python 同步排序）**  
   - `FirstRaiseTracker`：最先举手 +「下一轮」重置  

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

- 规格：`SPEC.md`  
- 意图：`docs/intent/hand-raise-vision.md`  
- 任务：`tasks/todo.md`  
- 日志：`docs/worklog/`
