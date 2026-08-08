---
name: ship
description: Run the pre-launch checklist via parallel specialist review, then synthesize a go/no-go decision with rollback plan. Use when the user runs /ship.
disable-model-invocation: true
---

# /ship

Read and follow `.cursor/skills/shipping-and-launch/SKILL.md`.

`/ship` is a **fan-out orchestrator**. It runs three specialist passes in parallel against the current change, then merges their reports into a single go/no-go decision with a rollback plan.

## Phase A — Parallel fan-out

Spawn three subagents concurrently (Cursor `Task` tool). **Issue all three Task calls in a single assistant turn** so they execute in parallel.

1. **code-reviewer** — Five-axis review (correctness, readability, architecture, security, performance) on staged changes or recent commits. Follow `.cursor/skills/code-review-and-quality/SKILL.md`. Prefer `subagent_type: "bugbot"` only when the user asked for Bugbot; otherwise use `generalPurpose` with the review skill instructions.
2. **security-auditor** — Vulnerability and threat-model pass. Follow `.cursor/skills/security-and-hardening/SKILL.md` and `references/security-checklist.md`. Prefer `subagent_type: "security-review"` only when the user explicitly asked for a Security Review; otherwise use `generalPurpose` with the security skill instructions.
3. **test-engineer** — Analyze test coverage for the change. Follow `.cursor/skills/test-driven-development/SKILL.md`. Identify gaps in happy path, edge cases, error paths, and concurrency. Use `generalPurpose`.

Constraints:

- Subagents should not spawn other subagents.
- Each subagent returns only its report to this main session.

If the Task tool is unavailable, run the three personas sequentially in this session and still merge in Phase B.

## Phase B — Merge in main context

Once all three reports are back, synthesize:

1. **Code Quality** — Aggregate Critical/Important findings and any failing tests, lint, or build output.
2. **Security** — Promote any Critical/High findings to launch blockers.
3. **Performance** — From the reviewer's performance axis; Core Web Vitals if applicable.
4. **Accessibility** — Keyboard nav, screen reader, contrast (see `references/accessibility-checklist.md`).
5. **Infrastructure** — Env vars, migrations, monitoring, feature flags.
6. **Documentation** — README, ADRs, changelog.

## Phase C — Decision and rollback

Produce:

```markdown
## Ship Decision: GO | NO-GO

### Blockers (must fix before ship)
- [Source: Critical finding + file:line]

### Recommended fixes (should fix before ship)
- [Source: Important finding + file:line]

### Acknowledged risks (shipping anyway)
- [Risk + mitigation]

### Rollback plan
- Trigger conditions: [...]
- Rollback procedure: [...]
- Recovery time objective: [...]

### Specialist reports (full)
- [code-reviewer report]
- [security-auditor report]
- [test-engineer report]
```

## Rules

1. Prefer parallel Phase A — never sequential when Task is available.
2. Personas do not call each other. The main agent merges in Phase B.
3. The rollback plan is mandatory before any GO decision.
4. If any persona returns a Critical finding, default to NO-GO unless the user explicitly accepts the risk.
5. **Skip the fan-out only if all are true:** the change touches 2 files or fewer, the diff is under 50 lines, and it does not touch auth, payments, data access, or config/env.
