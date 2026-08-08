# 研发日志（Dev Worklog）

按日记录研发过程，便于换会话、交接和回溯。

## 约定

- 文件：`docs/worklog/YYYY-MM-DD.md`（一天一个文件）
- 同一天多次工作：在同一文件里追加新的 `## Session` 区块，不要覆盖旧内容
- **必须写时间**（默认时区 `UTC+8` / Asia/Shanghai）：
  - 标题：`## Session: YYYY-MM-DD HH:mm–HH:mm (UTC+8)`
  - 字段：`Logged at`（写入时刻）、`Start`、`End`
  - `Done` / `Decisions` 条目尽量带 `HH:mm`
- 内容要对齐：`SPEC.md`（做什么）、`tasks/todo.md`（做到哪）、Git commits（改了什么）

## 怎么写

在 Cursor Agent 聊天中：

```
/log
```

```
/log handoff
```

```
/log 今天完成了关节限位校验，下一步接轨迹插值；卡在示教器协议文档不全
```

Agent 会按 `.cursor/skills/dev-worklog/SKILL.md` 落盘。
