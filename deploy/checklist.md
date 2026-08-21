# 换机验收清单

- [ ] 已安装 Node.js、Python 3.10+
- [ ] 已执行 `npm.cmd install` 与 `python` 下 `pip install -r requirements.txt`
- [ ] 已复制 `deploy/api.env.example` → `python/data/api.env` 并只填写 `LLM_API_KEY`（不要改模型名）
- [ ] 重启 API 后访问 http://127.0.0.1:8765/api/health ，`llm_configured=true`
- [ ] 视觉：http://localhost:5173/people-fast.html 能开相机，页顶显示 API 已连接
- [ ] 语音：http://localhost:5173/speech-online.html 能选题并听写（Chrome/Edge）
- [ ] 计分：同源打开 scoreboard + 视觉 + 语音，举手闪烁与答对加分正常
- [ ] **未**将 `api.env` / `online.env` 提交到 Git
