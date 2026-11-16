import { BOARDS, getBoard, rateTitleKey } from "./boards.js";
import { DEFAULT_RATE_TITLE, RATE_TITLE_KEY } from "./constants.js";

function defaultName(slot) {
  return `${slot}号`;
}

export async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS slots (
      slot INTEGER PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      score INTEGER NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      submit_time TEXT DEFAULT (datetime('now')),
      device_id TEXT
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS scores_one_per_device_code ON scores (code, device_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS score_voters (device_id TEXT PRIMARY KEY)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS board_slots (
      board TEXT NOT NULL,
      slot INTEGER NOT NULL,
      code TEXT NOT NULL,
      name TEXT,
      PRIMARY KEY (board, slot)
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS board_slots_board_code ON board_slots (board, code)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS board_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board TEXT NOT NULL,
      code TEXT NOT NULL,
      score INTEGER NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      submit_time TEXT DEFAULT (datetime('now')),
      device_id TEXT
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS board_scores_one_per_device ON board_scores (board, code, device_id)`),
  ]);

  try {
    await db.prepare("ALTER TABLE slots ADD COLUMN name TEXT").run();
  } catch {
    /* already exists */
  }

  await migrateLegacyMainBoard(db);
  await seedBoard(db, BOARDS.main);
  await seedBoard(db, BOARDS.case);

  const legacyTitle = await getSetting(db, RATE_TITLE_KEY, "");
  await db
    .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)")
    .bind(rateTitleKey("main"), legacyTitle || BOARDS.main.defaultTitle)
    .run();
  await db
    .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)")
    .bind(rateTitleKey("case"), BOARDS.case.defaultTitle)
    .run();
}

async function migrateLegacyMainBoard(db) {
  const existing = await db.prepare("SELECT COUNT(*) AS n FROM board_slots WHERE board = ?").bind("main").first();
  if (Number(existing?.n ?? 0) > 0) return;

  const { results: oldSlots } = await db.prepare("SELECT slot, code, name FROM slots ORDER BY slot").all();
  if (oldSlots?.length) {
    await db.batch(
      oldSlots.map((row) =>
        db
          .prepare("INSERT OR IGNORE INTO board_slots (board, slot, code, name) VALUES (?, ?, ?, ?)")
          .bind("main", Number(row.slot), row.code, row.name || defaultName(row.slot)),
      ),
    );
  }

  const scoreCount = await db.prepare("SELECT COUNT(*) AS n FROM board_scores WHERE board = ?").bind("main").first();
  if (Number(scoreCount?.n ?? 0) === 0) {
    const { results: oldScores } = await db
      .prepare("SELECT code, score, comment, submit_time, device_id FROM scores")
      .all();
    if (oldScores?.length) {
      await db.batch(
        oldScores.map((row) =>
          db
            .prepare(
              "INSERT INTO board_scores (board, code, score, comment, submit_time, device_id) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind("main", row.code, row.score, row.comment || "", row.submit_time, row.device_id),
        ),
      );
    }
  }
}

async function seedBoard(db, board) {
  for (let i = 1; i <= board.slotCount; i++) {
    await db
      .prepare("INSERT OR IGNORE INTO board_slots (board, slot, code, name) VALUES (?, ?, ?, ?)")
      .bind(board.id, i, String(i), defaultName(i))
      .run();
    await db
      .prepare(
        "UPDATE board_slots SET name = COALESCE(NULLIF(TRIM(name), ''), ?) WHERE board = ? AND slot = ? AND (name IS NULL OR TRIM(name) = '')",
      )
      .bind(defaultName(i), board.id, i)
      .run();
  }

  const { results: extra } = await db
    .prepare("SELECT slot, code FROM board_slots WHERE board = ? AND slot > ?")
    .bind(board.id, board.slotCount)
    .all();
  if (extra?.length) {
    const stmts = [];
    for (const row of extra) {
      stmts.push(db.prepare("DELETE FROM board_scores WHERE board = ? AND code = ?").bind(board.id, row.code));
      stmts.push(db.prepare("DELETE FROM board_slots WHERE board = ? AND slot = ?").bind(board.id, row.slot));
    }
    await db.batch(stmts);
  }
}

export function displayName(slot) {
  const name = String(slot?.name ?? "").trim();
  if (name) return name;
  return defaultName(Number(slot?.slot) || 1);
}

export async function listSlots(db, boardId = "main") {
  const board = getBoard(boardId);
  const { results } = await db
    .prepare("SELECT slot, code, name FROM board_slots WHERE board = ? AND slot <= ? ORDER BY slot")
    .bind(board.id, board.slotCount)
    .all();
  return (results ?? []).map((row) => ({
    slot: Number(row.slot),
    code: row.code,
    name: displayName(row),
  }));
}

export async function liveRows(db, boardId = "main") {
  const board = getBoard(boardId);
  const { results } = await db
    .prepare(
      `SELECT board_slots.slot, board_slots.code, board_slots.name,
              COUNT(board_scores.id) AS count,
              COALESCE(SUM(board_scores.score), 0) AS total
       FROM board_slots
       LEFT JOIN board_scores
         ON board_scores.board = board_slots.board AND board_scores.code = board_slots.code
       WHERE board_slots.board = ? AND board_slots.slot <= ?
       GROUP BY board_slots.slot, board_slots.code, board_slots.name
       ORDER BY board_slots.slot`,
    )
    .bind(board.id, board.slotCount)
    .all();
  return (results ?? []).map((row) => {
    const count = Number(row.count);
    const total = Number(row.total);
    return {
      slot: Number(row.slot),
      code: row.code,
      name: displayName(row),
      count,
      total,
      average: count ? Math.round((total / count) * 100) / 100 : null,
    };
  });
}

export async function alreadyScored(db, deviceId, code, boardId = "main") {
  const row = await db
    .prepare("SELECT 1 AS ok FROM board_scores WHERE board = ? AND device_id = ? AND code = ?")
    .bind(boardId, deviceId, code)
    .first();
  return Boolean(row);
}

export async function scoredCodesForDevice(db, deviceId, boardId = "main") {
  const { results } = await db
    .prepare("SELECT code FROM board_scores WHERE board = ? AND device_id = ?")
    .bind(boardId, deviceId)
    .all();
  return new Set((results ?? []).map((row) => row.code));
}

export async function insertScore(db, { boardId, code, score, comment, deviceId }) {
  await db
    .prepare("INSERT INTO board_scores (board, code, score, comment, device_id) VALUES (?, ?, ?, ?, ?)")
    .bind(boardId, code, score, comment, deviceId)
    .run();
}

export async function summaryForCode(db, code, boardId = "main") {
  const row = await db
    .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(score), 0) AS total FROM board_scores WHERE board = ? AND code = ?")
    .bind(boardId, code)
    .first();
  const count = Number(row?.count ?? 0);
  const total = Number(row?.total ?? 0);
  return { code, count, total, average: count ? Math.round((total / count) * 100) / 100 : null };
}

export async function scoresForCode(db, code, boardId = "main") {
  const { results } = await db
    .prepare("SELECT score, submit_time FROM board_scores WHERE board = ? AND code = ? ORDER BY id DESC")
    .bind(boardId, code)
    .all();
  return results ?? [];
}

export async function recentScores(db, limit = 20, boardId = "main") {
  const { results } = await db
    .prepare("SELECT code, score, comment, submit_time FROM board_scores WHERE board = ? ORDER BY id DESC LIMIT ?")
    .bind(boardId, limit)
    .all();
  return results ?? [];
}

export async function clearBoardScores(db, boardId = "main") {
  await db.prepare("DELETE FROM board_scores WHERE board = ?").bind(boardId).run();
}

export async function updateSlotNames(db, names, boardId = "main") {
  const stmts = names.map((name, index) =>
    db.prepare("UPDATE board_slots SET name = ? WHERE board = ? AND slot = ?").bind(name, boardId, index + 1),
  );
  await db.batch(stmts);
}

export async function getSetting(db, key, fallback = "") {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  const value = String(row?.value ?? "").trim();
  return value || fallback;
}

export async function getRateTitle(db, boardId = "main") {
  const board = getBoard(boardId);
  return getSetting(db, rateTitleKey(board.id), board.defaultTitle || DEFAULT_RATE_TITLE);
}

export async function setRateTitle(db, title, boardId = "main") {
  const board = getBoard(boardId);
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(rateTitleKey(board.id), title)
    .run();
}
