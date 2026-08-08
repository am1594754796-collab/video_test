---
name: log
description: Append or create today's engineering worklog under docs/worklog/. Use when the user runs /log or asks to write 研发日志.
disable-model-invocation: true
---

# /log

Read and follow `.cursor/skills/dev-worklog/SKILL.md`.

## Default

Append a session block to `docs/worklog/YYYY-MM-DD.md` (create the file if needed) based on this conversation: what was done, decisions, blockers, and next steps. Tie entries to `SPEC.md` and `tasks/todo.md` when those exist.

**Time is required:** include `Logged at`, `Start`, and `End` (Asia/Shanghai UTC+8). Resolve local clock via shell if needed; ask the user for Start/End when unclear — do not invent times.

## Arguments

- **`/log`** or **`/log append`** — normal append from session context
- **`/log summary`** — summarize current repo + task state into one session block
- **`/log handoff`** — handoff-oriented entry (Blockers + Next first-class) for a new chat
- **`/log …notes…`** — structure the user's free-text notes into the template

When finished, reply with the file path and a short bullet summary of what was logged. Do not commit unless the user asks.
