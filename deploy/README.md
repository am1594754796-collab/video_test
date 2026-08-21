# 换机 / 移植配置（唯一入口）

本目录只放**换机器时要碰的说明与模板**。真实密钥仍写在本机：

`python/data/api.env`（已 gitignore，勿提交）

详细业务说明见仓库根目录 [`README.md`](../README.md)；API 可插拔见 [`docs/API-PROVIDERS.md`](../docs/API-PROVIDERS.md)。

---

## 1. 环境依赖

| 项 | 要求 |
|----|------|
| Node.js | LTS（建议 20+），用于 Vite 前端 |
| Python | 3.10+（建议 3.12） |
| 浏览器 | Chrome / Edge（语音听写、相机） |
| 端口 | `5173`（前端）、`8765`（Python API） |

首次安装（仓库根目录）：

```bat
npm.cmd install
cd python
python -m venv .venv
.venv\Scripts\pip.exe install -r requirements.txt
cd ..
```

---

## 2. 统一 API 密钥（必做）

换机的人**只改 Key**。地址、模型、开关已内置（DashScope + `qwen-plus` / `qwen-vl-plus`，语义 online、人脸 qwen）。

```bat
copy deploy\api.env.example python\data\api.env
```

编辑 `python\data\api.env`，只填：

```
LLM_API_KEY=你的阿里云 DashScope 密钥
```

改完后**必须重启** uvicorn / `start-*.bat`。

验收：`http://127.0.0.1:8765/api/health` 中 `llm_configured` / `vision_face_configured` 为 `true`。

---

## 3. 答案库（语音）

- 默认：`python/data/answers.json`
- 指向文件：`python/data/answers.path`
- 说明：`python/data/README.md`

---

## 4. 启动脚本速查

| 脚本 | 功能 |
|------|------|
| `start-people-fast.bat` | 视觉 · 相机 |
| `start-people-video.bat` | 视觉 · 本地视频 |
| `start-speech-online.bat` | 语音 · 在线听写 |
| `start-scoreboard.bat` | 计分板三页 |

不要同时开多个 bat（端口冲突）。

---

## 5. 换机检查清单

见同目录 [`checklist.md`](./checklist.md)。

---

## 6. 扩展新 API（开发者）

不要改页面直连第三方 Key。在 Python 增加 Provider，见：

[`docs/API-PROVIDERS.md`](../docs/API-PROVIDERS.md)
