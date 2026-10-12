import { all } from "./db";
import type { Task, Track } from "./types";
import { addDays, today } from "./util";

export interface Stats {
  currentWeek: Record<Track, number | null>;
  streak: number;
  lastSession: string | null;
  progress: Record<Track, { done: number; total: number }>;
}

export function computeStats(): Stats {
  const tasks = all<Pick<Task, "track" | "week" | "status">>("SELECT track, week, status FROM tasks");
  const progress: Stats["progress"] = { E: { done: 0, total: 0 }, T: { done: 0, total: 0 } };
  const currentWeek: Stats["currentWeek"] = { E: null, T: null };
  const lastWeek: Record<Track, number> = { E: 1, T: 1 };
  for (const t of tasks) {
    const p = progress[t.track];
    if (!p) continue;
    p.total++;
    lastWeek[t.track] = Math.max(lastWeek[t.track], t.week);
    if (t.status === "done") p.done++;
    else currentWeek[t.track] = Math.min(currentWeek[t.track] ?? Infinity, t.week);
  }
  for (const k of ["E", "T"] as Track[]) currentWeek[k] ??= lastWeek[k];

  const dates = all<{ date: string }>("SELECT DISTINCT date FROM sessions ORDER BY date DESC").map((r) => r.date);
  let streak = 0;
  if (dates.length) {
    let expected = dates[0] === today() ? today() : addDays(today(), -1);
    for (const d of dates) {
      if (d !== expected) break;
      streak++;
      expected = addDays(expected, -1);
    }
  }
  return { currentWeek, streak, lastSession: dates[0] ?? null, progress };
}
