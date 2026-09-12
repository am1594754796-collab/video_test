# Vision Recognition（视觉识别）

本目录 = **举手行为检测** 视觉模块。

视频页人体：`MediaPipe 多人 Pose 左→右编号 → 近距切开 ROI 放大 → 单人 Pose → 严格举手`（无千问）。
- `detect/personSplit.ts` — 关节点成框、近距 mid-split、左→右编号
- `detect/personMpCascade.ts` — 每人放大 ROI → Pose
- `detect/cascadePose.ts` — ROI → Pose，坐标映射回整帧

相机快版与视频页同方案：`MediaPipe 多人分割编号 → 近距切开 ROI → 单人 Pose → 严格举手`（无千问）。
- `detect/qwenMpCascade.ts` — 旧千问级联（仍导出，页面已不再使用）

- `detect/isHandRaised.ts` — MediaPipe Pose 关节点举手（左右独立）：腕过肩 / 贴头 + 拒邻居腕 / 拒斜肩侧臂  
- `detect/raiseSignal.ts` — 姿态 EMA 平滑 + `isHandRaised` + 连续 N 帧确认 + 抢答时刻  
- `detect/raiseDebouncer.ts` — 连续帧防抖  
- `detect/faceDetector.ts` / `faceDescriptor.ts` — 人脸框类型 + 会话模板；检测走 **千问 VL**（`/api/vision/detect-faces`）  
- `detect/numberingSlots.ts` — 座位槽位：人脸优先 + 位置兜底  
- `detect/poseLandmarker.ts` — MediaPipe Pose Landmarker 配置（`VIDEO` + `numPoses`）  
- `camera/` — `getUserMedia`  

不含计分、抢答流程。调参默认：`margin=0.04`（腕高于肩），`minFrames=8`。
人脸绑定为**当次锁定会话**模板，不是姓名/学号底库。需在 `python/data/online.env` 配置千问 VL Key。
