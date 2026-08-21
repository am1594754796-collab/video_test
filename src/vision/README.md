# Vision Recognition（视觉识别）

本目录 = **举手行为检测 / MediaPipe Pose** 视觉模块。

- `detect/isHandRaised.ts` — 腕相对肘的举手谓词（不必过肩）  
- `detect/raiseDebouncer.ts` — 连续帧防抖  
- `detect/faceDetector.ts` / `faceDescriptor.ts` — 人脸框类型 + 会话模板；检测走 **千问 VL**（`/api/vision/detect-faces`）  
- `detect/numberingSlots.ts` — 座位槽位：人脸优先 + 位置兜底  
- `detect/poseLandmarker.ts` — MediaPipe Pose Landmarker 配置（`VIDEO` + `numPoses`）  
- `camera/` — `getUserMedia`  

不含计分、抢答流程。调参默认：`margin=0.05`（腕高于肘），`minFrames=4`（演示页可改）。
人脸绑定为**当次锁定会话**模板，不是姓名/学号底库。需在 `python/data/online.env` 配置千问 VL Key。
