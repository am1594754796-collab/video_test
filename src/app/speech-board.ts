type Question = { id: string; answer: string };

type MatchResponse = {
  question_id: string;
  transcript: string;
  expected: string;
  score: number;
  passed: boolean;
  score_char?: number;
  score_pinyin?: number;
  score_semantic?: number | null;
};

const questionSelect = document.querySelector<HTMLSelectElement>("#question-select")!;
const answersPathInput = document.querySelector<HTMLInputElement>("#answers-path")!;
const btnLoadBank = document.querySelector<HTMLButtonElement>("#btn-load-bank")!;
const btnRecord = document.querySelector<HTMLButtonElement>("#btn-record")!;
const apiStatus = document.querySelector<HTMLElement>("#api-status")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const outTranscript = document.querySelector<HTMLElement>("#out-transcript")!;
const outExpected = document.querySelector<HTMLElement>("#out-expected")!;
const outScore = document.querySelector<HTMLElement>("#out-score")!;
const outPassed = document.querySelector<HTMLElement>("#out-passed")!;

let mediaStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let recording = false;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function pickMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

function extensionForMime(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  return "webm";
}

function showResult(r: MatchResponse): void {
  outTranscript.textContent = r.transcript || "（空）";
  outExpected.textContent = r.expected;
  const parts = [`总分 ${(r.score * 100).toFixed(1)}%`];
  if (typeof r.score_char === "number") {
    parts.push(`字形 ${(r.score_char * 100).toFixed(0)}%`);
  }
  if (typeof r.score_pinyin === "number") {
    parts.push(`拼音 ${(r.score_pinyin * 100).toFixed(0)}%`);
  }
  if (typeof r.score_semantic === "number") {
    parts.push(`语义 ${(r.score_semantic * 100).toFixed(0)}%`);
  }
  outScore.textContent = parts.join(" · ");
  outPassed.textContent = r.passed ? "通过" : "未通过";
  outPassed.className = `pill ${r.passed ? "ok" : "bad"}`;
}

async function refreshHealth(): Promise<boolean> {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) throw new Error(String(res.status));
    apiStatus.textContent = "Python API: 已连接";
    apiStatus.className = "api-status ok";
    return true;
  } catch {
    apiStatus.textContent = "Python API: 未连接（需 8765）";
    apiStatus.className = "api-status bad";
    return false;
  }
}

async function loadQuestions(): Promise<void> {
  const res = await fetch("/api/speech/questions");
  if (!res.ok) throw new Error(`questions ${res.status}`);
  const data = (await res.json()) as {
    questions: Question[];
    relative_path?: string;
  };
  if (data.relative_path) {
    answersPathInput.value = data.relative_path.replace(/\\/g, "/");
  }
  questionSelect.innerHTML = "";
  for (const q of data.questions) {
    const opt = document.createElement("option");
    opt.value = q.id;
    opt.textContent = `${q.id} · 答案：${q.answer}`;
    questionSelect.appendChild(opt);
  }
  if (data.questions.length === 0) {
    setStatus("答案库为空");
    btnRecord.disabled = true;
  } else {
    btnRecord.disabled = false;
  }
}

async function loadAnswerBankFromInput(): Promise<void> {
  const path = answersPathInput.value.trim();
  if (!path) {
    setStatus("请填写答案库相对路径，例如 data/answers.json");
    return;
  }
  setStatus(`加载答案库：${path} …`);
  btnLoadBank.disabled = true;
  try {
    const res = await fetch("/api/speech/bank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, persist: true }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      relative_path?: string;
      questions?: Question[];
      detail?: string;
    };
    if (!res.ok) {
      throw new Error(body.detail || `HTTP ${res.status}`);
    }
    if (body.relative_path) {
      answersPathInput.value = body.relative_path.replace(/\\/g, "/");
    }
    questionSelect.innerHTML = "";
    for (const q of body.questions ?? []) {
      const opt = document.createElement("option");
      opt.value = q.id;
      opt.textContent = `${q.id} · 答案：${q.answer}`;
      questionSelect.appendChild(opt);
    }
    const n = body.questions?.length ?? 0;
    btnRecord.disabled = n === 0;
    setStatus(
      n > 0
        ? `已加载 ${answersPathInput.value}（${n} 题）`
        : "答案库为空",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`加载答案库失败：${msg}`);
    btnRecord.disabled = true;
  } finally {
    btnLoadBank.disabled = false;
  }
}

async function startRecording(): Promise<void> {
  const mime = pickMimeType();
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
  chunks = [];
  mediaRecorder = mime
    ? new MediaRecorder(mediaStream, { mimeType: mime })
    : new MediaRecorder(mediaStream);

  mediaRecorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };

  mediaRecorder.start(250);
  recording = true;
  btnRecord.textContent = "按下结束并识别";
  btnRecord.classList.add("recording");
  questionSelect.disabled = true;
  setStatus("录音中… 再说一次后按下结束");
}

async function stopAndMatch(): Promise<void> {
  const recorder = mediaRecorder;
  if (!recorder) return;

  const mime = recorder.mimeType || "audio/webm";
  const blob: Blob = await new Promise((resolve, reject) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mime }));
    };
    recorder.onerror = () => reject(new Error("MediaRecorder error"));
    recorder.stop();
  });

  mediaStream?.getTracks().forEach((t) => t.stop());
  mediaStream = null;
  mediaRecorder = null;
  recording = false;
  btnRecord.classList.remove("recording");
  btnRecord.textContent = "按下开始录音";
  questionSelect.disabled = false;

  if (blob.size < 64) {
    setStatus("录音太短，请重试");
    return;
  }

  const questionId = questionSelect.value;
  if (!questionId) {
    setStatus("请先选择题目");
    return;
  }

  setStatus("识别中（首次加载 Whisper 可能较慢）…");
  btnRecord.disabled = true;

  const form = new FormData();
  form.append("question_id", questionId);
  form.append("audio", blob, `answer.${extensionForMime(mime)}`);

  try {
    const res = await fetch("/api/speech/match", { method: "POST", body: form });
    const body = (await res.json().catch(() => ({}))) as MatchResponse & { detail?: string };
    if (!res.ok) {
      throw new Error(body.detail || `HTTP ${res.status}`);
    }
    showResult(body);
    setStatus(body.passed ? "匹配通过（≥90%）" : "未达到 90% 匹配");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`识别失败：${msg}`);
    outPassed.textContent = "错误";
    outPassed.className = "pill bad";
  } finally {
    btnRecord.disabled = false;
  }
}

btnLoadBank.addEventListener("click", () => {
  void loadAnswerBankFromInput();
});

btnRecord.addEventListener("click", async () => {
  if (recording) {
    await stopAndMatch();
    return;
  }
  try {
    await startRecording();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`无法打开麦克风：${msg}`);
  }
});

async function boot(): Promise<void> {
  const ok = await refreshHealth();
  if (!ok) {
    setStatus("请先启动 Python API（8765），然后刷新本页");
    btnRecord.disabled = true;
    return;
  }
  try {
    await loadQuestions();
    setStatus(
      `答案库：${answersPathInput.value} · 选题后按下录音（可改相对路径后点「加载答案库」）`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`加载题目失败：${msg}`);
    btnRecord.disabled = true;
  }
}

void boot();
