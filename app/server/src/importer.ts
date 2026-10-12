import fs from "node:fs";
import { all, get, run, setMeta, tx } from "./db";
import { FILES } from "./paths";
import type { Doubt, DoubtKind, Energy, Kind, Session, Status, Task, Track, Week } from "./types";
import { parseDuration } from "./util";

const KIND_MAP: [string, Kind][] = [
  ["📚", "course"],
  ["📖", "reading"],
  ["🛠️", "lab"],
  ["🛠", "lab"],
  ["🧠", "checkpoint"],
];
const ENERGY_MAP: [string, Energy][] = [
  ["🟢", "low"],
  ["🟡", "med"],
  ["🔴", "high"],
];

const TASK_RE = /^- \[( |x|X|~)\] \*\*([A-Z]+)(\d+)\.(\d+)\*\*\s*(.*)$/;
const WEEK_RE = /^## Semana (\d+)\s*[:\-–]\s*(.*)$/;

type ParsedTask = Omit<Task, "spent_minutes" | "done_at">;

const stripComments = (md: string) => md.replace(/<!--[\s\S]*?-->/g, "");
const readIfExists = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

// ---------------- progresso.md ----------------
export function parseProgresso(md: string) {
  const tasks: ParsedTask[] = [];
  const weeks: Week[] = [];
  const routines: string[] = [];
  let section: Track | null = null;
  let inRoutines = false;
  let startDate: string | null = null;

  for (const line of stripComments(md).split(/\r?\n/)) {
    if (/^# /.test(line)) {
      section = /Trabalho/i.test(line) ? "T" : /Estudo/i.test(line) ? "E" : null;
      inRoutines = false;
      continue;
    }
    if (/^## /.test(line)) {
      inRoutines = /^## Rotinas/i.test(line);
      const wm = line.match(WEEK_RE);
      if (wm && section) weeks.push({ track: section, number: Number(wm[1]), title: wm[2].trim() });
      continue;
    }
    if (inRoutines) {
      if (line.trim() && line.trim() !== "---") routines.push(line);
      continue;
    }
    const sm = line.match(/\*\*In[ií]cio:\*\*\s*(\d{4}-\d{2}-\d{2})/);
    if (sm) startDate = sm[1];

    const tm = line.match(TASK_RE);
    if (!tm) continue;
    const [, mark, letters, weekStr, numStr, restRaw] = tm;
    const track: Track | null = letters === "E" || letters === "T" ? letters : section;
    if (!track) continue;

    let rest = restRaw.trim();
    let kind: Kind | null = null;
    let energy: Energy | null = null;
    for (let changed = true; changed; ) {
      changed = false;
      for (const [e, k] of KIND_MAP)
        if (rest.startsWith(e)) {
          kind ??= k;
          rest = rest.slice(e.length);
          changed = true;
        }
      for (const [e, en] of ENERGY_MAP)
        if (rest.startsWith(e)) {
          energy ??= en;
          rest = rest.slice(e.length);
          changed = true;
        }
      if (rest.startsWith("\uFE0F")) {
        rest = rest.slice(1);
        changed = true;
      }
    }
    rest = rest.trim();

    let note: string | null = null;
    const ni = rest.lastIndexOf(" — ");
    if (ni >= 0) {
      note = rest.slice(ni + 3).trim() || null;
      rest = rest.slice(0, ni).trim();
    }
    let minutes: number | null = null;
    const di = rest.lastIndexOf(" · ");
    if (di >= 0) {
      const d = parseDuration(rest.slice(di + 3));
      if (d != null) {
        minutes = d;
        rest = rest.slice(0, di).trim();
      }
    }
    const status: Status = mark === " " ? "todo" : mark === "~" ? "doing" : "done";
    tasks.push({
      id: `${track}${weekStr}.${numStr}`,
      track,
      week: Number(weekStr),
      title: rest,
      kind,
      energy,
      minutes,
      status,
      note,
      position: tasks.length * 10,
    });
  }
  return { tasks, weeks, routinesMd: routines.join("\n"), startDate };
}

// ---------------- sessoes.md ----------------
const SESSION_FIELDS: Record<string, keyof Session> = {
  "Missão": "mission",
  Resultado: "result",
  Aprendi: "learned",
  "Oportunidade de IA vista": "ai_opportunity",
  "Próxima missão": "next_mission",
};
const ENERGY_FROM_EMOJI: Record<string, Energy> = { "🟢": "low", "🟡": "med", "🔴": "high" };

export function parseSessoes(md: string): Omit<Session, "id">[] {
  const out: Omit<Session, "id">[] = [];
  let cur: Omit<Session, "id"> | null = null;
  for (const line of stripComments(md).split(/\r?\n/)) {
    const h = line.match(/^## (\d{4}-\d{2}-\d{2})\s*·\s*(\d+)\s*min\s*·\s*([^·]+?)\s*·\s*energia\s*(\S+)/);
    if (h) {
      cur = {
        date: h[1],
        minutes: Number(h[2]),
        location: h[3].trim(),
        energy: ENERGY_FROM_EMOJI[h[4]] ?? null,
        task_ids: null,
        mission: null,
        result: null,
        learned: null,
        ai_opportunity: null,
        next_mission: null,
      };
      out.push(cur);
      continue;
    }
    const b = line.match(/^- \*\*(.+?):\*\*\s*(.*)$/);
    if (b && cur && SESSION_FIELDS[b[1]]) {
      (cur as Record<string, unknown>)[SESSION_FIELDS[b[1]]] = b[2].trim() || null;
      if (b[1] === "Missão") cur.task_ids = JSON.stringify(b[2].match(/[ET]\d+\.\d+/g) ?? []);
    }
  }
  return out;
}

// ---------------- duvidas.md ----------------
type ParsedDoubt = Omit<Doubt, "id">;

export function parseDuvidas(md: string): ParsedDoubt[] {
  const out: ParsedDoubt[] = [];
  let section: "open" | "explore" | "concept" | "resolved" | null = null;
  const base = (kind: DoubtKind, text: string, created: string): ParsedDoubt => ({
    kind,
    text,
    origin_task: null,
    status: "open",
    answer: null,
    created_at: created,
    resolved_at: null,
    reviews: 0,
    next_review: null,
  });

  for (const line of stripComments(md).split(/\r?\n/)) {
    if (/^## /.test(line)) {
      section = /aberto/i.test(line)
        ? "open"
        : /explorar/i.test(line)
          ? "explore"
          : /conceitos/i.test(line)
            ? "concept"
            : /resolvid/i.test(line)
              ? "resolved"
              : null;
      continue;
    }
    let m: RegExpMatchArray | null;
    if (section === "open" && (m = line.match(/^- \[ \] (\d{4}-\d{2}-\d{2}) · (.*?)(?: · \(origem: (.*?)\))?$/))) {
      out.push({ ...base("doubt", m[2], m[1]), origin_task: m[3] ?? null });
    } else if (section === "explore" && (m = line.match(/^- (\d{4}-\d{2}-\d{2}) · (.*)$/))) {
      out.push(base("explore", m[2], m[1]));
    } else if (
      section === "concept" &&
      (m = line.match(/^- (.*?) · aprendido em (\d{4}-\d{2}-\d{2}) · revisões: (\d+) · próxima: (\d{4}-\d{2}-\d{2})$/))
    ) {
      const origin = m[1].match(/^([ET]\d+\.\d+)\b/)?.[1] ?? null;
      out.push({ ...base("concept", m[1], m[2]), origin_task: origin, reviews: Number(m[3]), next_review: m[4] });
    } else if (section === "resolved" && (m = line.match(/^- \[x\] (\d{4}-\d{2}-\d{2}) · (.*?)(?: → (.*))?$/i))) {
      out.push({ ...base("doubt", m[2], m[1]), status: "resolved", resolved_at: m[1], answer: m[3] ?? null });
    }
  }
  return out;
}

/**
 * Importa os 3 arquivos .md para o SQLite (os .md viram a verdade nesse momento).
 * Preserva minutos estudados e data de conclusão das tarefas que já existiam.
 */
export function syncFromMarkdown() {
  const progresso = readIfExists(FILES.progresso);
  if (!progresso) throw new Error(`Não encontrei ${FILES.progresso}`);
  const p = parseProgresso(progresso);
  const sessoes = readIfExists(FILES.sessoes);
  const duvidas = readIfExists(FILES.duvidas);

  tx(() => {
    const existing = new Map(all<Task>("SELECT * FROM tasks").map((t) => [t.id, t]));
    const seen = new Set<string>();
    for (const t of p.tasks) {
      seen.add(t.id);
      const old = existing.get(t.id);
      const doneAt = t.status === "done" ? (old?.done_at ?? null) : null;
      run(
        `INSERT INTO tasks (id, track, week, title, kind, energy, minutes, status, note, position, done_at, spent_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET track=excluded.track, week=excluded.week, title=excluded.title, kind=excluded.kind,
           energy=excluded.energy, minutes=excluded.minutes, status=excluded.status, note=excluded.note,
           position=excluded.position, done_at=excluded.done_at`,
        t.id, t.track, t.week, t.title, t.kind, t.energy, t.minutes, t.status, t.note, t.position, doneAt, old?.spent_minutes ?? 0,
      );
    }
    for (const id of existing.keys()) if (!seen.has(id)) run("DELETE FROM tasks WHERE id = ?", id);

    run("DELETE FROM weeks");
    for (const w of p.weeks) run("INSERT OR REPLACE INTO weeks (track, number, title) VALUES (?, ?, ?)", w.track, w.number, w.title);
    setMeta("routinesMd", p.routinesMd);
    if (p.startDate) setMeta("startDate", p.startDate);

    if (sessoes != null) {
      run("DELETE FROM sessions");
      for (const s of parseSessoes(sessoes).reverse()) {
        run(
          `INSERT INTO sessions (date, minutes, energy, location, task_ids, mission, result, learned, ai_opportunity, next_mission)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          s.date, s.minutes, s.energy, s.location, s.task_ids, s.mission, s.result, s.learned, s.ai_opportunity, s.next_mission,
        );
      }
    }
    if (duvidas != null) {
      run("DELETE FROM doubts");
      for (const d of parseDuvidas(duvidas)) {
        run(
          `INSERT INTO doubts (kind, text, origin_task, status, answer, created_at, resolved_at, reviews, next_review)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          d.kind, d.text, d.origin_task, d.status, d.answer, d.created_at, d.resolved_at, d.reviews, d.next_review,
        );
      }
    }
  });
  return { tasks: p.tasks.length, weeks: p.weeks.length };
}

export function initData() {
  const count = get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks")?.n ?? 0;
  if (count === 0) {
    const r = syncFromMarkdown();
    console.log(`📥 Importado do progresso.md: ${r.tasks} tarefas, ${r.weeks} semanas`);
  }
}
