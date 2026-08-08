# 举手行为检测（视觉识别模块）

教室场景视觉模块：**MediaPipe Pose** + 举手判定。  
当前默认：**单人调试模式**（`numPoses=1`）。不含计分 / 抢答流程。

---

## 一键启动（Windows 推荐）

### A. 举手单人调试

双击：

```
start.bat
```

打开 http://localhost:5173/

### B. 人物数量 + 左→右编号（独立页）

需要 **Node.js + Python**。双击：

```
start-people.bat
```

会启动：

1. Python 排序 API（`127.0.0.1:8765`）  
2. Vite 网页 → http://localhost:5173/people.html  

流程：浏览器 MediaPipe 检出人物 → 把坐标发给 Python → 按左→右编号 → 页面显示人数与 1…N。

若双击无效，在项目根目录打开终端执行：

```bat
start.bat
```

或人物页：

```bat
start-people.bat
```

或：

```powershell
.\start.ps1
```

### PowerShell 报错「禁止运行脚本」时

不要用 `npm`，改用：

```powershell
npm.cmd run dev
```

或（当前用户永久放开，可选）：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

## 安装 Node.js（首次必做）

未安装时，在 **管理员或普通 PowerShell / CMD** 中任选一种：

### 方式 A：winget（Windows 10/11 推荐）

```powershell
winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
```

装完后 **关闭并重新打开** 终端，验证：

```powershell
node -v
npm.cmd -v
```

### 方式 B：官网安装包

1. 打开 https://nodejs.org/  
2. 下载并安装 **LTS**  
3. 安装时勾选加入 PATH，完成后重开终端，执行上面的 `node -v` 检查

### 方式 C：Chocolatey（若已安装 choco）

```powershell
choco install nodejs-lts -y
```

---

## 安装 Python（人物数量页需要）

```powershell
winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements
```

验证：

```powershell
python --version
```

手动启动排序 API（也可由 `start-people.bat` 自动拉起）：

```bat
cd python
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\uvicorn server:app --host 127.0.0.1 --port 8765
```

Python 单测：

```bat
cd python
.venv\Scripts\python -m pytest tests -q
```

---

## 环境要求

| 项 | 说明 |
|----|------|
| Node.js | LTS（建议 ≥ 20），见上方安装命令 |
| Python | 3.10+（人物数量页 / 左→右排序 API） |
| 浏览器 | Chromium 系（Chrome / Edge） |
| 相机 | 本机摄像头，或手机经 USB/虚拟摄像头软件映射到 Windows |
| 网络 | 首次需联网下载 npm 包与 MediaPipe 模型/WASM |

相机仅在 **localhost** 或 HTTPS 下可用。

---

## 手动命令

在项目根目录 `E:\TEST`（或你的克隆路径）：

```bat
npm.cmd install
npm.cmd run dev
```

浏览器打开终端里显示的地址（默认 http://localhost:5173/）→ 点 **打开相机**。

### 常用脚本

| 命令 | 作用 |
|------|------|
| `npm.cmd run dev` | 开发预览（热更新） |
| `npm.cmd test` | 跑单元测试 |
| `npm.cmd run build` | 生产构建到 `dist/` |
| `npm.cmd run preview` | 本地预览构建产物 |
| `npm.cmd run lint` | TypeScript 检查 |

### 生产构建（可选）

```bat
npm.cmd run build
npm.cmd run preview
```

静态文件在 `dist/`，可放到任意静态站点；**仍需 HTTPS 或 localhost** 才能用相机。

---

## 使用说明（单人调试）

1. 启动后页面标题为「举手行为检测 · 单人调试」  
2. 点击 **打开相机**，允许权限  
3. 上半身入画，正对镜头  
4. 举手 / 放下，看画面标注与下方状态 pill  

另开独立页：**人物数量** → http://localhost:5173/people.html（需 Python API）

### 调参

| 参数 | 默认 | 说明 |
|------|------|------|
| `margin` | `0.08` | 腕须比肩高出的距离（越大越不易误报） |
| `minFrames` | `5` | 连续多少帧一致才翻转举手状态 |

状态栏示例：`单人调试 · 已锁定 · margin=0.08 · minFrames=5`

---

## 目录结构

```
E:\TEST\
  start.bat / start.ps1   ← 举手单人调试一键启动
  start-people.bat        ← 人物数量页 + Python 排序
  people.html             ← 人物数量独立页
  python/
    sort_people.py        ← 左→右排序核心
    server.py             ← FastAPI
    requirements.txt
  package.json
  index.html              ← 举手单人调试
  src/
    vision/               ← 视觉识别核心
    app/                  ← 演示页
  tests/vision/
  docs/
  tasks/
  SPEC.md
```

---

## 技术说明

- `@mediapipe/tasks-vision` Pose Landmarker  
- `runningMode: "VIDEO"`，当前 **`numPoses: 1`**  
- 模型：Pose Landmarker Lite（首次从 Google Storage 拉取）  
- 官方指南：https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js  

---

## 常见问题

**Q: `npm : 无法加载 … npm.ps1，因为在此系统上禁止运行脚本`**  
A: 用 `npm.cmd`，或运行 `start.bat`（已避开该问题）。

**Q: 打不开相机**  
A: 确认用的是 `http://localhost:5173`；检查系统隐私设置是否允许浏览器使用摄像头。

**Q: 频闪 / 一人变两人**  
A: 当前已切单人模式降低该问题。若仍闪，略增大 `margin` / `minFrames`，并保证光线充足、上半身完整入画。

**Q: 换电脑如何部署**  
A: 安装 Node → 拷贝本仓库（可不含 `node_modules`）→ 双击 `start.bat`。

---

## 文档索引

- 规格：`SPEC.md`  
- 意图：`docs/intent/hand-raise-vision.md`  
- 任务：`tasks/todo.md`  
- 日志：`docs/worklog/`
