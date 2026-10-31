# Spec: 举手后 ABCD 语音判题

> **Status:** 已实现待实机验收（2026-10-26）  
> **取代范围：** 旧「自由文本听写 + 模糊匹配 ≥90%」教室主路径；本规格为当前口头作答主流程。  
> 旧文档 `docs/SPEC-speech-answer.md` / `docs/intent/speech-answer-match.md` 仅作历史背景。

## Objective

教室抢答中，**最先举手锁定后**，用本机麦克风听学生口头选择 **A / B / C / D**，以**最后一次**有效选项为准判对错并计分，然后**自动进入下一题**（读题 → 举手倒计时 → 再开抢）。

### User stories

1. 作为老师，学生抢到后无需点「开始听写」，系统自动开麦听选项。
2. 作为老师，学生改口时以最后一次说出的 A–D 为准。
3. 作为老师，答对给该座位加分、答错扣分，然后自动下一题，无需手动点「下一轮 / 下一题」。
4. 作为开发者，ABCD 解析与标准答案字母映射有单元测试，不依赖真实麦克风。

### Acceptance criteria

- [ ] `first-raise`（或本页抢答 winner）之后，语音页自动开始听麦。
- [ ] 按 **5 秒窗口**循环听写：窗口内识别到至少一个 A–D → 取该窗口内**最后一次**有效选项并结束听写；未识别到 → 继续下一窗口，直到有结果或老师中止。
- [ ] 仅接受选项字母 A/B/C/D（含常见口语如「选 A」「答案是 B」「C 选项」等可解析形式）；不匹配自由文本题干答案。
- [ ] 标准答案：由题库该题 `options` 反查 `answer` 对应字母；若 `answer` 本身已是 `A|B|C|D` 则直接用。
- [ ] 判对：抢答座位 **+1**；判错：**−1**（积分不低于 0，与提前举手一致）。
- [ ] 记分板停闪；总线发布判题结果事件。
- [ ] 第一题由老师点「开始本题」；判题计分后展示结果与分数 5 秒，再自动选中下一题并走完整读题 + 举手倒计时流程；题库末题展示 5 秒后提示结束，不再循环（除非老师手动选题）。
- [ ] Chrome / Edge（Web Speech / `webkitSpeechRecognition`）可用；无麦克风权限时明确提示，不静默失败。

## Tech Stack

| Layer | Choice |
|-------|--------|
| 听写 | 浏览器 `SpeechRecognition` / `webkitSpeechRecognition`，`lang: "zh-CN"`，`interimResults` 开启以便窗口内取最后一次 |
| 判题 | 纯前端：转写 → 提取字母 → 与期望字母比较（不调用旧 Python fuzzy match） |
| 编排页 | `speech-online.html` + `src/app/speech-board-online.ts`（持有当前题） |
| 跨页 | `classroomBus`（视觉 `people-fast` 发 `first-raise`；记分板消费判题事件） |
| 题库 | 现有 `python/data/answers.json`（经 `/api/speech/questions`） |
| 测试 | Vitest（字母解析、期望字母映射、窗口内「最后一次」逻辑） |

## Commands

```
npm test
npm run lint
npm run build
npm run dev
# 实机：Chrome 开 speech-online + people-fast + scoreboard；允许麦克风
```

## Project Structure

```
docs/
  SPEC-abcd-voice-answer.md     → 本规格
  intent/abcd-voice-answer.md   → 确认意图摘要
src/
  speech/
    extractChoiceLetter.ts      → 从转写文本提取 A–D（可多段，取最后一次）
    expectedChoiceLetter.ts     → 题库 answer → 期望字母
    listenForChoice.ts          → 5s 窗口循环 Web Speech，直到得到字母或 abort
  app/
    classroomBus.ts             → 扩展判题事件
    speech-board-online.ts      → first-raise 后听写 → 计分 → 自动下一题
    scoreboard.ts               → 对 +1 / 错 −1、停闪
  speech/…tests or src/**/*.test.ts
```

## Code Style

- 听写适配器与纯函数解析分离；单测只测纯函数。
- 常量：`LISTEN_WINDOW_MS = 5000`；分值 `+1` / `-1`；积分 `Math.max(0, …)`。
- 总线事件字段用明确语义（见下），避免复用含糊的 `answer-passed` 兼负分。

```ts
// Good: last letter wins within one transcript / window buffer
extractLastChoiceLetter("我选 A……不对，选 B") === "B"

// Good: map bank answer text to letter
expectedChoiceLetter({ options: { A: "上海", B: "北京", … }, answer: "北京" }) === "B"
```

## Testing Strategy

| Level | What |
|-------|------|
| Unit | `extractLastChoiceLetter`、`expectedChoiceLetter`、窗口缓冲「最后一次」 |
| Manual | 抢答后说「A」再改「C」→ 按 C 判；5s 内不说话继续等；对/错分值与自动下一题 |
| Out of scope for CI | 真实麦克风 / 云端 ASR 稳定性 |

## Boundaries

- **Always:** 先更新本规格再改行为；判题前校验当前题与期望字母；无麦权限时 UI 明示。
- **Ask first:** 改窗口时长、分值、末题是否循环、接入 Whisper/服务端 ASR。
- **Never:** 恢复「整句模糊匹配 ≥90%」作为教室主判题；在视觉页（无题库）单独开麦判题；把 `answer` 明文播给扬声器。

## Flow

```
读题 → 倒计时 → OPEN → first-raise / winner
  → 开麦（5s 窗口循环，取最后一次 A–D）
  → 比期望字母 → bus: answer-result { passed, letter, personIndex, questionId }
  → scoreboard ±1、停闪
  → 展示判题分数 5 秒 → 自动下一题（有则读题+倒计时；无则提示题库结束）
```

### Bus events（相对现状）

| Event | Role |
|-------|------|
| `first-raise` | 已有；触发听写（语音页订阅；本页 winner 亦走同一路径） |
| `answer-result` | **新增**：`passed`, `letter`, `personIndex?`, `questionId?`, `transcript?` |
| `answer-passed` | **弃用主路径**（可保留短暂兼容：等价于 `answer-result` 且 `passed: true`） |
| `race-reset` / `raise-round-abort` | 听写中收到则 **abort** 听写，不计分 |

## Success Criteria

1. 自动化：字母解析与期望字母单测通过。
2. 实机：举手后 5s 内说「B」→ 若标准为 B 则 +1 并进入下一题读题；说错字母 → −1 并进入下一题。
3. 同一窗口内先说 A 后说 D → 按 D 判。
4. 5s 内无有效字母 → 继续听，不误判、不加分。
5. 记分板与语音页演示分对同一 `answer-result` 行为一致（±1、停闪）。

## Open Questions

- 无（已确认：5s 窗口、±1、自动下一题含读题再抢答、末题不循环为本文默认）。

## ASSUMPTIONS（已写入正文，有异议请改规格）

1. 听写与编排在 **speech-online**（持有当前题）；视觉页只发 `first-raise`。
2. ASR 用浏览器 Web Speech（需联网）；不恢复 Whisper 主路径。
3. 错题扣分地板为 **0**（与提前举手一致）。
4. 题库最后一题判完后停止自动推进，状态提示「题库结束」。
