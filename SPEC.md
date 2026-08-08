# Spec: 教室抢答 — 视觉识别模块（Vision Recognition）

> **Status:** **定稿 / Approved** — 2026-08-06（用户确认）  
> **Current focus (2026-08-06):** **先把举手行为检测做稳**（`isHandRaised` + 时序防抖）。排序、最先举手、编号闪烁仍在本模块范围内，但排在举手识别稳定之后。  
> **模块定位：** 本文件描述系统的 **视觉识别部分**。  
> 职责边界：相机取流 → 画面处理 → 左到右 1–6 排序 → 举手检测 → 判定最先举手者 → 网页编号闪烁。  
> **不包含** 计分、抢答/下一轮流程、姓名绑定等；那些属于其他解耦模块，通过本模块对外事件/接口接入。

## Objective

在线下教室场景中，用 USB 4K（或兼容 UVC）相机拍摄横排约 6 名学生，在网页中实时给出「谁最先举手」的视觉反馈（对应编号闪烁），供老师观察，并作为后续计分/流程模块的输入信号。

### User stories

1. 作为老师，我能在网页上看到相机实时画面（或处理状态），并看到 1–6 号标识。
2. 作为老师，当有人举手时，我能看到 **最先举手** 的那个编号在网页上闪烁。
3. 作为其他模块的开发者，我能订阅视觉模块发出的「最先举手 = N」事件，而不必嵌入视觉实现细节。

### Acceptance criteria (this module)

- [ ] 能从本机 USB UVC 相机取流并在网页侧展示预览（或明确的「处理中」状态）。
- [ ] 在画面中稳定检出最多 6 人，并按躯干水平位置 **从左到右** 编号为 1–6。
- [ ] 能检测每人的举手状态（基于姿态关键点，非人脸识别）。
- [ ] 在检测窗口内，能判定 **时间上第一个** 进入举手状态的人，并输出其编号 `1..6`。
- [ ] 网页上对应编号出现可感知的闪烁反馈（直至被重置或新一轮判定逻辑覆盖——重置由调用方/其他模块触发时，本模块提供 `reset()` / 清空当前赢家状态）。
- [ ] 对外暴露解耦接口（事件或函数），至少包含：`onFirstRaise(personIndex, meta)`、`resetDetection()`；**不**内置加分逻辑。
- [ ] 不做脸识、不要求姓名、不依赖多机位。

## Tech Stack

**已定技术基线（定稿锁定）：**

1. 运行形态：老师电脑本地 **现代浏览器（Chromium 系优先）** 打开网页；相机经 USB UVC + `getUserMedia` 接入。
2. 视觉方案：**MediaPipe Pose / Tasks Vision（浏览器侧）** 做多人姿态与举手判定；采集可用 4K，推理默认降采样到 **720p 或 1080p** 以保证实时性。
3. 前端：`Vite` + `TypeScript`；UI 可用轻量 DOM 或 React（实现时二选一，保持模块边界清晰）。
4. 视觉模块代码落在 `src/vision/`，与未来的 `scoring/`、`round/` 等并列。

| Layer | Choice |
|-------|--------|
| Language | TypeScript |
| Bundler / Dev | Vite |
| Camera | `navigator.mediaDevices.getUserMedia` (UVC) |
| Pose / raise | MediaPipe Pose Landmarker（或等价浏览器姿态模型） |
| Module bus | 自定义 EventTarget / 回调；后续可换为共享 store，但不在本 spec 强制 |

## Commands

（实现落地后以 `package.json` 为准；目标约定如下。）

```
Dev:    npm run dev
Build:  npm run build
Test:   npm test
Lint:   npm run lint
```

## Project Structure

```
SPEC.md                          → 本规格（视觉识别模块为主；全系统总览可后续拆 docs/SPEC-*.md）
docs/
  intent/hand-raise-vision.md    → 已确认意图（视觉识别）
  worklog/                       → 研发日志
src/
  vision/                        → 【本模块】视觉识别
    camera/                      → 取流、分辨率协商、预览
    detect/                      → 多人检测、左→右排序、举手状态机
    feedback/                    → 编号闪烁 UI（仅视觉反馈）
    api.ts                       → 对外接口：start / stop / reset / onFirstRaise
  app/                           → 本地演示壳（接线 vision；不含正式计分）
tests/
  vision/                        → 排序、举手判定、最先举手竞态 的单元/集成测试
```

未来其他部分（**本 SPEC 不实现**）建议并列：

```
src/scoring/     → 计分展示与累加
src/round/       → 「抢答 / 下一轮」流程臂装
```

## Code Style

- 模块边界：`src/vision` **不得** import 计分或流程业务；反向由 app/其他模块依赖 `vision/api`。
- 编号语义：对外一律使用 **1–6**（不是 0–5）；内部数组可用 0-based，边界处转换。
- 举手判定写纯函数，便于单测；相机与 MediaPipe 用适配器隔离。

```ts
// Good: vision emits a fact; does not mutate scores
export type FirstRaiseEvent = {
  personIndex: 1 | 2 | 3 | 4 | 5 | 6;
  raisedAtMs: number;
};

export interface VisionRecognitionApi {
  start(cameraConstraints?: MediaStreamConstraints): Promise<void>;
  stop(): void;
  /** Clear current winner / re-arm raise race (caller-driven). */
  resetDetection(): void;
  onFirstRaise(handler: (e: FirstRaiseEvent) => void): () => void;
}

function isHandRaised(landmarks: PoseLandmarks): boolean {
  // e.g. wrist.y < shoulder.y - margin (image coords)
  return /* pure predicate */;
}
```

## Testing Strategy

| Level | What | Where |
|-------|------|--------|
| Unit | 左→右排序；举手阈值；同帧多人举手取最早时间戳 | `tests/vision/` |
| Integration | mock 姿态流 → `onFirstRaise` 只触发一次直到 `resetDetection` | `tests/vision/` |
| Manual | 实机 USB 相机：6 人（或录像回放）验证闪烁与编号 | 教室 / 开发机 |

- 框架：Vitest（与 Vite 对齐）。
- 覆盖重点：判定逻辑与竞态；不强制对 MediaPipe WASM 做脆弱 E2E。
- 可用录制视频或 fixture 关键点序列做回归。

## Boundaries

### Always

- 将本模块文档与代码标明为 **视觉识别（Vision Recognition）**。
- 对外只输出「谁先举手」事实与闪烁反馈；计分/流程走其他模块。
- 身份仅用左→右 1–6；禁止引入人脸识别依赖。
- 改举手阈值或排序规则时同步更新本 SPEC 与测试。
- 提交前跑通与本模块相关的测试。

### Ask first

- 换成服务端 OpenCV / 非浏览器推理管线。
- 增加第 7 人、动态人数、或非横排布局。
- 新增重量级依赖（除 MediaPipe / Vite / 测试工具外）。
- 将闪烁 UI 与计分 UI 合并成不可拆页面（破坏解耦）。

### Never

- 在本模块内写死加分、扣分、姓名表。
- 做人脸识别或身份库比对。
- 提交密钥、相机私有录像到仓库（测试用脱敏 fixture）。
- 假设必须永远满 6 人而不定义「不足 6 人」时的行为（见下）。

## Success Criteria

1. 演示页：相机预览 + 1–6 号区域；模拟或真人举手后，**仅最先举手者**编号闪烁。
2. `onFirstRaise` 在一次检测周期内对同一赢家只发射一次；`resetDetection()` 后可再次判定。
3. 单元测试覆盖：排序、举手、双人几乎同时举手时取更早时间戳。
4. README/模块头注释写明：**本目录 = 视觉识别部分**；计分/流程另见其他模块。
5. SPEC 与 `docs/intent/hand-raise-vision.md` 一致。

## Behavior details (vision)

### Person ordering

- 使用每人躯干中心（或双肩中点）的 **图像 x 坐标** 升序 → 编号 1…K（K≤6）。
- 目标布局：单排横向 6 人；若检出不足 6 人，仍按现有人数左→右编号，并在 UI 上标明实际检出人数（不编造空号赢家）。

### Hand raise

- 基于姿态：至少一侧手腕关键点明显高于同侧肩膀（阈值与像素边距可配置）。
- 「举手」需满足最短持续帧数或最短时长，抑制抖动误触发。
- **最先：** 在 `resetDetection()` 之后，第一个满足举手条件的人获胜；其后他人举手不抢占，直到再次 reset。

### Web feedback

- 赢家编号闪烁（CSS animation 即可）；可同时在预览上画框/标号（可选，不阻塞 MVP）。
- 本模块 UI **只**表达视觉结果，不展示总分。

## Resolved decisions（定稿）

1. **人数：** 检出 >6 人时，只取图像 x 坐标最左的 6 个参与编号与举手竞态；不足 6 人则按实检人数左→右编号。
2. **闪烁：** 动画可在约 N 秒后自动停止；**赢家状态保留**直到 `resetDetection()`。
3. **Arm：** 视觉模块提供 `setArmed(boolean)`；默认 `true`（便于单模块演示）；正式抢答流程由其他模块在开局/结束后调用。

## Open Questions

- 无。后续变更须先改本 SPEC 再实现。
