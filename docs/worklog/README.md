# 每日工作记录（Dev Worklog）

按日记录工作过程，便于换会话、交接和回溯。

## 约定

- 文件：`docs/worklog/YYYY-MM-DD.md`（一天一个文件）
- 同一天多次工作：在同一文件里追加新的 `## Session` 区块，不要覆盖旧内容
- **必须写时间**（默认时区 `UTC+8` / Asia/Shanghai）：
  - 标题：`## Session: YYYY-MM-DD HH:mm–HH:mm (UTC+8)`
  - 字段：`Logged at`（写入时刻）、`Start`、`End`
  - `Done` / `Decisions` 条目尽量带 `HH:mm`
- 内容对齐：`SPEC.md`、`tasks/todo.md`、Git commits（若有）

## 怎么写

在 Cursor Agent 聊天中任选一种说法：

```
/log
```

```
写一下每日工作记录
```

```
/log handoff
```

```
/log 今天完成了座位槽位重绑，下一步实机两人验收；卡在对调站位会串号
```

Agent 会按 `.cursor/skills/daily-work-record/SKILL.md` 落盘。
