# Intent: 扫码评分云端固定地址

- **Outcome:** 扫码评分像座位排序一样部署到 Cloudflare Pages，得到长期不变的 `*.pages.dev` 地址；二维码可反复使用，电脑不必靠临时 tunnel。
- **User:** 课堂上老师展示/管理，学生手机扫码打分。
- **Why now:** 临时 `trycloudflare.com` 每次重启都变，二维码无法长期复用。
- **Success:** 部署一次后地址固定；手机可扫码打分；展示页实时更新；行为与现有六人评分规则一致。
- **Constraint:** 不买自定义域名，使用 Cloudflare 免费 `*.pages.dev`；复用本机已有 wrangler 登录。
- **Out of scope:** Named Tunnel / 自有域名；把举手检测等其他模块一并上云；迁移历史本地 `scores.db` 到云端（可选后续）。
