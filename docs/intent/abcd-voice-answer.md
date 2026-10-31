# Intent: 举手后 ABCD 语音判题

Status: **已确认**（2026-10-26）

## Module

举手锁定后的麦克风听选项、判题计分、自动下一题。

## Confirmed intent

- **Outcome:** 抢答成功 → 自动听麦 → 只认 A/B/C/D → 以最后一次为准 → 对 +1 / 错 −1 → 自动下一题（读题 + 倒计时 + 再抢）。
- **Listen:** 固定 5 秒窗口；有有效选项则结束；没有则继续等。
- **User:** 教室老师端（speech-online + people-fast + scoreboard）。
- **Constraint:** 四选一字母；浏览器 Web Speech；积分不低于 0。
- **Not this:** 自由文本模糊匹配主路径；老师手动点结束听写才停。

## Related

- Spec: `docs/SPEC-abcd-voice-answer.md`
- Supersedes classroom path in: `docs/SPEC-speech-answer.md`（历史）
