import { publishClassroomEvent } from "./classroomBus";

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
/** Max answering window after press-to-start. */
const ANSWER_LIMIT_MS = 10_000;

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
const countdownEl = document.querySelector<HTMLElement>("#countdown");

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
let answerTimer: number | null = null;
let countdownTimer: number | null = null;
let answerStartedAt = 0;
let timedOut = false;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function showMatchFields(r: MatchResponse, liveText: string): void {
  outTranscript.textContent = liveText || r.transcript || "（空）";
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
  } else if (r.score_semantic === null) {
    parts.push("语义 —");
  }
  outScore.textContent = parts.join(" · ");
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

function clearAnswerTimers(): void {
  if (answerTimer !== null) {
    window.clearTimeout(answerTimer);
    answerTimer = null;
  }
  if (countdownTimer !== null) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (countdownEl) {
    countdownEl.textContent = "限时 10s";
  }
}

function remainingSeconds(): number {
  const left = ANSWER_LIMIT_MS - (Date.now() - answerStartedAt);
  return Math.max(0, Math.ceil(left / 1000));
}

function updateCountdownUi(): void {
  if (!listening || passedLocked) return;
  const sec = remainingSeconds();
  btnRecord.textContent = `按下结束（剩余 ${sec}s）`;
  if (countdownEl) {
    countdownEl.textContent = `剩余 ${sec}s`;
  }
}

function startAnswerDeadline(): void {
  clearAnswerTimers();
  timedOut = false;
  answerStartedAt = Date.now();
  updateCountdownUi();
  countdownTimer = window.setInterval(updateCountdownUi, 200);
  answerTimer = window.setTimeout(() => {
    if (!listening || passedLocked) return;
    timedOut = true;
    setStatus("答题时间到（10s），结束识别…");
    stopListening();
  }, ANSWER_LIMIT_MS);
}

function stopOnPass(matchedText: string): void {
  if (passedLocked) return;
  passedLocked = true;
  frozenTranscript = matchedText.trim();
  clearMatchTimer();
  clearAnswerTimers();
  matchAbort?.abort();
  stopRequested = true;
  outTranscript.textContent = frozenTranscript;
  setStatus(`已通过（限时内），已停止转写 · ${frozenTranscript}`);
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
        ? `已加载 ${answersPathInput.value}（${n} 题）。可选题后开始识别`
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
      setStatus(`匹配通过（≥90%）· ${text}`);
      publishClassroomEvent({
        type: "answer-passed",
        questionId,
        transcript: text,
        source: "speech-online",
      });
      if (listening) {
        stopOnPass(text);
      }
      return;
    }
    if (listening) {
      const sec = remainingSeconds();
      setStatus(`实时匹配 ${(body.score * 100).toFixed(0)}% · 剩余 ${sec}s · ${text}`);
    } else if (timedOut) {
      setStatus(`时间到（10s）· 未通过 · ${text}`);
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
  clearAnswerTimers();
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
  timedOut = false;
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
    const sec = remainingSeconds();
    setStatus(live ? `实时转写（剩余 ${sec}s）：${live}` : `正在听… 剩余 ${sec}s`);
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
    const wasTimeout = timedOut;
    const text = liveText();
    clearMatchTimer();
    clearAnswerTimers();
    resetListeningUi();
    if (alreadyPassed) {
      if (frozenTranscript) {
        outTranscript.textContent = frozenTranscript;
      }
      return;
    }
    if (wasStop && text) {
      void matchNow(text, { force: true }).then(() => {
        if (wasTimeout && !passedLocked) {
          // matchNow may have updated status; reinforce timeout context if still failing
        }
      });
    } else if (wasStop && !text) {
      setStatus(wasTimeout ? "时间到（10s），没有识别到有效语音" : "没有识别到有效语音");
    }
  };

  rec.start();
  listening = true;
  btnRecord.classList.add("recording");
  questionSelect.disabled = true;
  startAnswerDeadline();
  setStatus("已开始 · 限时 10s · 通过或超时均自动结束");
}

function stopListening(): void {
  if (!recognition) return;
  stopRequested = true;
  clearAnswerTimers();
  if (!timedOut) {
    setStatus("结束听写…");
  }
  try {
    recognition.stop();
  } catch {
    const text = liveText();
    clearMatchTimer();
    resetListeningUi();
    if (text) void matchNow(text, { force: true });
  }
}

btnLoadBank.addEventListener("click", () => {
  void loadAnswerBankFromInput();
});

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
    setStatus(
      `答案库：${answersPathInput.value} · 选题后按下开始（相对路径可改后点「加载答案库」）`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`加载题目失败：${msg}`);
    btnRecord.disabled = true;
  }
}

void boot();
