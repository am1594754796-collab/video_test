# Vision Recognition（视觉识别）

本目录 = **举手行为检测 / MediaPipe Pose** 视觉模块。

- `detect/isHandRaised.ts` — 腕相对肩的举手谓词  
- `detect/raiseDebouncer.ts` — 连续帧防抖  
- `detect/poseLandmarker.ts` — MediaPipe Pose Landmarker 配置（`VIDEO` + `numPoses`）  
- `camera/` — `getUserMedia`  

不含计分、抢答流程。调参默认：`margin=0.08`，`minFrames=4`（演示页可改）。
