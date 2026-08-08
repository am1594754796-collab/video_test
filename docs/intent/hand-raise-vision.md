# Intent: 举手抢答 — 视觉识别模块

Status: **confirmed + SPEC 定稿** (2026-08-06)

## Current priority (2026-08-06)

**先把举手行为检测做稳。**  
核心 Agent：`HandRaiseDetector` = MediaPipe 姿态点 → `isHandRaised` + 连续帧防抖 → 稳定的 `raised: true/false`（可按人输出）。  
暂缓优先级：最先举手竞态、编号闪烁、完整抢答演示（仍在模块远期范围内，但不阻塞本焦点）。

## Module

**视觉识别（Vision Recognition）** — 系统中解耦的一部分；当前切片聚焦举手行为识别，完整模块仍含排序 / 最先举手 / 闪烁反馈。

## Confirmed intent

- **Outcome (full module):** 实时处理 USB 相机画面，按从左到右识别固定 6 人（1–6 号），判定谁先举手，并在网页上让对应编号闪烁。
- **Outcome (current slice):** 稳定、低误报地识别「某人是否在举手」。
- **User:** 老师通过网页查看视觉反馈；下游模块（计分、抢答流程等）另行消费本模块输出。
- **Success (current slice):** 举手 / 放下在实机或录像上判定稳定；有单测覆盖边界 case。
- **Success (full module):** 稳定输出「最先举手 = N 号」，网页上 N 号明显闪烁。
- **Constraint:** USB UVC 相机；不做脸识；身份只用左→右序位 1–6。
- **Out of scope (this module):** 计分、点「抢答 / 下一轮」流程、姓名、语音播报、多机位、人脸识别。

## Related

- Spec: `SPEC.md`（视觉识别部分）
- Downstream (not this module): scoring UI, round arming, persistence
