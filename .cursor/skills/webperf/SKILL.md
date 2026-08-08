---
name: webperf
description: Run a web performance audit for browser-facing apps. Use when the user runs /webperf.
disable-model-invocation: true
---

# /webperf

`/webperf` targets web applications specifically. Do not use it for utility libraries, CLIs, or server-only code with no browser-facing output.

Also follow `.cursor/skills/performance-optimization/SKILL.md` and `references/performance-checklist.md`.

## Determine the mode

**Deep mode** — activate when any of these is available:

- A Lighthouse JSON report file
- A PageSpeed Insights JSON response (includes Lighthouse + CrUX)
- A CrUX API response
- A DevTools performance trace
- A live URL plus Chrome DevTools MCP (or similar) configured

**Quick mode** — default when none of the above are available. Scan source code for structural anti-patterns and label every finding as `potential impact`.

## Run the audit

Pass explicitly:

- The files, components, or diff under review
- Any artifact paths or pasted JSON content
- The target URL or page name when known
- Which mode you expect (Quick or Deep)

Return a scorecard (only populated with sourced values), a ranked list of findings, positive observations, and proactive recommendations.

## Output

Return the full audit report to the user. No synthesis or merge step is needed — this is a single-persona command.
