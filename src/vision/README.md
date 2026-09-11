# Vision Recognition（视觉识别）

本目录 = **举手行为检测** 视觉模块。

人体：`千问 VL（人脸编号）→ 按人放大 ROI → MediaPipe Pose（单目标）`。
- `detect/qwenMpCascade.ts` — 千问编号后人脸扩成单人框再跑 Pose
- `detect/cascadePose.ts` — ROI → Pose，坐标映射回整帧

- `detect/isHandRaised.ts` — 本人弯臂举手（左右独立）：腕过肩 + 肘弯曲 + 拒绝旁边人的手腕  
- `detect/raiseDebouncer.ts` — 连续帧防抖  
- `detect/faceDetector.ts` / `faceDescriptor.ts` — 人脸框类型 + 会话模板；检测走 **千问 VL**（`/api/vision/detect-faces`）  
- `detect/numberingSlots.ts` — 座位槽位：人脸优先 + 位置兜底  
- `detect/poseLandmarker.ts` — MediaPipe Pose Landmarker 配置（`VIDEO` + `numPoses`）  
- `camera/` — `getUserMedia`  

不含计分、抢答流程。调参默认：`margin=0.04`（腕高于肩），`minFrames=8`。
人脸绑定为**当次锁定会话**模板，不是姓名/学号底库。需在 `python/data/online.env` 配置千问 VL Key。
