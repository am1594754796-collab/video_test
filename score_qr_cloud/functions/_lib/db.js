import { SLOT_COUNT } from "./constants.js";

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
  ]);

  // Older D1 DBs may lack the name column.
  try {
    await db.prepare("ALTER TABLE slots ADD COLUMN name TEXT").run();
  } catch {
    /* already exists */
  }

  const { results: existing } = await db.prepare("SELECT slot, code, name FROM slots ORDER BY slot").all();
  const rows = existing ?? [];

  if (rows.length === 0) {
    await db.batch(
      Array.from({ length: SLOT_COUNT }, (_, i) => {
        const slot = i + 1;
        return db
          .prepare("INSERT OR IGNORE INTO slots (slot, code, name) VALUES (?, ?, ?)")
          .bind(slot, String(slot), defaultName(slot));
      }),
    );
    return;
  }

  const extra = rows.filter((row) => Number(row.slot) > SLOT_COUNT);
  if (extra.length) {
    const statements = [];
    for (const row of extra) {
      statements.push(db.prepare("DELETE FROM scores WHERE code = ?").bind(row.code));
      statements.push(db.prepare("DELETE FROM slots WHERE slot = ?").bind(row.slot));
    }
    await db.batch(statements);
  }

  for (let i = 1; i <= SLOT_COUNT; i++) {
    await db.prepare("INSERT OR IGNORE INTO slots (slot, code, name) VALUES (?, ?, ?)").bind(i, String(i), defaultName(i)).run();
    await db
      .prepare("UPDATE slots SET name = COALESCE(NULLIF(TRIM(name), ''), ?) WHERE slot = ? AND (name IS NULL OR TRIM(name) = '')")
      .bind(defaultName(i), i)
      .run();
  }
}

export function displayName(slot) {
  const name = String(slot?.name ?? "").trim();
  if (name) return name;
  return defaultName(Number(slot?.slot) || 1);
}

export async function listSlots(db) {
  const { results } = await db
    .prepare("SELECT slot, code, name FROM slots WHERE slot <= ? ORDER BY slot")
    .bind(SLOT_COUNT)
    .all();
  return (results ?? []).map((row) => ({
    slot: Number(row.slot),
    code: row.code,
    name: displayName(row),
  }));
}

export async function summaryForCode(db, code) {
  const row = await db
    .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(score), 0) AS total FROM scores WHERE code = ?")
    .bind(code)
    .first();
  const count = Number(row?.count ?? 0);
  const total = Number(row?.total ?? 0);
  return { code, count, total, average: count ? Math.round((total / count) * 100) / 100 : null };
}

export async function liveRows(db) {
  const { results } = await db
    .prepare(
      `SELECT slots.slot, slots.code, slots.name, COUNT(scores.id) AS count,
              COALESCE(SUM(scores.score), 0) AS total
       FROM slots LEFT JOIN scores ON scores.code = slots.code
       WHERE slots.slot <= ?
       GROUP BY slots.slot, slots.code, slots.name ORDER BY slots.slot`,
    )
    .bind(SLOT_COUNT)
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

export async function alreadyScored(db, deviceId, code) {
  const row = await db.prepare("SELECT 1 AS ok FROM scores WHERE device_id = ? AND code = ?").bind(deviceId, code).first();
  return Boolean(row);
}

/** Codes this device has already scored. */
export async function scoredCodesForDevice(db, deviceId) {
  const { results } = await db.prepare("SELECT code FROM scores WHERE device_id = ?").bind(deviceId).all();
  return new Set((results ?? []).map((row) => row.code));
}

export async function recentScores(db, limit = 20) {
  const { results } = await db
    .prepare("SELECT code, score, comment, submit_time FROM scores ORDER BY id DESC LIMIT ?")
    .bind(limit)
    .all();
  return results ?? [];
}

export async function scoresForCode(db, code) {
  const { results } = await db.prepare("SELECT score, submit_time FROM scores WHERE code = ? ORDER BY id DESC").bind(code).all();
  return results ?? [];
}

export async function updateSlotNames(db, names) {
  const stmts = names.map((name, index) =>
    db.prepare("UPDATE slots SET name = ? WHERE slot = ?").bind(name, index + 1),
  );
  await db.batch(stmts);
}
