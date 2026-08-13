---
name: daily-work-record
description: >-
  Writes the user's daily work record (每日工作记录 / 研发日志) under
  docs/worklog/YYYY-MM-DD.md. Use when the user runs /log, says 写日志、
  每日工作记录、工作日志、研发日志、记一下今天、收工、交接，or when ending
  a meaningful /spec /plan /build /review /ship session.
---

# 每日工作记录（Daily Work Record）

把当天的工作落成可交接的 Markdown，方便换会话、换电脑、回头查「做到哪了」。

## When to use

- 用户说：`/log`、写日志、每日工作记录、工作日志、研发日志、记一下今天、收工、交接
- 完成一轮有意义的 `/spec` / `/plan` / `/build` / `/review` / `/ship` 之后
- 长会话结束前，需要把进度固化下来

**不要用：** 只改了一行、没有决策/阻塞、用户也没要求记日志时，不要刷空文件。

## Where to write

```
docs/worklog/
  YYYY-MM-DD.md     # 一天一个文件（本地日历日）
  README.md         # 约定说明
```

- 路径：`docs/worklog/YYYY-MM-DD.md`
- 今天已有文件 → **追加** 新的 `## Session` 区块，禁止覆盖旧会话
- 没有文件 → 用下方「新日文件」模板创建
- 目录不存在则先创建 `docs/worklog/`

## Time rules（必填）

1. 写之前用 shell 取本地时间（本项目默认 **Asia/Shanghai UTC+8**）：
   - PowerShell：`Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'`
2. 每个 Session 必须有：
   - **Logged at** — 写入时刻 `YYYY-MM-DD HH:mm:ss UTC+8`
   - **Start** — 本段工作开始（`HH:mm` 或完整时间）
   - **End** — 本段工作结束；收工日志可用「现在」
3. Start/End 不清楚就问用户，**禁止编造时间**
4. `Done` / `Decisions` 多条时尽量带 `HH:mm`
5. 禁止把时间写成 `…` / `TBD` 就交差

## Entry rules

1. **具体**：写清文件、模块、任务 ID、页面名；禁止「做了一些工作」
2. **对齐真相源**：有则引用 `SPEC.md`、`tasks/todo.md`、相关 commits
3. **事实与未决分开**：决策、阻塞各自一节
4. **Next 可接手**：让下一聊天/自己明天冷启动就能干
5. **不编造进度**：只记本会话真实发生的，或用户口述确认的
6. **不写秘密**：无 token、密码、密钥、隐私凭证
7. **中文为主**：标题与条目用中文；专有名词/路径可保留英文

## Templates

### 新日文件

```markdown
# Worklog YYYY-MM-DD

## Session: YYYY-MM-DD HH:mm–HH:mm (UTC+8)

- Logged at: YYYY-MM-DD HH:mm:ss UTC+8
- Start: HH:mm
- End: HH:mm

### Done
- HH:mm — …

### Decisions
- HH:mm — …

### Blockers / Risks
- …

### Next
- [ ] …

### Refs
- SPEC: …
- Tasks: …
- Commits: …
```

### 追加同一天

空一行后，再写一个完整的 `## Session: …` 区块（含 Logged at / Start / End）。除非用户要求更正事实错误，否则不改历史 Session。

## Process（按顺序做）

1. Shell 取本地日期与当前时间 → 确定 `docs/worklog/YYYY-MM-DD.md`
2. 确认或询问 Start / End
3. 只从**本会话**收集：
   - 做了什么（功能、文件、命令）
   - 测试 / 构建结果（若有）
   - 决策与未决问题
   - 下一步（对照 `tasks/todo.md` 若存在）
4. 创建或追加 Session 区块
5. 回复用户：文件路径、时间段、3–6 条摘要；**不要擅自 git commit**（除非用户明确要求）

## Modes

| 用户说法 | 行为 |
|----------|------|
| `/log`、写日志、每日工作记录、收工 | 按会话上下文追加今天 |
| `/log summary`、总结一下今天 | 结合 git / tasks 现状写一节（仍是一个 Session） |
| `/log handoff`、交接 | 突出 Blockers + Next，方便新聊天接手 |
| `/log` + 一段口述 | 把口述整理进模板，不添油加醋 |

## Relationship

| 产物 | 和本日志的关系 |
|------|----------------|
| `SPEC.md` | 需求；日志不与之矛盾；范围变了先改 SPEC 再记一笔 |
| `tasks/todo.md` | 清单；日志叙述进度；完成项仍要在 todo 勾掉 |
| ADR / `docs/decisions/` | 长期架构为什么；日志可链过去 |
| Git commit | 代码真相；日志可写 hash，不替代 commit |

## Red flags

- Done 空洞或把「计划做」写成「已完成」
- Next 无视未解阻塞
- 整段粘贴 diff 而不摘要
- 覆盖同一天更早的 Session
- 缺少或伪造 Logged at / Start / End

## Example（好的一条）

```markdown
## Session: 2026-08-08 19:30–19:45 (UTC+8)

- Logged at: 2026-08-08 19:45:12 UTC+8
- Start: 19:30
- End: 19:45

### Done
- 19:35 — 人物编号快版：座位槽位重绑，丢检后找回原编号
- 19:40 — `npm test` 28 passed；推送 `a994ce0`

### Decisions
- 19:36 — 锁定后用位置槽位粘编号，不单绑临时 trackId

### Blockers / Risks
- 两人站位对调仍可能串号，需「重新编号」

### Next
- [ ] 实机两人场景再验收举手竞态
- [ ] 需要时把默认人数改回 6

### Refs
- SPEC: 视觉识别 / 最先举手
- Commits: a994ce0
```
