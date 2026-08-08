type Question = { id: string; answer: string };

type MatchResponse = {
  question_id: string;
  transcript: string;
  expected: string;
  score: number;
  passed: boolean;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const MATCH_DEBOUNCE_MS = 280;

const questionSelect = document.querySelector<HTMLSelectElement>("#question-select")!;
const btnRecord = document.querySelector<HTMLButtonElement>("#btn-record")!;
const apiStatus = document.querySelector<HTMLElement>("#api-status")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const outTranscript = document.querySelector<HTMLElement>("#out-transcript")!;
const outExpected = document.querySelector<HTMLElement>("#out-expected")!;
const outScore = document.querySelector<HTMLElement>("#out-score")!;
const outPassed = document.querySelector<HTMLElement>("#out-passed")!;

let recognition: SpeechRecognitionLike | null = null;
let listening = false;
let finalTranscript = "";
let interimTranscript = "";
let stopRequested = false;
/** Stop ASR as soon as match passes; ignore further speech. */
let passedLocked = false;
let frozenTranscript = "";
let matchTimer: number | null = null;
let matchAbort: AbortController | null = null;
let lastMatchedText = "";

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function showMatchFields(r: MatchResponse, liveText: string): void {
  // Keep the live caption visible; server echo may lag behind interim text.
  outTranscript.textContent = liveText || r.transcript || "（空）";
  outExpected.textContent = r.expected;
  outScore.textContent = `${(r.score * 100).toFixed(1)}%`;
  outPassed.textContent = r.passed ? "通过" : "未通过";
  outPassed.className = `pill ${r.passed ? "ok" : "bad"}`;
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function liveText(): string {
  if (passedLocked && frozenTranscript) return frozenTranscript;
  return `${finalTranscript}${interimTranscript}`.trim();
}

function clearMatchTimer(): void {
  if (matchTimer !== null) {
    window.clearTimeout(matchTimer);
    matchTimer = null;
  }
}

function stopOnPass(matchedText: string): void {
  if (passedLocked) return;
  passedLocked = true;
  frozenTranscript = matchedText.trim();
  clearMatchTimer();
  matchAbort?.abort();
  stopRequested = true;
  outTranscript.textContent = frozenTranscript;
  setStatus(`已通过，已停止转写 · ${frozenTranscript}`);
  try {
    recognition?.stop();
  } catch {
    resetListeningUi();
  }
}

async function refreshHealth(): Promise<boolean> {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) throw new Error(String(res.status));
    apiStatus.textContent = "Python 匹配 API: 已连接 · 在线 ASR";
    apiStatus.className = "api-status ok";
    return true;
  } catch {
    apiStatus.textContent = "Python API: 未连接（匹配需 8765）";
    apiStatus.className = "api-status bad";
    return false;
  }
}

async function loadQuestions(): Promise<void> {
  const res = await fetch("/api/speech/questions");
  if (!res.ok) throw new Error(`questions ${res.status}`);
  const data = (await res.json()) as { questions: Question[] };
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
  }
}

async function matchNow(transcript: string, opts?: { force?: boolean }): Promise<void> {
  if (passedLocked && !opts?.force) return;

  const force = opts?.force ?? false;
  const questionId = questionSelect.value;
  if (!questionId) return;

  const text = transcript.trim();
  if (!text) return;
  if (!force && text === lastMatchedText) return;

  matchAbort?.abort();
  const ac = new AbortController();
  matchAbort = ac;

  try {
    const res = await fetch("/api/speech/match-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: questionId, transcript: text }),
      signal: ac.signal,
    });
    const body = (await res.json().catch(() => ({}))) as MatchResponse & { detail?: string };
    if (!res.ok) {
      throw new Error(body.detail || `HTTP ${res.status}`);
    }
    // A newer utterance may have already locked pass; drop stale responses.
    if (passedLocked) return;

    lastMatchedText = text;
    showMatchFields(body, text);
    if (body.passed) {
      setStatus(`匹配通过（≥90%，含同音）· ${text}`);
      if (listening) {
        stopOnPass(text);
      }
      return;
    }
    if (listening) {
      setStatus(`实时匹配 ${(body.score * 100).toFixed(0)}% · ${text}`);
    } else {
      setStatus("未达到 90% 匹配");
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    const msg = err instanceof Error ? err.message : String(err);
    if (!listening && !passedLocked) {
      setStatus(`匹配失败：${msg}`);
      outPassed.textContent = "错误";
      outPassed.className = "pill bad";
    }
  }
}

function scheduleLiveMatch(text: string): void {
  if (passedLocked) return;
  clearMatchTimer();
  matchTimer = window.setTimeout(() => {
    matchTimer = null;
    void matchNow(text);
  }, MATCH_DEBOUNCE_MS);
}

function resetListeningUi(): void {
  listening = false;
  stopRequested = false;
  recognition = null;
  btnRecord.classList.remove("recording");
  btnRecord.textContent = "按下开始识别";
  questionSelect.disabled = false;
}

function startListening(): void {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    setStatus("当前浏览器不支持 Web Speech，请用 Chrome / Edge");
    return;
  }

  finalTranscript = "";
  interimTranscript = "";
  stopRequested = false;
  passedLocked = false;
  frozenTranscript = "";
  lastMatchedText = "";
  clearMatchTimer();
  matchAbort?.abort();

  outTranscript.textContent = "…";
  outScore.textContent = "—";
  outPassed.textContent = "听写中";
  outPassed.className = "pill idle";

  const rec = new Ctor();
  recognition = rec;
  rec.lang = "zh-CN";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onresult = (ev) => {
    if (passedLocked) return;

    let interim = "";
    let finals = finalTranscript;
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const piece = ev.results[i]![0]!.transcript;
      if (ev.results[i]!.isFinal) {
        finals += piece;
      } else {
        interim += piece;
      }
    }
    finalTranscript = finals;
    interimTranscript = interim;
    const live = `${finals}${interim}`.trim();
    outTranscript.textContent = live || "…";
    setStatus(live ? `实时转写：${live}` : "正在听…");
    if (live) {
      scheduleLiveMatch(live);
    }
  };

  rec.onerror = (ev) => {
    if (ev.error === "aborted" || ev.error === "no-speech") return;
    if (passedLocked) return;
    setStatus(`在线识别错误：${ev.error}`);
  };

  rec.onend = () => {
    const wasStop = stopRequested;
    const alreadyPassed = passedLocked;
    const text = liveText();
    clearMatchTimer();
    resetListeningUi();
    if (alreadyPassed) {
      // Keep frozen pass result; do not resume ASR or rematch with trailing speech.
      if (frozenTranscript) {
        outTranscript.textContent = frozenTranscript;
      }
      return;
    }
    if (wasStop && text) {
      void matchNow(text, { force: true });
    } else if (wasStop && !text) {
      setStatus("没有识别到有效语音");
    }
  };

  rec.start();
  listening = true;
  btnRecord.textContent = "按下结束";
  btnRecord.classList.add("recording");
  questionSelect.disabled = true;
  setStatus("已开始实时转写与匹配…");
}

function stopListening(): void {
  if (!recognition) return;
  stopRequested = true;
  setStatus("结束听写…");
  try {
    recognition.stop();
  } catch {
    const text = liveText();
    clearMatchTimer();
    resetListeningUi();
    if (text) void matchNow(text, { force: true });
  }
}

btnRecord.addEventListener("click", () => {
  if (listening) {
    stopListening();
    return;
  }
  startListening();
});

async function boot(): Promise<void> {
  if (!getSpeechRecognitionCtor()) {
    apiStatus.textContent = "不支持 Web Speech（请用 Chrome/Edge）";
    apiStatus.className = "api-status bad";
    btnRecord.disabled = true;
    setStatus("请换 Chromium 系浏览器再试在线识别");
    return;
  }

  const ok = await refreshHealth();
  if (!ok) {
    setStatus("请先启动 Python API（8765）用于答案匹配，然后刷新");
    btnRecord.disabled = true;
    return;
  }
  try {
    await loadQuestions();
    setStatus("请选择题目，按下后即时转写并实时匹配（需联网）");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`加载题目失败：${msg}`);
    btnRecord.disabled = true;
  }
}

void boot();
