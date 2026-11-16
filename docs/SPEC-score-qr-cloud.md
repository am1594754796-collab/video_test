# Spec: 扫码评分 · Cloudflare Pages 固定地址

> **Status:** **定稿 / Approved** — 2026-11-05（用户确认）  
> **对齐意图:** `docs/intent/score-qr-cloud.md`

## Objective

把现有「六个编号 · 扫码打分」做成与 `zuoweipaixu` 同款的云端部署：上传到 **Cloudflare Pages**，使用免费固定地址（预期 `https://score-qr.pages.dev`）。部署后链接长期有效；评分数据存在 Cloudflare，不再依赖本机临时 tunnel。

### User stories

1. 作为老师，我部署一次后得到固定 https 地址，现场打开 `/live` 展示二维码与实时分数。
2. 作为学生，我扫对应编号的独立二维码进入 `/s/编号` 并提交 0–100 分；同一浏览器对每个编号只能评一次，可给不同编号分别评分。
3. 作为老师，我能在管理页改六个编号、查看汇总与最近记录，并能清空评分（需口令，因云端无 localhost 限制）。

### Acceptance criteria

- [ ] `npm run deploy:cloudflare`（或 `部署到云端.bat`）可部署到 Cloudflare Pages。
- [ ] 生产地址为固定 `https://<project>.pages.dev`（项目名默认 `score-qr`），重启/关机后地址不变。
- [ ] 功能对齐现网：统一 QR → `/s`；六槽位；0–100；一人一票（Cookie）；`/live` 轮询；`/api/live-scores`；`/api/summary/:code`。
- [ ] 清空评分与改编号需管理口令（环境变量 / wrangler secret）。
- [ ] 现有本机 `start-score-qr*.bat` 保留，互不影响。

## ASSUMPTIONS（请核对）

1. **只做 Cloudflare Pages**（不做 Vercel），与座位排序的 Cloudflare 路径一致；免费 `*.pages.dev`，不买域名。
2. **后端用 Pages Functions + D1**（云端 SQLite），不是纯静态站——因为要存分。
3. **项目名** `score-qr` → 地址大致为 `https://score-qr.pages.dev`。
4. **管理口令**：云端用 `SCORE_QR_ADMIN_TOKEN`（首次部署可设简单口令）；无口令不能改编号/清空。
5. **本机 Flask 评分保留**；云端是并行交付物，不删局域网/临时公网脚本。
6. **不自动迁移** 本地 `scores.db` 历史到云端。

→ 回复「确认」或指出要改的假设，我再实现。

## Tech stack

| Layer | Choice |
|-------|--------|
| Hosting | Cloudflare Pages |
| API | Pages Functions (`functions/`) |
| DB | Cloudflare D1 |
| QR | 服务端生成 PNG，或前端库指向固定 `/s` |
| Deploy | `wrangler pages deploy` + D1 migrate（对齐 zuoweipaixu 一键 bat） |

## Project structure

```
score_qr_cloud/           → 云端应用根目录
  public/                  → 静态页（live / admin / rate 的壳可走 Functions 渲染）
  functions/               → Pages Functions 路由
  migrations/              → D1 schema
  wrangler.toml
  package.json
部署扫码评分到云端.bat      → 仓库根目录一键部署（同座位排序风格）
```

实现时可把页面做成 Functions 返回 HTML（更接近现 Flask 模板），或 static + JSON API；以行为一致为准。

## Commands

```
cd score_qr_cloud
npm install
npx wrangler login          # 若未登录（本机座位排序多半已登录）
npx wrangler d1 create score-qr
npx wrangler d1 migrations apply score-qr --remote
npm run deploy:cloudflare
```

## Testing strategy

- 纯函数/校验逻辑的单元测试（编号、分数解析、一人一票）。
- 部署后手工：打开固定 URL → 扫码页提交 → live 更新 → 口令清空。

## Boundaries

- **Always:** 输入校验与现网一致；Cookie `HttpOnly` + `Secure` + `SameSite=Lax`；不在仓库提交 secret。
- **Ask first:** 改项目名/换账号、加自定义域名、删本机 Flask。
- **Never:** 把 OAuth token / admin token 写进 git；在无鉴权时开放清空接口。
