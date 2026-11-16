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
import { speakAnswerFeedback, speakQuestion, speakRaiseHandCountdown, speakRaceAnnouncement, stopSpeaking } from "./speakQuestion";
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
const btnCountdownRace = document.querySelector<HTMLButtonElement>("#btn-countdown-race");
const btnSpeakStop = document.querySelector<HTMLButtonElement>("#btn-speak-stop");
const apiStatus = document.querySelector<HTMLElement>("#api-status")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const questionPreview = document.querySelector<HTMLElement>("#question-preview");
const raiseCountdown = document.querySelector<HTMLElement>("#raise-countdown");
const raceBanner = document.querySelector<HTMLElement>("#race-banner");
const scoreDemo = document.querySelector<HTMLElement>("#score-demo");
const detectStatusEl = document.querySelector<HTMLElement>("#detect-status");
const expectedCountInput = document.querySelector<HTMLInputElement>("#expected-count")!;
const btnRestartVision = document.querySelector<HTMLButtonElement>("#btn-restart-vision")!;

let questions: Question[] = [];
const scores = new Map<number, number>();
let bannerTimer = 0;
/** True after vision page publishes numbering-locked. */
let visionLocked = false;
/** Countdown → open → answer; blocks starting another question. */
let raiseRoundActive = false;
/** Prevents overlapping listen / auto-advance. */
let answerSessionActive = false;
let listenAbort: AbortController | null = null;
/** Skip change→speak when we set select.value during auto-next. */
let suppressSelectSpeak = false;
let speakingOrCountdown = false;
let roundVersion = 0;
let announcementTail: Promise<void> = Promise.resolve();
let announcementAbort = new AbortController();
/**
 * Early raises this round (扣分). Kept until the priority winner is announced
 * so the final voice lists both 抢先举手 and 正常优先举手.
 */
const roundEarlyRaises = new Set<number>();
/** Early window: 5s countdown (5→1) + 0.1s hold, then open race. */
const COUNTDOWN_SEC = 5;
const OPEN_AFTER_ONE_MS = 100;
let openAfterOneTimer = 0;
let countdownTickTimers: number[] = [];
const spokenSeatNumbers = ["", "一", "二", "三", "四", "五", "六"];

function spokenSeat(index: number): string {
  return `${spokenSeatNumbers[index] ?? String(index)}号`;
}

function voidRaceAnnouncement(text: string): Promise<void> {
  const version = roundVersion;
  const signal = announcementAbort.signal;
  const announcement = announcementTail.then(async () => {
    if (version === roundVersion && !signal.aborted) await speakRaceAnnouncement(text, signal);
  });
  announcementTail = announcement.catch(() => undefined);
  return announcement;
}

function clearRoundRaiseState(): void {
  roundEarlyRaises.clear();
}

function cancelRaceAnnouncements(): void {
  clearRoundRaiseState();
  announcementAbort.abort();
  announcementAbort = new AbortController();
  announcementTail = Promise.resolve();
}

/** Final spoken summary: early raisers (if any) + normal priority winner. */
function buildRaceResultAnnouncement(winnerIndex: number): string {
  const early = [...roundEarlyRaises].sort((a, b) => a - b);
  const parts: string[] = [];
  if (early.length > 0) {
    parts.push(`${early.map(spokenSeat).join("、")}抢先举手，扣一分`);
  }
  parts.push(`${spokenSeat(winnerIndex)}优先举手，请回答`);
  return `${parts.join("。")}。`;
}

function raceResultBanner(winnerIndex: number): string {
  const early = [...roundEarlyRaises].sort((a, b) => a - b);
  if (early.length === 0) return `#${winnerIndex} 优先举手`;
  return `抢先 #${early.join("、#")} · 优先 #${winnerIndex}`;
}

function updateStartAvailability(): void {
  const selected = !!questions.find((q) => q.id === questionSelect.value);
  // Direct countdown only needs vision lock; 开始本题 also needs a selected question.
  if (btnSpeak) btnSpeak.disabled = !selected;
  if (btnCountdownRace) btnCountdownRace.disabled = !visionLocked;
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

function showRaiseCountdown(n: 5 | 4 | 3 | 2 | 1 | "go"): void {
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

function applyEarlyRaise(personIndex: number): void {
  if (roundEarlyRaises.has(personIndex)) return;
  const prev = scores.get(personIndex) ?? INITIAL_SCORE;
  const next = Math.max(0, prev - 1);
  scores.set(personIndex, next);
  roundEarlyRaises.add(personIndex);
  renderScores({ index: personIndex, kind: "penalty" });
  const earlyLabel = [...roundEarlyRaises].sort((a, b) => a - b).map((n) => `#${n}`).join("、");
  showBanner("early", `${earlyLabel} 抢先举手 · 已记扣分`, 0);
  setStatus(`已记录抢先举手：${earlyLabel}（开抢后一并播报）`);
  publishScores();
}

function abortListen(): void {
  listenAbort?.abort();
  listenAbort = null;
}

function clearOpenAfterOneTimer(): void {
  window.clearTimeout(openAfterOneTimer);
  openAfterOneTimer = 0;
}

function clearCountdownTickTimers(): void {
  for (const id of countdownTickTimers) window.clearTimeout(id);
  countdownTickTimers = [];
  clearOpenAfterOneTimer();
}

function abortRound(): void {
  roundVersion++;
  cancelRaceAnnouncements();
  clearCountdownTickTimers();
  abortListen();
  answerSessionActive = false;
  raiseRoundActive = false;
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

async function announceRaceOutcome(personIndex: number): Promise<string> {
  stopSpeaking();
  speakingOrCountdown = false;
  hideRaiseCountdown();
  renderScores({ index: personIndex, kind: "winner" });
  const announce = buildRaceResultAnnouncement(personIndex);
  showBanner("win", raceResultBanner(personIndex), 0);
  setStatus(`播报：${announce}`);
  await voidRaceAnnouncement(announce);
  clearRoundRaiseState();
  return announce;
}

async function beginAnswerListen(personIndex: number): Promise<void> {
  if (answerSessionActive) return;
  const activeVersion = roundVersion;
  // Always announce 抢先 + 优先 first (even if no question for listening).
  answerSessionActive = true;
  raiseRoundActive = true;
  await announceRaceOutcome(personIndex);
  if (activeVersion !== roundVersion) {
    answerSessionActive = false;
    return;
  }

  const q = findQuestion(questions, questionSelect.value);
  if (!q) {
    answerSessionActive = false;
    setStatus("抢答结果已播报 · 无当前题目，跳过听答");
    return;
  }
  const expected = expectedChoiceLetter(q);
  if (!expected) {
    answerSessionActive = false;
    setStatus(`${q.id} 无法映射标准答案到 A–D，请检查题库 options/answer`);
    return;
  }

  abortListen();
  listenAbort = new AbortController();
  if (activeVersion !== roundVersion || listenAbort.signal.aborted) return;
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

  await speakAnswerFeedback(passed, expected, q.options?.[expected]);
  if (activeVersion !== roundVersion) return;
  await sleep(ANSWER_RESULT_DISPLAY_MS);
  if (activeVersion !== roundVersion) return;
  answerSessionActive = false;
  await advanceToNextQuestion();
}

async function advanceToNextQuestion(): Promise<void> {
  publishClassroomEvent({ type: "race-reset", source: BUS_SOURCE });
  raiseRoundActive = false;
  const curId = questionSelect.value;
  const idx = questions.findIndex((q) => q.id === curId);
  const next = idx >= 0 ? questions[idx + 1] : undefined;
  if (!next) {
    setStatus(`题库已结束（最后一题 ${curId}）· 可手动选题重来`);
    showBanner("open", "题库结束", 4000);
    return;
  }
  suppressSelectSpeak = true;
  questionSelect.value = next.id;
  syncPreviewFromSelect();
  suppressSelectSpeak = false;
  clearBanner();
  setStatus(`自动进入 ${next.id} · 开始读题`);
  await onSpeakQuestion();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

function onBusEvent(event: ClassroomEvent): void {
  if (event.source === BUS_SOURCE) return;
  switch (event.type) {
    case "scores-snapshot-request":
      publishScores();
      break;
    case "scores-clear":
      for (const index of scores.keys()) scores.set(index, 0);
      renderScores();
      publishScores();
      break;
    case "scores-admin-set":
      for (let index = 1; index <= 6; index++) {
        scores.set(index, event.scores[String(index)]);
      }
      renderScores();
      publishScores();
      setStatus("管理员已更新积分，下一题将从新分数继续");
      break;
    case "numbering-locked":
      seedScores(event.seats);
      visionLocked = true;
      updateStartAvailability();
      setDetectStatus(`人数排序成功：${event.seats.map((n) => `#${n}`).join(" ")} · 可「开始本题」或「直接倒计时抢答」`);
      break;
    case "vision-state":
      visionLocked = true;
      if (scores.size === 0) seedScores(event.seats);
      updateStartAvailability();
      setDetectStatus(`人数已锁定：${event.seats.map((n) => `#${n}`).join(" ")} · 可「开始本题」或「直接倒计时抢答」`);
      break;
    case "numbering-cleared":
      visionLocked = false;
      scores.clear();
      renderScores();
      publishScores();
      updateStartAvailability();
      setDetectStatus("举手识别页已清空编号 · 等待重新锁定");
      break;
    case "early-raise":
      applyEarlyRaise(event.personIndex);
      break;
    case "first-raise":
      showBanner("win", `#${event.personIndex} 抢答成功`, 0);
      setStatus(`抢答成功 · #${event.personIndex} · 等待编号播报`);
      void beginAnswerListen(event.personIndex);
      break;
    case "race-reset":
    case "raise-round-abort":
      roundVersion++;
      cancelRaceAnnouncements();
      abortListen();
      answerSessionActive = false;
      raiseRoundActive = false;
      break;
    default:
      break;
  }
}

subscribeClassroomEvents(onBusEvent);
const visionStateTimer = window.setInterval(() => {
  if (visionLocked) {
    window.clearInterval(visionStateTimer);
    return;
  }
  publishClassroomEvent({ type: "vision-state-request", source: BUS_SOURCE });
}, 1000);
publishClassroomEvent({ type: "vision-state-request", source: BUS_SOURCE });

function openRaiseWindow(label: string): void {
  speakingOrCountdown = false;
  publishClassroomEvent({ type: "raise-window-open", source: BUS_SOURCE });
  showRaiseCountdown("go");
  const early = [...roundEarlyRaises].sort((a, b) => a - b);
  const earlyHint =
    early.length > 0 ? ` · 已记抢先 ${early.map((n) => `#${n}`).join("、")}` : "";
  showBanner("open", "开始抢答", 1600);
  setStatus(`发令 · 可抢答 · ${label}${earlyHint}`);
  window.setTimeout(() => hideRaiseCountdown(), 1200);
}

/**
 * 5s countdown (early 扣分) + 0.1s hold, then open.
 * Used after read-aloud and by「直接倒计时抢答」(no question audio).
 */
function armEarlyCountdownGate(label: string, roundAtStart: number): void {
  clearCountdownTickTimers();
  for (let sec = COUNTDOWN_SEC; sec >= 1; sec--) {
    const delay = (COUNTDOWN_SEC - sec) * 1000;
    const n = sec as 5 | 4 | 3 | 2 | 1;
    countdownTickTimers.push(
      window.setTimeout(() => {
        if (roundAtStart !== roundVersion) return;
        showRaiseCountdown(n);
        setStatus(`举手倒计时 ${n} · 提前举手将扣分 · ${label}`);
      }, delay),
    );
  }
  countdownTickTimers.push(
    window.setTimeout(() => {
      if (roundAtStart !== roundVersion) return;
      setStatus(`读完 1 · 再等 0.1 秒后可抢答 · ${label}`);
    }, COUNTDOWN_SEC * 1000),
  );
  openAfterOneTimer = window.setTimeout(() => {
    openAfterOneTimer = 0;
    if (roundAtStart !== roundVersion) return;
    openRaiseWindow(label);
  }, COUNTDOWN_SEC * 1000 + OPEN_AFTER_ONE_MS);
}

async function runRaiseCountdown(label: string, rate: number): Promise<void> {
  clearBanner();
  clearRoundRaiseState();
  raiseRoundActive = true;
  speakingOrCountdown = true;
  const roundAtStart = roundVersion;
  showRaiseCountdown(5);
  publishClassroomEvent({
    type: "raise-countdown-start",
    questionId: label,
    source: BUS_SOURCE,
  });
  armEarlyCountdownGate(label, roundAtStart);
  setStatus(`举手倒计时 5 秒 · 提前举手将扣分并记录 · ${label}`);
  const ok = await speakRaiseHandCountdown({
    rate,
    onError: (msg) => {
      setStatus(`${msg} · 仍按 5+0.1 秒计时开抢`);
    },
  });
  if (!ok && roundAtStart === roundVersion) {
    setStatus(`倒计时语音不可用 · 仍按 5+0.1 秒计时开抢 · ${label}`);
  }
}

async function afterQuestionSpeak(q: Question, rate: number): Promise<void> {
  await runRaiseCountdown(q.id, rate);
}

/** No question audio — countdown early window then open raise race. */
async function onDirectCountdownRace(): Promise<void> {
  if (speakingOrCountdown || answerSessionActive || raiseRoundActive) {
    setStatus("本轮正在进行；如需重来，请先点「停止本轮」");
    return;
  }
  if (!visionLocked) {
    setStatus("请先打开举手识别页并等待人数锁定，再开始倒计时抢答");
    return;
  }
  hideRaiseCountdown();
  clearBanner();
  renderScores();
  const q = findQuestion(questions, questionSelect.value);
  const label = q?.id ?? "countdown-race";
  setStatus(`直接倒计时抢答 · 不读题 · ${label}`);
  await runRaiseCountdown(label, currentSpeakRate());
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
  if (speakingOrCountdown || answerSessionActive || raiseRoundActive) {
    setStatus("本轮正在进行；如需重来，请先点「停止本轮」");
    return;
  }
  if (!visionLocked) {
    setStatus("请先打开举手识别页并等待人数锁定，再开始本题");
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
btnCountdownRace?.addEventListener("click", () => {
  void onDirectCountdownRace();
});
btnSpeakStop?.addEventListener("click", () => {
  stopSpeaking();
  abortRound();
  speakingOrCountdown = false;
  hideRaiseCountdown();
  setStatus("已停止本轮");
});

function requestVisionRelock(): void {
  stopSpeaking();
  abortRound();
  speakingOrCountdown = false;
  hideRaiseCountdown();
  visionLocked = false;
  updateStartAvailability();
  const count = Math.min(6, Math.max(1, Math.trunc(Number(expectedCountInput.value) || 1)));
  expectedCountInput.value = String(count);
  setDetectStatus(`已请求举手识别页重新检测 ${count} 人…`);
  publishClassroomEvent({
    type: "vision-relock-request",
    expectedCount: count,
    source: BUS_SOURCE,
  });
}

btnRestartVision.addEventListener("click", () => {
  requestVisionRelock();
});

expectedCountInput.addEventListener("change", () => {
  requestVisionRelock();
});

async function boot(): Promise<void> {
  if (!visionLocked) {
    setDetectStatus("请打开举手识别页（vision.html）并允许摄像头，等待人数锁定");
  }
  const ok = await refreshHealth();
  if (!ok) {
    setStatus("请先启动 Python API（8765）用于读题，然后刷新");
    if (btnSpeak) btnSpeak.disabled = true;
  } else {
    try {
      await loadQuestions();
      setStatus(visionLocked
        ? `题库：${answersPathInput.value} · 「开始本题」或「直接倒计时抢答」`
        : `题库：${answersPathInput.value} · 举手识别页锁定编号后可开始`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`加载题目失败：${msg}`);
      if (btnSpeak) btnSpeak.disabled = true;
    }
  }
}

void boot();
