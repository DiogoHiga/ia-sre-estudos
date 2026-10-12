import { all, get, run, tx } from "./db";
import { DOUBT_KINDS, ENERGIES, KINDS, STATUSES, type Doubt, type DoubtKind, type Energy, type Kind, type Status, type Task, type Track } from "./types";
import { HttpError, addDays, oneLine, today } from "./util";

export function getTask(id: string): Task {
  const t = get<Task>("SELECT * FROM tasks WHERE id = ?", String(id).trim().toUpperCase());
  if (!t) throw new HttpError(404, `Tarefa ${id} não encontrada`);
  return t;
}

function check<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) throw new HttpError(400, `${field} inválido: ${String(value)} (use ${allowed.join(", ")})`);
  return value as T;
}
const optEnum = <T extends string>(v: unknown, allowed: readonly T[], field: string): T | null =>
  v == null || v === "" ? null : check(v, allowed, field);
const checkTrack = (v: unknown): Track => check(String(v).toUpperCase() as Track, ["E", "T"], "track");
function checkWeek(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 99) throw new HttpError(400, `Semana inválida: ${String(v)}`);
  return n;
}
function optMinutes(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 5 || n > 600) throw new HttpError(400, `Minutos inválidos: ${String(v)}`);
  return n;
}

/** Reordena posições (0, 10, 20…) mantendo a ordem atual. */
export function renormalize() {
  all<{ id: string }>("SELECT id FROM tasks ORDER BY track, week, position, rowid").forEach((t, i) =>
    run("UPDATE tasks SET position = ? WHERE id = ?", i * 10, t.id),
  );
}

function nextId(track: Track, week: number): string {
  const ids = all<{ id: string }>("SELECT id FROM tasks WHERE track = ? AND week = ?", track, week);
  const max = ids.reduce((m, r) => Math.max(m, Number(r.id.split(".")[1]) || 0), 0);
  let n = max + 1;
  while (get("SELECT 1 FROM tasks WHERE id = ?", `${track}${week}.${n}`)) n++;
  return `${track}${week}.${n}`;
}

function ensureWeek(track: Track, week: number) {
  if (!get("SELECT 1 FROM weeks WHERE track = ? AND number = ?", track, week)) {
    run("INSERT INTO weeks (track, number, title) VALUES (?, ?, ?)", track, week, "Novos temas");
  }
}

function positionFor(track: Track, week: number, afterId?: string | null): number {
  if (afterId) {
    const after = getTask(afterId);
    if (after.track === track && after.week === week) return after.position + 5;
  }
  const max = get<{ p: number | null }>("SELECT MAX(position) AS p FROM tasks WHERE track = ? AND week = ?", track, week)?.p;
  if (max != null) return max + 5;
  // semana vazia: posiciona depois da última tarefa de semanas anteriores
  const prev = get<{ p: number | null }>("SELECT MAX(position) AS p FROM tasks WHERE track = ? AND week < ?", track, week)?.p;
  return (prev ?? -10) + 5;
}

export interface NewTask {
  track?: unknown;
  week?: unknown;
  title?: unknown;
  kind?: unknown;
  energy?: unknown;
  minutes?: unknown;
  after_task_id?: unknown;
}

export function addTask(a: NewTask): string {
  const track = checkTrack(a.track);
  const week = checkWeek(a.week);
  const title = oneLine(String(a.title ?? ""));
  if (!title) throw new HttpError(400, "Título obrigatório");
  const kind = optEnum<Kind>(a.kind, KINDS, "kind");
  const energy = optEnum<Energy>(a.energy, ENERGIES, "energy");
  const minutes = optMinutes(a.minutes);
  return tx(() => {
    ensureWeek(track, week);
    const id = nextId(track, week);
    run(
      "INSERT INTO tasks (id, track, week, title, kind, energy, minutes, status, position) VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?)",
      id, track, week, title, kind, energy, minutes, positionFor(track, week, a.after_task_id ? String(a.after_task_id) : null),
    );
    renormalize();
    return id;
  });
}

export interface TaskPatch {
  title?: unknown;
  kind?: unknown;
  energy?: unknown;
  minutes?: unknown;
  status?: unknown;
  note?: unknown;
}

export function updateTask(id: string, p: TaskPatch): Task {
  const t = getTask(id);
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  if (p.title !== undefined) set("title", oneLine(String(p.title)) || t.title);
  if (p.kind !== undefined) set("kind", optEnum<Kind>(p.kind, KINDS, "kind"));
  if (p.energy !== undefined) set("energy", optEnum<Energy>(p.energy, ENERGIES, "energy"));
  if (p.minutes !== undefined) set("minutes", optMinutes(p.minutes));
  if (p.note !== undefined) set("note", p.note == null ? null : oneLine(String(p.note)) || null);
  if (p.status !== undefined) {
    const st = check<Status>(p.status, STATUSES, "status");
    set("status", st);
    set("done_at", st === "done" ? (t.done_at ?? today()) : null);
    if (st === "done" && p.note === undefined) set("note", null);
  }
  if (sets.length) run(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, ...vals, t.id);
  return getTask(t.id);
}

export function moveTask(id: string, weekRaw: unknown, afterId?: unknown): string {
  const t = getTask(id);
  const week = checkWeek(weekRaw);
  return tx(() => {
    let newId = t.id;
    if (week !== t.week) {
      ensureWeek(t.track, week);
      newId = nextId(t.track, week);
      run("UPDATE tasks SET id = ?, week = ? WHERE id = ?", newId, week, t.id);
      run("UPDATE quiz_attempts SET task_id = ? WHERE task_id = ?", newId, t.id);
      run("UPDATE doubts SET origin_task = ? WHERE origin_task = ?", newId, t.id);
    }
    run("UPDATE tasks SET position = ? WHERE id = ?", positionFor(t.track, week, afterId ? String(afterId) : null), newId);
    renormalize();
    return newId;
  });
}

export function deleteTask(id: string) {
  const t = getTask(id);
  run("DELETE FROM tasks WHERE id = ?", t.id);
  return t;
}

export function upsertWeek(trackRaw: unknown, numberRaw: unknown, titleRaw: unknown) {
  const track = checkTrack(trackRaw);
  const number = checkWeek(numberRaw);
  const title = oneLine(String(titleRaw ?? "")) || "Novos temas";
  run(
    "INSERT INTO weeks (track, number, title) VALUES (?, ?, ?) ON CONFLICT(track, number) DO UPDATE SET title = excluded.title",
    track, number, title,
  );
}

export function addSpent(id: string, minutesRaw: unknown): Task {
  const t = getTask(id);
  const m = Math.max(0, Math.round(Number(minutesRaw) || 0));
  run(
    "UPDATE tasks SET spent_minutes = spent_minutes + ?, status = CASE WHEN status = 'todo' THEN 'doing' ELSE status END WHERE id = ?",
    m, t.id,
  );
  return getTask(t.id);
}

// ---------------- dúvidas ----------------
export function addDoubt(kindRaw: unknown, textRaw: unknown, origin?: unknown): number {
  const kind = check<DoubtKind>(kindRaw ?? "doubt", DOUBT_KINDS, "kind");
  const text = oneLine(String(textRaw ?? ""));
  if (!text) throw new HttpError(400, "Texto obrigatório");
  const originTask = origin ? String(origin).toUpperCase() : null;
  const dup = get<{ id: number }>("SELECT id FROM doubts WHERE status = 'open' AND kind = ? AND text = ?", kind, text);
  if (dup) return dup.id;
  const r = run(
    "INSERT INTO doubts (kind, text, origin_task, created_at, next_review) VALUES (?, ?, ?, ?, ?)",
    kind, text, originTask, today(), kind === "concept" ? addDays(today(), 1) : null,
  );
  return Number(r.lastInsertRowid);
}

export function getDoubt(id: unknown): Doubt {
  const d = get<Doubt>("SELECT * FROM doubts WHERE id = ?", Number(id));
  if (!d) throw new HttpError(404, `Dúvida #${String(id)} não encontrada`);
  return d;
}

export function resolveDoubt(id: unknown, answer?: unknown) {
  const d = getDoubt(id);
  run(
    "UPDATE doubts SET status = 'resolved', answer = ?, resolved_at = ? WHERE id = ?",
    answer ? oneLine(String(answer)) : d.answer, today(), d.id,
  );
}

export function reopenDoubt(id: unknown) {
  const d = getDoubt(id);
  run("UPDATE doubts SET status = 'open', resolved_at = NULL WHERE id = ?", d.id);
}

export function deleteDoubt(id: unknown) {
  run("DELETE FROM doubts WHERE id = ?", getDoubt(id).id);
}

/** Repetição espaçada: 1, 3, 7, 14 dias. Após 4 revisões certas, o conceito é dado como dominado. */
const INTERVALS = [1, 3, 7, 14];
export function reviewConcept(id: number, passed: boolean) {
  const d = getDoubt(id);
  if (!passed) {
    run("UPDATE doubts SET next_review = ? WHERE id = ?", addDays(today(), 1), d.id);
    return;
  }
  const reviews = d.reviews + 1;
  if (reviews >= INTERVALS.length) {
    run(
      "UPDATE doubts SET reviews = ?, status = 'resolved', resolved_at = ?, answer = 'dominado (4 revisões)' WHERE id = ?",
      reviews, today(), d.id,
    );
  } else {
    run("UPDATE doubts SET reviews = ?, next_review = ? WHERE id = ?", reviews, addDays(today(), INTERVALS[reviews]), d.id);
  }
}
