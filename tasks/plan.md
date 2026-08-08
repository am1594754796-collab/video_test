# Implementation Plan: 视觉识别模块（Vision Recognition）

## Overview

按定稿 `SPEC.md`，在空仓库中落地浏览器侧视觉识别 MVP：USB UVC 取流 → MediaPipe 姿态 → 左到右 1–6 → 举手竞态 → 网页编号闪烁，并通过 `VisionRecognitionApi` 与计分/流程模块解耦。本计划 **不包含** scoring / round。

**执行优先级（2026-08-06 用户确认）：** 第一目标是 **举手行为检测做稳**（T1 最小脚手架 → T3 `isHandRaised` + 防抖 → 尽早接相机/MediaPipe 做实机调参）。`orderPeople`、FirstRaise、闪烁可随后；不要为完整抢答 UI 拖延举手识别质量。

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Vite + TypeScript + **轻量 DOM**（不用 React，除非后续强制） | MVP 反馈面简单；减少与业务解耦无关的状态层 |
| **先纯函数 + Vitest，再接相机/MediaPipe** | 排序/举手/竞态可无摄像头验证；失败成本最低 |
| MediaPipe Pose Landmarker 经 `detect/poseAdapter.ts` 隔离 | 便于 mock；换模型不污染状态机 |
| 推理画布默认 ≤1080p | 满足 SPEC 实时性；采集分辨率可更高 |
| `EventTarget` / 回调实现 `onFirstRaise` | 零依赖总线；符合 SPEC |
| 演示壳在 `src/app`，只依赖 `vision/api` | 强制模块边界 |

## Dependency Graph

```
Scaffold (Vite/Vitest)
    │
    ├── Types + VisionRecognitionApi 契约
    │       │
    │       ├── orderPeople / isHandRaised（纯函数）
    │       │       │
    │       │       └── FirstRaiseTracker（armed / debounce / first-wins / reset）
    │       │               │
    │       │               ├── feedback 编号闪烁 UI
    │       │               │
    │       │               └── api 实现（接线 tracker + events）
    │       │
    │       ├── camera（getUserMedia + 预览）
    │       │       │
    │       │       └── poseAdapter（MediaPipe）──→ 帧循环 ──→ Tracker
    │       │
    │       └── app 演示壳（start/stop/reset/setArmed）
```

## Task List

### Phase 1: Foundation

#### Task 1: 工程脚手架

**Description:** 初始化 Vite + TS 项目、Vitest、基础 scripts（dev/build/test/lint），建立 `src/vision` / `src/app` / `tests/vision` 目录与模块 README 头注释（标明视觉识别）。

**Acceptance criteria:**
- [ ] `npm run dev` / `npm run build` / `npm test` 可执行
- [ ] 目录结构与 SPEC Project Structure 对齐

**Verification:**
- [ ] `npm test` 通过（可为空套件）
- [ ] `npm run build` 成功

**Dependencies:** None  
**Files likely touched:** `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/**`, `README.md`  
**Estimated scope:** M

#### Task 2: 类型与 API 契约 + 可测桩

**Description:** 定义 `FirstRaiseEvent`、`VisionRecognitionApi`（含 `setArmed`）、导出入口；提供内存桩实现，便于后续 UI 先接线。

**Acceptance criteria:**
- [ ] 对外编号类型为 `1..6`
- [ ] 接口含 `start` / `stop` / `resetDetection` / `onFirstRaise` / `setArmed`
- [ ] 桩可手动触发一次 first-raise，reset 后可再触发

**Verification:**
- [ ] 契约单测或类型导出检查通过

**Dependencies:** Task 1  
**Files likely touched:** `src/vision/api.ts`, `src/vision/types.ts`, `tests/vision/api.stub.test.ts`  
**Estimated scope:** S

### Checkpoint: Foundation

- [ ] 构建与测试绿
- [ ] API 形状与 SPEC 一致
- [ ] 人工确认目录/命名无异议后再进核心逻辑

---

### Phase 2: 判定核心（无相机）

#### Task 3: 左→右排序与举手纯函数

**Description:** 实现 `orderPeople`（x 升序、>6 截最左 6）与 `isHandRaised`（腕相对肩 + 边距可配置）；fixture 关键点单测。

**Acceptance criteria:**
- [ ] 排序与截断符合 Resolved decisions
- [ ] 举手谓词对明显举手/放下 case 正确

**Verification:**
- [ ] `npm test -- tests/vision/orderPeople`（或等价路径）通过
- [ ] `npm test -- tests/vision/isHandRaised` 通过

**Dependencies:** Task 2  
**Files likely touched:** `src/vision/detect/orderPeople.ts`, `src/vision/detect/isHandRaised.ts`, `tests/vision/*.ts`  
**Estimated scope:** S

#### Task 4: FirstRaiseTracker 状态机

**Description:** 实现 armed、最短持续帧/时长防抖、最先举手只发射一次、`resetDetection` 清赢家并可再赛。

**Acceptance criteria:**
- [ ] 同时/先后举手取更早时间戳胜者
- [ ] `setArmed(false)` 时不产生赢家
- [ ] reset 后可再次 `onFirstRaise`

**Verification:**
- [ ] 竞态与 armed 相关单测全绿

**Dependencies:** Task 3  
**Files likely touched:** `src/vision/detect/firstRaiseTracker.ts`, `tests/vision/firstRaiseTracker.test.ts`  
**Estimated scope:** M

#### Task 5: 编号闪烁反馈 UI

**Description:** 1–6 号展示；订阅 first-raise 后目标编号闪烁；动画可自动结束，赢家高亮保留到 reset；显示实检人数。

**Acceptance criteria:**
- [ ] 仅赢家编号闪烁
- [ ] reset 清除赢家视觉状态
- [ ] 可用桩/模拟按钮在无相机下验证

**Verification:**
- [ ] 手动：演示页点「模拟 3 号举手」→ 3 闪烁
- [ ] 相关单测（若有 DOM 测）或构建通过

**Dependencies:** Task 2（可与 3–4 并行接桩；完整接线依赖 4）  
**Files likely touched:** `src/vision/feedback/*`, `src/app/*`（临时模拟控件）  
**Estimated scope:** M

### Checkpoint: Core logic

- [ ] 无相机路径：模拟举手 → 事件 → 闪烁 全通
- [ ] Tracker / 排序 / 举手测试全绿
- [ ] 人工确认举手阈值观感可接受（边距/帧数可配置）

---

### Phase 3: 实时视觉管线

#### Task 6: 相机取流与预览

**Description:** `getUserMedia` 封装、错误提示、`<video>` 预览；约束偏向 1080p 推理友好。

**Acceptance criteria:**
- [ ] Chromium 下可选本机 UVC 并显示预览
- [ ] 拒绝权限/无设备时有明确 UI 错误

**Verification:**
- [ ] 手动：插 USB 相机后预览可见
- [ ] `npm run build` 通过

**Dependencies:** Task 1  
**Files likely touched:** `src/vision/camera/*`, `src/app/*`  
**Estimated scope:** S

#### Task 7: MediaPipe 适配器 + 帧循环接线

**Description:** Pose Landmarker 推理；每帧 → 排序 → Tracker；`api.start/stop` 驱动循环；降采样画布。

**Acceptance criteria:**
- [ ] 实人/录像下能检出并编号
- [ ] 举手触发一次 first-raise 并驱动闪烁
- [ ] stop 释放相机与动画帧

**Verification:**
- [ ] 手动：1–2 人举手竞态正确
- [ ] 适配器可用 mock 做集成测（可选但推荐）

**Dependencies:** Tasks 4, 5, 6  
**Files likely touched:** `src/vision/detect/poseAdapter.ts`, `src/vision/api.ts`, `src/vision/detect/pipeline.ts`  
**Estimated scope:** M（逼近上限，控制在 ≤5 文件）

#### Task 8: 演示壳完善

**Description:** `src/app` 接线真实 API：开始/停止、reset、armed 开关；模块注释强调不含计分。

**Acceptance criteria:**
- [ ] 演示页可完整走通 SPEC Success Criteria 1–2
- [ ] 无计分 UI

**Verification:**
- [ ] 手动端到端检查清单（见下）
- [ ] `npm test` && `npm run build`

**Dependencies:** Task 7  
**Files likely touched:** `src/app/main.ts`, `index.html`, `src/vision/README.md`  
**Estimated scope:** S

### Checkpoint: Complete (Vision MVP)

- [ ] SPEC 本模块 Acceptance criteria 全部勾选
- [ ] Definition of Done：测试绿、构建绿、运行时验证、文档已标「视觉识别」
- [ ] 人工验收后再谈 scoring/round 或 `/review`

## End-to-end manual checklist

1. 打开 `npm run dev`，授权相机，见预览与 1–6 槽位  
2. `armed=true`，一人举手 → 对应号闪烁，`onFirstRaise` 仅一次  
3. 另一人再举手 → 不改赢家  
4. `resetDetection` → 可再赛  
5. `armed=false` → 举手不产生赢家  
6. 确认页面无总分/姓名

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| MediaPipe 多人横排漏检/串号 | High | 先单人/双人验证；可配置置信度；>6 截断已定义 |
| 4K 延迟过高 | Med | 默认推理 ≤1080p；跳帧 |
| 举手误触发 | Med | 持续帧数 + 边距可调；Checkpoint 调参 |
| HTTPS/localhost 相机权限 | Low | 文档写明须 localhost 或安全上下文 |

## Parallelization

- Task 5（反馈 UI + 桩）可与 Task 3–4 部分并行  
- Task 6（相机）可与 Task 3–4 并行  
- Task 7 必须等 4+5+6

## Out of scope (reminders)

- `src/scoring/`, `src/round/`  
- 人脸识别、多机位、语音播报

## Open Questions

- 无（跟随 SPEC 定稿）。UI 选 DOM 而非 React：若你希望 React，在批准计划时说明即可。
