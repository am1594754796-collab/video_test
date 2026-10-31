# Plan: 举手后 ABCD 语音判题

Spec: `docs/SPEC-abcd-voice-answer.md`

## Approach

1. Pure TS: extract last A–D from transcript; map bank answer → expected letter.
2. `listenForChoice`: Web Speech, 5s windows until letter or abort.
3. Bus `answer-result` + scoreboard ±1 / stop flash.
4. speech-online: on winner/first-raise → listen → publish → auto next question speak.

## Risks

- Web Speech needs Chrome/Edge + mic + network.
- first-raise from people-fast: speech page must subscribe and know current question.
- Auto-next: avoid re-entrancy while speaking/listening.
