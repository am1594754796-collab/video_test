# 举手行为检测（视觉识别模块）

教室场景视觉模块：**MediaPipe Pose** + 举手判定 + 人物数量 / 左→右编号。

| 页面 | 地址 | 需要 |
|------|------|------|
| 举手单人调试 | http://localhost:5173/ | Node.js |
| 人物数量 + 左→右编号 | http://localhost:5173/people.html | Node.js **+ Python** |

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

**人物数量 + Python 左→右排序：**

```bat
start-people.bat
```

该脚本会：

1. 检查 Node / Python  
2. 必要时 `npm install`  
3. 必要时创建 `python\.venv` 并安装 `requirements.txt`  
4. 启动 `uvicorn`（`http://127.0.0.1:8765`）  
5. 启动 Vite，并打开 http://localhost:5173/people.html  

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

浏览器打开 http://localhost:5173/people.html  
页顶应显示 **Python API: 已连接**。

### 6. 相机权限

- 必须用 **http://localhost:5173**（或 HTTPS），否则浏览器不给摄像头  
- Windows：设置 → 隐私 → 相机 → 允许桌面应用 / 浏览器使用相机  

---

## 一键启动速查

| 脚本 | 作用 |
|------|------|
| `start.bat` / `start.ps1` | 举手单人调试 |
| `start-people.bat` | 人物数量页 + Python 排序服务 |

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

1. 浏览器 MediaPipe 检出人物（最多 6，含去重）  
2. 把每人中心坐标 `{x,y}` POST 给 Python  
3. Python 左→右排序并返回 `count` + `people[].index`  
4. 页面显示「当前人数」与编号；API 断开时会暂用本地排序并提示未连接  

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
| `npm.cmd run dev` | 开发预览（含 `/` 与 `/people.html`） |
| `npm.cmd test` | Vitest 前端单测 |
| `npm.cmd run build` | 产出 `dist/`（含两页） |

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

### 人物数量页（`/people.html`）

1. 先保证 Python API 已启动（或用 `start-people.bat`）  
2. 点 **打开相机**  
3. 看「当前人数」与从左到右编号 1…N  

---

## 目录结构

```
video_test/
  start.bat / start.ps1     ← 举手单人一键启动
  start-people.bat          ← 人物页 + Python API
  index.html                ← 举手单人调试
  people.html               ← 人物数量独立页
  package.json
  vite.config.ts            ← 含 /api 代理到 :8765
  src/vision/               ← MediaPipe / 举手 / 去重 / 追踪
  src/app/                  ← 两个前端页面逻辑
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

2. **人物数量 + 左→右编号（新独立页）**  
   - `people.html` + `src/app/people-board.ts`  
   - 检测人数；编号排序由 **Python** 完成  

3. **Python 排序服务**  
   - 虚拟环境 `.venv` + `requirements.txt`  
   - FastAPI + Uvicorn，端口 **8765**  
   - 单测：`python/tests/test_sort_people.py`  

4. **启动脚本**  
   - `start.bat`：仅前端举手页  
   - `start-people.bat`：前端 + 自动准备/启动 Python  

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
A: 先开 `python` 下的 uvicorn，或重新运行 `start-people.bat`；确认 8765 端口未被占用。

**Q: `python` 命令不存在**  
A: 用 winget 重装 Python 3.12，并勾选加入 PATH；或试用 `py -3 --version`。

**Q: 打不开相机**  
A: 使用 localhost；检查系统相机权限。

**Q: 频闪 / 一人变两人**  
A: 举手页用单人模式；人物页已做躯干去重。仍不稳时改善光照、保证上半身入画。

**Q: 换电脑缺依赖**  
A: 不要复制 `node_modules` / `.venv`；按本文「换机部署完整流程」从第 1 步做起。

---

## 文档索引

- 规格：`SPEC.md`  
- 意图：`docs/intent/hand-raise-vision.md`  
- 任务：`tasks/todo.md`  
- 日志：`docs/worklog/`
