---
name: dev-worklog
description: >-
  Maintains dated engineering worklogs under docs/worklog/. Use when the user
  runs /log, asks to write a 研发日志 or work journal, ends a development
  session, or after completing a /build /plan /spec /review /ship slice —
  append what was done, blockers, and next steps tied to SPEC.md and tasks.
---

# Dev Worklog（研发日志）

## Overview

Persist session progress as dated markdown logs. The worklog is the human-readable trail of *what happened and why we stopped where we did* — complementary to `SPEC.md` (what to build), `tasks/todo.md` (what's left), commits (what changed in code), and ADRs (why architecture changed).

## When to Use

- User runs `/log` or asks for 研发日志 / 工作记录 / worklog
- After finishing a `/build`, `/plan`, `/spec`, `/review`, or `/ship` slice
- Ending a long session — capture state before context is lost
- Handing off work to another person or a later chat

**When NOT to use:** Trivial one-line fixes with no decisions or blockers; do not spam empty daily files.

## Location and naming

```
docs/worklog/
  YYYY-MM-DD.md          # one file per calendar day (local date)
  README.md              # index conventions (optional)
```

- Path: `docs/worklog/YYYY-MM-DD.md`
- Date: use the user's **local** calendar date
- Time: every session **must** include wall-clock times (see Time rules)
- If today's file exists, **append** a new session section — do not overwrite earlier entries
- If missing, create the file from the daily header template below

## Time rules (required)

1. Resolve local now before writing — run a shell time command if the chat context has no reliable clock, e.g. PowerShell: `Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'`.
2. Default timezone for this project: **Asia/Shanghai (UTC+8)** unless the user states otherwise.
3. Every session header must include:
   - **Logged at** — timestamp when this entry was written (`YYYY-MM-DD HH:mm:ss UTC+8`)
   - **Start** — session/work start (`HH:mm` or full datetime). Ask the user if unknown; do not invent.
   - **End** — session/work end (`HH:mm` or full datetime). Use "now" when logging at session end; ask if unclear.
4. Prefer dating bullets in **Done** / **Decisions** with `HH:mm` when multiple events happened in one session.
5. Never omit time fields or leave them as `…` / `TBD` in a finished entry.

## Entry rules

1. **Be concrete** — name files, modules, task IDs, and SPEC sections. No vague "做了一些工作".
2. **Tie to source of truth** — reference `SPEC.md`, `tasks/todo.md` item titles/IDs, ADR numbers when relevant.
3. **Separate fact from open questions** — blockers and decisions go in their own subsections.
4. **Next steps must be actionable** — something `/build` or a human can pick up cold.
5. **Do not invent progress** — only log work that actually happened in this session (or that the user dictated).
6. **Keep secrets out** — no tokens, passwords, private keys, or proprietary credentials.
7. **Always include time** — follow Time rules above.

## Templates

### New day file

```markdown
# Worklog YYYY-MM-DD

## Session: YYYY-MM-DD HH:mm–HH:mm (UTC+8)

- Logged at: YYYY-MM-DD HH:mm:ss UTC+8
- Start: HH:mm
- End: HH:mm

### Done
- HH:mm — …

### Decisions
- HH:mm — … (link ADR-XXX if written)

### Blockers / Risks
- …

### Next
- [ ] …

### Refs
- SPEC: …
- Tasks: …
- Commits: … (hashes if any)
```

### Append to existing day

Add a blank line, then another `## Session: …` block with the same subsections (including Logged at / Start / End). Do not edit prior sessions unless the user asks to correct a factual error.

## Process

1. Resolve local date/time (shell if needed); path = `docs/worklog/YYYY-MM-DD.md`
2. Create `docs/worklog/` if needed
3. Confirm or ask for **Start** / **End** if not obvious from the conversation
4. Gather from this session only:
   - Commands run (`/spec`, `/plan`, `/build`, …)
   - Files touched (high level)
   - Tests run / results if known
   - Decisions and unresolved questions
   - Next pending task from `tasks/todo.md` if present
5. Write or append the session block with required time fields
6. Show the user the path, the time range, and a short confirmation (3–6 bullets)

## Modes (`/log` arguments)

| Input | Behavior |
|-------|----------|
| (empty) / `append` | Append today's session from chat context |
| `summary` | Write Done/Next from current git + tasks state; still one session block |
| `handoff` | Emphasize Next + Blockers for a cold restart in a new chat |
| free text | Treat as the user's dictated notes; structure into the template |

## Relationship to other artifacts

| Artifact | Role vs worklog |
|----------|-----------------|
| `SPEC.md` | Requirements — worklog must not contradict; if scope changed, update SPEC first then note it |
| `tasks/todo.md` | Checklist — worklog narrates; still mark tasks complete in todo when done |
| `docs/decisions/` ADRs | Lasting architecture why — worklog can link; do not replace ADRs |
| Git commits | Code truth — worklog may list hashes; commits stay atomic |

## Red flags

- Empty Done section with only fluff
- Next steps that ignore open blockers
- Logging planned work as completed
- Duplicating full diffs instead of summarizing
- Overwriting earlier sessions in the same day file
- Missing Logged at / Start / End, or fabricated times
