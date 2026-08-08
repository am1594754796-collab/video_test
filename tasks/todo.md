# Todo: 视觉识别模块

依据：`SPEC.md`（定稿）+ `tasks/plan.md`  
范围：仅 Vision Recognition；不含计分/抢答流程。

**Current focus:** 举手行为检测做稳（P0）。完整抢答链路（最先 / 闪烁）为 P1。

## P0 — 举手行为检测做稳

- [x] **T1-lite** 最小脚手架（Vite/TS/Vitest，够跑测试与后续预览即可）
  - Acceptance: `npm test` / `npm run build` 可用
  - Verify: 命令成功

- [x] **T3a** `isHandRaised` 纯函数 + 边界单测（边距、单侧/双侧、临界）
  - Acceptance: 明显举手/放下 case 正确；参数可配置
  - Verify: `npm test` 针对举手用例

- [x] **T3b** 举手时序防抖（连续 N 帧 / 最短时长才翻转 `raised`）
  - Acceptance: 单帧抖动不翻转；稳定举手后为 true，放下后为 false
  - Verify: 防抖单测

- [x] **T6+T7-slice** 相机 + MediaPipe → 每人/单人 `raised` 实时预览（调试用，可先 1 人）
  - Acceptance: 实机举手/放下与状态一致，误报可接受并记下调参
  - Verify: 手动实机；记下 margin / minFrames
  - Note: 代码已接线；需用户本机 `npm run dev` 做实机确认

### Checkpoint — Hand raise stable
- [ ] 单测绿；实机举手识别稳定；调参写入注释或 config
- [ ] 人工确认「举手检测够稳」后再做 P1

## P1 — 完整视觉模块（举手稳定之后）

## Phase 1 — Foundation（补全契约）

- [ ] **T2** 类型 + `VisionRecognitionApi` 契约与可测桩
  - Acceptance: `start/stop/resetDetection/onFirstRaise/setArmed`；编号 1–6
  - Verify: 桩单测
  - Files: `src/vision/api.ts`, `src/vision/types.ts`, `tests/vision/api.stub.test.ts`

### Checkpoint — Foundation
- [ ] 构建与测试绿；API 形状人工确认

## Phase 2 — 判定核心（无相机）

- [ ] **T3c** `orderPeople` 纯函数与测试
  - Acceptance: >6 取最左 6；举手谓词已在 P0
  - Verify: 相关 `npm test`
  - Files: `src/vision/detect/orderPeople.ts`, `tests/vision/*`

- [ ] **T4** `FirstRaiseTracker`（armed / 防抖 / first-wins / reset）
  - Acceptance: 最早举手胜；armed=false 不产出；reset 可再赛
  - Verify: 竞态单测
  - Files: `src/vision/detect/firstRaiseTracker.ts`, `tests/vision/firstRaiseTracker.test.ts`

- [ ] **T5** 编号闪烁反馈 UI（可接桩模拟）
  - Acceptance: 仅赢家闪烁；reset 清状态；显示检出人数
  - Verify: 手动模拟 3 号举手
  - Files: `src/vision/feedback/*`, `src/app/*`

### Checkpoint — Core logic
- [ ] 无相机：模拟 → 事件 → 闪烁；测试全绿

## Phase 3 — 实时管线

- [ ] **T6** 相机 `getUserMedia` + 预览 + 错误态
  - Acceptance: UVC 预览；权限失败有提示
  - Verify: 实机预览；`npm run build`
  - Files: `src/vision/camera/*`, `src/app/*`

- [ ] **T7** MediaPipe 适配器 + 帧循环接线 API
  - Acceptance: 实人检出编号；举手触发一次；stop 释放资源
  - Verify: 手动 1–2 人竞态；可选 mock 集成测
  - Files: `poseAdapter.ts`, `pipeline.ts`, `api.ts`（≤5 files）

- [ ] **T8** 演示壳完善（start/stop/reset/armed，无计分）
  - Acceptance: SPEC Success Criteria 1–2；文档标明视觉识别
  - Verify: E2E 手动清单；`npm test` && `npm run build`
  - Files: `src/app/main.ts`, `index.html`, `src/vision/README.md`

### Checkpoint — Vision MVP Complete
- [ ] SPEC 本模块验收项全部满足
- [ ] Definition of Done 通过
- [ ] 人工验收通过后再开 scoring/round 或 `/review`
