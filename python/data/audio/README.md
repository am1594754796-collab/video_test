# 题库预生成语音（MP3）

读题页**只播放**这里的文件，不再实时调用 CosyVoice。

## 生成

在 `python/` 目录（已配置 `data/api.env` 的 `LLM_API_KEY`）：

```bat
.venv\Scripts\python.exe -m speech_answer.prebuild_audio
```

强制重生成：

```bat
.venv\Scripts\python.exe -m speech_answer.prebuild_audio --force --rate 0.95
```

## 文件约定

相对当前题库 JSON 同级目录下的 `audio/`，例如题库为 `data/answers.json` 时：

| 文件 | 内容 |
|------|------|
| `Q1.mp3` | 题目 Q1 的题干 + 选项（不含标准答案） |
| `raise-countdown.mp3` | 「举手倒计时，三，二，一」 |

改题干或选项后请重新跑预生成。
