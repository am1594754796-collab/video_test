# Vision Recognition（视觉识别）

本目录 = **举手牌检测** 视觉模块。编号走 MediaPipe Pose（**上半身即可**，桌子挡住下肢也行）；举手以手腕附近的白色牌为主、弱姿态为辅。不做人脸检测。

广角教室场景会先对桌前区域做 ROI 放大再跑 Pose，避免人在全幅里太小检不到。

视频页与相机快版同一条链路：`MediaPipe 多人 Pose 左→右编号 → 近距切开 ROI 放大 → 单人 Pose → 牌色+弱姿态举牌`。

六个座位均使用白色举手牌；座位身份由锁定后的 Pose 位置确定。

- `detect/personPoseQuality.ts` — 过滤椅子/杂物假阳性（头+双肩；髋仅在高可见时辅助）
- `detect/personSplit.ts` — 关节点成框、近距 mid-split、左→右编号
- `detect/personMpCascade.ts` — 每人放大 ROI → Pose
- `detect/cascadePose.ts` — ROI → Pose，坐标映射回整帧
- `detect/paddleColors.ts` — 座位 → 举手牌颜色
- `detect/paddleSignal.ts` — 帧内牌色局部密度 + 弱姿态融合
- `detect/isHandRaised.ts` — MediaPipe Pose 关节点举手（调试 / `requirePaddle:false`）
- `detect/raiseSignal.ts` — 姿态 EMA + 牌色融合 + 连续 N 帧确认 + 抢答时刻
- `detect/raiseDebouncer.ts` — 连续帧防抖
- `detect/numberingSlots.ts` — 座位槽位：按位置保持编号
- `detect/poseLandmarker.ts` — MediaPipe Pose Landmarker 配置（`VIDEO` + `numPoses`）
- `camera/` — `getUserMedia`

不含计分、抢答流程。默认先看手腕附近白色举手牌；牌色弱或读不到帧时，回退到清晰的 Pose 抬腕判定。首个符合条件的检测帧确认。
