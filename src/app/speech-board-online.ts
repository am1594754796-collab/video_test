import {
  fillQuestionSelect,
  findQuestion,
  renderQuestionPreview,
  type BankQuestion,
} from "./questionUi";
import {
  publishClassroomEvent,
  subscribeClassroomEvents,
  type ClassroomEvent,
} from "./classroomBus";
import { speakQuestion, speakRaiseHandCountdown, stopSpeaking } from "./speakQuestion";
import { BackgroundRaiseSession } from "./backgroundRaiseDetect";
import { RaiseRaceRound } from "../round";
import {
  expectedChoiceLetter,
  listenForChoice,
  type ChoiceLetter,
} from "../speech";

const BUS_SOURCE = "speech-online";
const INITIAL_SCORE = 0;
const ANSWER_RESULT_DISPLAY_MS = 5000;

type Question = BankQuestion;

const questionSelect = document.querySelector<HTMLSelectElement>("#question-select")!;
const speakRate = document.querySelector<HTMLInputElement>("#speak-rate");
const speakRateValue = document.querySelector<HTMLElement>("#speak-rate-value");
const answersPathInput = document.querySelector<HTMLInputElement>("#answers-path")!;
const btnLoadBank = document.querySelector<HTMLButtonElement>("#btn-load-bank")!;
const btnSpeak = document.querySelector<HTMLButtonElement>("#btn-speak");
const btnSpeakStop = document.querySelector<HTMLButtonElement>("#btn-speak-stop");
const apiStatus = document.querySelector<HTMLElement>("#api-status")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const questionPreview = document.querySelector<HTMLElement>("#question-preview");
const raiseCountdown = document.querySelector<HTMLElement>("#raise-countdown");
const raceBanner = document.querySelector<HTMLElement>("#race-banner");
const scoreDemo = document.querySelector<HTMLElement>("#score-demo");
const detectStatusEl = document.querySelector<HTMLElement>("#detect-status");
const bgVideo = document.querySelector<HTMLVideoElement>("#bg-video")!;
const expectedCountInput = document.querySelector<HTMLInputElement>("#expected-count")!;
const btnRestartVision = document.querySelector<HTMLButtonElement>("#btn-restart-vision")!;

let questions: Question[] = [];
const race = new RaiseRaceRound();
const scores = new Map<number, number>();
let bannerTimer = 0;
let detect: BackgroundRaiseSession | null = null;
/** Prevents overlapping listen / auto-advance. */
let answerSessionActive = false;
let listenAbort: AbortController | null = null;
/** Skip change→speak when we set select.value during auto-next. */
let suppressSelectSpeak = false;
let speakingOrCountdown = false;
let visionStarting = false;
let roundVersion = 0;

function updateStartAvailability(): void {
  if (!btnSpeak) return;
  const selected = questions.find((q) => q.id === questionSelect.value);
  btnSpeak.disabled = !detect?.locked || !selected?.has_audio || !expectedChoiceLetter(selected);
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function setDetectStatus(text: string): void {
  if (detectStatusEl) detectStatusEl.textContent = text;
}

function hideRaiseCountdown(): void {
  if (!raiseCountdown) return;
  raiseCountdown.hidden = true;
  raiseCountdown.textContent = "";
}

function showRaiseCountdown(n: 3 | 2 | 1 | "go"): void {
  if (!raiseCountdown) return;
  raiseCountdown.hidden = false;
  raiseCountdown.textContent = n === "go" ? "举手" : String(n);
}

function showBanner(kind: "early" | "win" | "open", text: string, holdMs = 2800): void {
  if (!raceBanner) return;
  window.clearTimeout(bannerTimer);
  raceBanner.hidden = false;
  raceBanner.className = `race-banner ${kind}`;
  raceBanner.textContent = text;
  if (holdMs > 0) {
    bannerTimer = window.setTimeout(() => {
      if (kind === "win") return;
      raceBanner.hidden = true;
    }, holdMs);
  }
}

function clearBanner(): void {
  if (!raceBanner) return;
  window.clearTimeout(bannerTimer);
  raceBanner.hidden = true;
  raceBanner.textContent = "";
  raceBanner.className = "race-banner";
}

function renderScores(highlight?: { index: number; kind: "penalty" | "winner" }): void {
  if (!scoreDemo) return;
  scoreDemo.innerHTML = "";
  const seats = [...scores.keys()].sort((a, b) => a - b);
  for (const index of seats) {
    const li = document.createElement("li");
    if (highlight?.index === index) li.classList.add(highlight.kind);
    li.innerHTML = `<div class="num">#${index}</div><div class="pts">${scores.get(index) ?? 0}</div>`;
    scoreDemo.appendChild(li);
  }
}

function publishScores(): void {
  publishClassroomEvent({
    type: "scores-snapshot",
    scores: Object.fromEntries(scores),
    source: BUS_SOURCE,
  });
}

function seedScores(seats: number[]): void {
  scores.clear();
  for (const s of seats) scores.set(s, INITIAL_SCORE);
  renderScores();
  publishScores();
}

function applyRaceOut(
  events: ReturnType<RaiseRaceRound["feed"]>,
): void {
  for (const e of events) {
    if (e.type === "early-raise") {
      const prev = scores.get(e.personIndex) ?? INITIAL_SCORE;
      const next = Math.max(0, prev - 1);
      scores.set(e.personIndex, next);
      renderScores({ index: e.personIndex, kind: "penalty" });
      showBanner("early", `#${e.personIndex} 提前举手 · 扣 1 分 → ${next}`);
      setStatus(`提前抢答 · #${e.personIndex} 扣分（演示）`);
      publishClassroomEvent({
        type: "early-raise",
        personIndex: e.personIndex,
        atMs: e.atMs,
        source: BUS_SOURCE,
      });
      publishScores();
    } else if (e.type === "winner") {
      renderScores({ index: e.personIndex, kind: "winner" });
      showBanner("win", `#${e.personIndex} 抢答成功`, 0);
      setStatus(`抢答成功 · #${e.personIndex} · 开始听答`);
      publishClassroomEvent({
        type: "first-raise",
        personIndex: e.personIndex,
        source: BUS_SOURCE,
      });
      void beginAnswerListen(e.personIndex);
    }
  }
}

function abortListen(): void {
  listenAbort?.abort();
  listenAbort = null;
}

function abortRound(): void {
  roundVersion++;
  abortListen();
  answerSessionActive = false;
  race.resetToIdle();
  speakingOrCountdown = false;
  clearBanner();
  publishClassroomEvent({ type: "raise-round-abort", source: BUS_SOURCE });
  publishClassroomEvent({ type: "race-reset", source: BUS_SOURCE });
}

function applyAnswerScore(
  personIndex: number,
  passed: boolean,
): number {
  const prev = scores.get(personIndex) ?? INITIAL_SCORE;
  const next = Math.max(0, prev + (passed ? 1 : -1));
  scores.set(personIndex, next);
  renderScores({ index: personIndex, kind: passed ? "winner" : "penalty" });
  return next;
}

async function beginAnswerListen(personIndex: number): Promise<void> {
  if (answerSessionActive) return;
  if (race.phase !== "locked") return;
  const q = findQuestion(questions, questionSelect.value);
  if (!q) {
    setStatus("抢答成功，但没有当前题目，无法听答");
    return;
  }
  const expected = expectedChoiceLetter(q);
  if (!expected) {
    setStatus(`${q.id} 无法映射标准答案到 A–D，请检查题库 options/answer`);
    return;
  }

  answerSessionActive = true;
  const activeVersion = roundVersion;
  abortListen();
  listenAbort = new AbortController();
  showBanner("win", `#${personIndex} 请说 A / B / C / D`, 0);
  setStatus(`#${personIndex} 听答中 · 期望选项已锁定 · 每 5 秒一轮，取最后一次`);

  const result = await listenForChoice({
    signal: listenAbort.signal,
    onWaiting: () => {
      setStatus(`#${personIndex} 未听清选项 · 继续听（再说一次 A–D）`);
    },
    onTranscript: (text, letter) => {
      const hint = letter ? `当前识别：${letter}` : "等待 A–D…";
      setStatus(`#${personIndex} 听答中 · ${hint}${text ? ` ·「${text.slice(-24)}」` : ""}`);
    },
  });

  listenAbort = null;

  if (!result.ok) {
    answerSessionActive = false;
    if (result.reason === "aborted") return;
    setStatus(result.message ?? `听答失败：${result.reason}`);
    showBanner("early", result.message ?? "听答失败", 3200);
    return;
  }

  const letter = result.letter as ChoiceLetter;
  const passed = letter === expected;
  const nextScore = applyAnswerScore(personIndex, passed);
  publishClassroomEvent({
    type: "answer-result",
    passed,
    letter,
    personIndex,
    questionId: q.id,
    transcript: result.transcript,
    source: BUS_SOURCE,
  });
  publishScores();

  const verdict = passed ? "答对 +1" : `答错 −1（说了 ${letter}，应为 ${expected}）`;
  showBanner(passed ? "win" : "early", `#${personIndex} ${verdict} → ${nextScore}`, ANSWER_RESULT_DISPLAY_MS);
  setStatus(`#${personIndex} ${verdict} → ${nextScore} · 展示 5 秒后自动进入下一题`);

  await sleep(ANSWER_RESULT_DISPLAY_MS);
  if (activeVersion !== roundVersion) return;
  answerSessionActive = false;
  await advanceToNextQuestion();
}

async function advanceToNextQuestion(): Promise<void> {
  publishClassroomEvent({ type: "race-reset", source: BUS_SOURCE });
  const curId = questionSelect.value;
  const idx = questions.findIndex((q) => q.id === curId);
  const next = idx >= 0 ? questions[idx + 1] : undefined;
  if (!next) {
    race.resetToIdle();
    setStatus(`题库已结束（最后一题 ${curId}）· 可手动选题重来`);
    showBanner("open", "题库结束", 4000);
    return;
  }
  suppressSelectSpeak = true;
  questionSelect.value = next.id;
  syncPreviewFromSelect();
  suppressSelectSpeak = false;
  race.resetToIdle();
  clearBanner();
  setStatus(`自动进入 ${next.id} · 开始读题`);
  await onSpeakQuestion();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

function onBusEvent(event: ClassroomEvent): void {
  if (event.type === "scores-snapshot-request") {
    publishScores();
    return;
  }
  if (event.type === "scores-clear" && event.source !== BUS_SOURCE) {
    for (const index of scores.keys()) scores.set(index, 0);
    renderScores();
    publishScores();
    return;
  }
  if (event.type === "first-raise" && event.source !== BUS_SOURCE) {
    void beginAnswerListen(event.personIndex);
    return;
  }
  if (event.type === "race-reset" || event.type === "raise-round-abort") {
    if (event.source === BUS_SOURCE) return;
    abortListen();
    answerSessionActive = false;
  }
}

subscribeClassroomEvents(onBusEvent);

async function afterQuestionSpeak(q: Question, rate: number): Promise<void> {
  setStatus(`读题结束 · ${q.id} · 举手倒计时…`);
  showRaiseCountdown(3);
  clearBanner();
  race.beginCountdown(performance.now());
  publishClassroomEvent({
    type: "raise-countdown-start",
    questionId: q.id,
    source: BUS_SOURCE,
  });
  const ok = await speakRaiseHandCountdown({
    rate,
    onTick: (n) => {
      showRaiseCountdown(n);
      setStatus(`举手倒计时 ${n} · 提前举手将扣分`);
    },
    onEnd: () => {
      speakingOrCountdown = false;
      const openAt = performance.now();
      race.openWindow(openAt);
      publishClassroomEvent({ type: "raise-window-open", source: BUS_SOURCE });
      showRaiseCountdown("go");
      showBanner("open", "开始抢答", 1600);
      setStatus(`发令 · 可抢答 · ${q.id}`);
      window.setTimeout(() => hideRaiseCountdown(), 1200);
    },
    onError: (msg) => {
      speakingOrCountdown = false;
      abortRound();
      hideRaiseCountdown();
      setStatus(msg);
    },
  });
  if (!ok) {
    abortRound();
    hideRaiseCountdown();
  }
}

function currentSpeakRate(): number {
  const raw = Number(speakRate?.value ?? "1");
  if (!Number.isFinite(raw)) return 1;
  return Math.min(2, Math.max(0.5, raw));
}

function syncSpeakRateLabel(): void {
  if (speakRateValue) speakRateValue.textContent = currentSpeakRate().toFixed(2);
}

async function refreshHealth(): Promise<boolean> {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) throw new Error(String(res.status));
    const health = (await res.json()) as {
      tts_mode?: string;
      questions_with_audio?: number;
      has_raise_countdown_audio?: boolean;
    };
    const n = health.questions_with_audio ?? 0;
    const cd = health.has_raise_countdown_audio ? "有倒计时音" : "缺倒计时音";
    apiStatus.textContent = `Python API 已连接 · 预生成语音 ${n} 题 · ${cd}`;
    apiStatus.className = n > 0 ? "api-status ok" : "api-status bad";
    return true;
  } catch {
    apiStatus.textContent = "Python API: 未连接（读题需 8765）";
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
  applyQuestions(data.questions, { announce: false });
}

function applyQuestions(list: Question[], opts?: { announce?: boolean; pathHint?: string }): void {
  questions = list;
  fillQuestionSelect(questionSelect, questions);
  const n = questions.length;
  updateStartAvailability();
  syncPreviewFromSelect();
  if (opts?.announce === false) return;
  const path = opts?.pathHint ?? answersPathInput.value;
  const withAudio = list.filter((q) => q.has_audio).length;
  setStatus(
    n > 0
      ? `已加载 ${path}（${n} 题，${withAudio} 题有预生成语音）。选题后可点「扬声器读题」`
      : "题库为空",
  );
}

function syncPreviewFromSelect(): void {
  const q = findQuestion(questions, questionSelect.value);
  renderQuestionPreview(questionPreview, q);
}

async function onSpeakQuestion(): Promise<void> {
  if (speakingOrCountdown || answerSessionActive || race.phase !== "idle") {
    setStatus("本轮正在进行；如需重来，请先点「停止本轮」");
    return;
  }
  if (!detect?.locked) {
    setStatus("请先等待视觉识别锁定参与者编号，再开始本题");
    return;
  }
  const q = findQuestion(questions, questionSelect.value);
  if (!q) {
    setStatus("请先选择题目");
    return;
  }
  hideRaiseCountdown();
  clearBanner();
  if (q.has_audio === false) {
    setStatus(`缺少 ${q.id}.mp3：在 python/ 运行 .venv\\Scripts\\python.exe -m speech_answer.prebuild_audio`);
    return;
  }
  if (!expectedChoiceLetter(q)) {
    setStatus(`${q.id} 无法映射标准答案到 A–D，请检查题库`);
    return;
  }
  // Reset race outcome for a new question; keep seat scores for the demo session.
  race.resetToIdle();
  renderScores();
  const rate = currentSpeakRate();
  speakingOrCountdown = true;
  setStatus(`正在播放预生成语音 ${q.id}（播放倍速 ${rate.toFixed(2)}）…`);
  await speakQuestion(q, {
    rate,
    onEnd: () => {
      void afterQuestionSpeak(q, rate);
    },
    onError: (msg) => {
      speakingOrCountdown = false;
      abortRound();
      hideRaiseCountdown();
      setStatus(msg);
    },
  });
}

speakRate?.addEventListener("input", () => syncSpeakRateLabel());
syncSpeakRateLabel();

async function loadAnswerBankFromInput(): Promise<void> {
  const path = answersPathInput.value.trim();
  if (!path) {
    setStatus("请填写题库相对路径，例如 data/answers.json");
    return;
  }
  setStatus(`加载题库：${path} …`);
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
    applyQuestions(body.questions ?? [], {
      announce: true,
      pathHint: answersPathInput.value,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(`加载题库失败：${msg}`);
    if (btnSpeak) btnSpeak.disabled = true;
  } finally {
    btnLoadBank.disabled = false;
  }
}

btnLoadBank.addEventListener("click", () => {
  void loadAnswerBankFromInput();
});

questionSelect.addEventListener("change", () => {
  if (suppressSelectSpeak) {
    syncPreviewFromSelect();
    updateStartAvailability();
    return;
  }
  stopSpeaking();
  abortRound();
  speakingOrCountdown = false;
  hideRaiseCountdown();
  syncPreviewFromSelect();
  updateStartAvailability();
  const q = findQuestion(questions, questionSelect.value);
  if (!q) return;
  setStatus(`已选择 ${q.id} · 视觉编号锁定后点「开始本题」`);
});

btnSpeak?.addEventListener("click", () => {
  void onSpeakQuestion();
});
btnSpeakStop?.addEventListener("click", () => {
  stopSpeaking();
  abortRound();
  speakingOrCountdown = false;
  hideRaiseCountdown();
  setStatus("已停止朗读");
});

async function startBackgroundDetect(): Promise<void> {
  if (visionStarting) return;
  visionStarting = true;
  btnRestartVision.disabled = true;
  detect?.stop();
  updateStartAvailability();
  const expectedCount = Math.min(6, Math.max(1, Math.trunc(Number(expectedCountInput.value) || 1)));
  expectedCountInput.value = String(expectedCount);
  detect = new BackgroundRaiseSession(
    { video: bgVideo, expectedCount },
    {
      onStatus: setDetectStatus,
      onLocked: (seats) => {
        seedScores(seats);
        updateStartAvailability();
        publishClassroomEvent({ type: "numbering-locked", seats, source: BUS_SOURCE });
        setDetectStatus(`人数排序成功：${seats.map((n) => `#${n}`).join(" ")} · 可以开始本题`);
      },
      onCleared: () => {
        scores.clear();
        renderScores();
        updateStartAvailability();
        publishScores();
        publishClassroomEvent({ type: "numbering-cleared", source: BUS_SOURCE });
      },
      onFrame: (people, nowMs) => {
        const raised = people.filter((p) => p.raised).map((p) => `#${p.personIndex}`);
        const phaseHint =
          race.phase === "countdown"
            ? "倒计时判定中"
            : race.phase === "open"
              ? "可抢答"
              : race.phase === "locked"
                ? "本轮已锁定"
                : "等待读题倒计时";
        setDetectStatus(
          raised.length > 0
            ? `编号已锁定 · 举手 ${raised.join("、")} · ${phaseHint}`
            : `编号已锁定 · 未举手 · ${phaseHint}`,
        );
        // Always feed while armed so held-up hands into countdown still count.
        if (race.phase === "idle") return;
        applyRaceOut(race.feed(people, nowMs));
      },
    },
  );
  try {
    bgVideo.classList.add("live");
    await detect.start();
  } catch (err) {
    updateStartAvailability();
    const msg = err instanceof Error ? err.message : String(err);
    const denied =
      /NotAllowedError|Permission denied|PermissionDenied/i.test(msg) ||
      (err instanceof DOMException && err.name === "NotAllowedError");
    setDetectStatus(
      denied
        ? "后台检测：请允许摄像头后刷新页面"
        : `后台检测启动失败：${msg}`,
    );
  } finally {
    visionStarting = false;
    btnRestartVision.disabled = false;
  }
}

btnRestartVision.addEventListener("click", () => {
  stopSpeaking();
  abortRound();
  speakingOrCountdown = false;
  hideRaiseCountdown();
  void startBackgroundDetect();
});

async function boot(): Promise<void> {
  const ok = await refreshHealth();
  if (!ok) {
    setStatus("请先启动 Python API（8765）用于读题，然后刷新");
    if (btnSpeak) btnSpeak.disabled = true;
  } else {
    try {
      await loadQuestions();
      setStatus(
        `题库：${answersPathInput.value} · 选题后点「扬声器读题」；举手在后台自动检测`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`加载题目失败：${msg}`);
      if (btnSpeak) btnSpeak.disabled = true;
    }
  }
  void startBackgroundDetect();
}

void boot();
