import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR } from "./paths";

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "mentor.db"));

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS weeks (
  track  TEXT NOT NULL,
  number INTEGER NOT NULL,
  title  TEXT NOT NULL,
  PRIMARY KEY (track, number)
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  track         TEXT NOT NULL,
  week          INTEGER NOT NULL,
  title         TEXT NOT NULL,
  kind          TEXT,
  energy        TEXT,
  minutes       INTEGER,
  spent_minutes INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'todo',
  note          TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  done_at       TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  date           TEXT NOT NULL,
  minutes        INTEGER,
  energy         TEXT,
  location       TEXT,
  task_ids       TEXT,
  mission        TEXT,
  result         TEXT,
  learned        TEXT,
  ai_opportunity TEXT,
  next_mission   TEXT
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'complete',
  concept_id INTEGER,
  questions  TEXT NOT NULL,
  answers    TEXT,
  score      INTEGER,
  passed     INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  graded_at  TEXT
);

CREATE TABLE IF NOT EXISTS doubts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL DEFAULT 'doubt',
  text        TEXT NOT NULL,
  origin_task TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  answer      TEXT,
  created_at  TEXT NOT NULL DEFAULT (date('now', 'localtime')),
  resolved_at TEXT,
  reviews     INTEGER NOT NULL DEFAULT 0,
  next_review TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS pending_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL,
  name        TEXT NOT NULL,
  args        TEXT NOT NULL,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  result      TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

type Param = string | number | null;

export function all<T>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

export function run(sql: string, ...params: Param[]) {
  return db.prepare(sql).run(...params);
}

let txDepth = 0;
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  txDepth++;
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    txDepth--;
  }
}

// ---------- settings ----------
export const DEFAULT_SETTINGS = {
  focusMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  cyclesBeforeLong: 4,
  quizQuestions: 5,
  quizPassPct: 100,
};
export type Settings = typeof DEFAULT_SETTINGS;

export function getSettings(): Settings {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key NOT LIKE 'meta:%'");
  const s = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in s) (s as Record<string, number>)[r.key] = Number(r.value);
  }
  return s;
}

const LIMITS: Record<keyof Settings, [number, number]> = {
  focusMin: [1, 120],
  breakMin: [1, 60],
  longBreakMin: [1, 90],
  cyclesBeforeLong: [1, 12],
  quizQuestions: [1, 10],
  quizPassPct: [10, 100],
};

export function saveSettings(patch: Partial<Settings>): Settings {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in LIMITS)) continue;
    const [min, max] = LIMITS[k as keyof Settings];
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) continue;
    run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      k,
      String(Math.min(max, Math.max(min, n))),
    );
  }
  return getSettings();
}

export function getMeta(key: string): string | null {
  return get<{ value: string }>("SELECT value FROM settings WHERE key = ?", `meta:${key}`)?.value ?? null;
}

export function setMeta(key: string, value: string) {
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    `meta:${key}`,
    value,
  );
}
