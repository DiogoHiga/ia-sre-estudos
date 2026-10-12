import { all, get } from "./db";
import type { Doubt, Energy, Task, Track } from "./types";
import { HttpError, today } from "./util";

export interface PlanParams {
  minutes: number;
  energy: Energy;
  location: "casa" | "trabalho";
}

export interface PlanItem {
  task: Task;
  plannedMinutes: number | null;
  partial: boolean;
  reason: string;
}

export interface PlanResult {
  track: Track;
  week: number | null;
  weekTitle: string | null;
  available: number;
  items: PlanItem[];
  reviews: Doubt[];
  message: string | null;
}

const CLOSING_MIN = 5;

/** Regras de energia do mentor: baixa = só 📚/📖/🧠 leves; média = nada 🔴; alta = tudo. */
function fitsEnergy(t: Task, energy: Energy): boolean {
  if (t.track === "T") return true;
  if (energy === "high") return true;
  if (energy === "med") return t.energy !== "high";
  return t.kind !== "lab" && t.energy !== "high";
}

export function validatePlanParams(b: Record<string, unknown>): PlanParams {
  const minutes = Math.round(Number(b.minutes));
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 600) throw new HttpError(400, "Informe o tempo em minutos (5–600)");
  const energy = (["low", "med", "high"] as const).find((e) => e === b.energy);
  if (!energy) throw new HttpError(400, "Energia inválida");
  const location = b.location === "trabalho" ? "trabalho" : "casa";
  return { minutes, energy, location };
}

/**
 * Escolhe a missão seguindo o protocolo do AGENTS.md:
 * continuidade → sequência da semana → encaixe no tempo (reserva 5 min de fechamento) → energia.
 * Totalmente determinístico: não gasta quota de LLM.
 */
export function plan(p: PlanParams): PlanResult {
  const track: Track = p.location === "trabalho" ? "T" : "E";
  const available = Math.max(p.minutes - CLOSING_MIN, 5);
  const pending = all<Task>("SELECT * FROM tasks WHERE track = ? AND status != 'done' ORDER BY week, position", track);
  const reviews =
    track === "E"
      ? all<Doubt>("SELECT * FROM doubts WHERE kind = 'concept' AND status = 'open' AND next_review <= ? ORDER BY next_review, id", today())
      : [];
  const base = { track, available, reviews, week: null, weekTitle: null, items: [] as PlanItem[], message: null as string | null };

  if (!pending.length) return { ...base, message: "Trilha concluída! 🎉 Use o chat para planejar os próximos temas." };

  const week = pending[0].week;
  const weekTitle = get<{ title: string }>("SELECT title FROM weeks WHERE track = ? AND number = ?", track, week)?.title ?? null;
  const res: PlanResult = { ...base, week, weekTitle };

  // Sessão curta com revisões vencidas → repetição espaçada primeiro.
  if (track === "E" && available <= 15 && reviews.length) {
    return { ...res, reviews: reviews.slice(0, 3), message: "Sessão curta: faça a revisão espaçada dos conceitos abaixo (quiz rápido)." };
  }

  const doing = pending.filter((t) => t.status === "doing");
  const seq = pending.filter((t) => t.status === "todo" && t.week === week);
  const ordered = [...doing, ...seq];
  let candidates = ordered.filter((t) => fitsEnergy(t, p.energy));

  if (!candidates.length) {
    if (reviews.length) {
      return { ...res, message: "Energia baixa e só sobrou tarefa pesada nesta semana: hoje é dia de revisão espaçada." };
    }
    candidates = ordered;
    res.message = "As tarefas restantes da semana pedem mais energia. Comece pela primeira, no seu ritmo.";
  }

  if (track === "T") {
    res.items = candidates.slice(0, 2).map((t) => ({
      task: t,
      plannedMinutes: null,
      partial: false,
      reason: t.status === "doing" ? `Continuidade: ficou em andamento${t.note ? ` (${t.note})` : ""}.` : `Próximo item da Semana ${week} do trabalho.`,
    }));
    return res;
  }

  let left = available;
  for (const t of candidates) {
    const remaining = Math.max((t.minutes ?? 30) - t.spent_minutes, 10);
    const reason =
      t.status === "doing"
        ? `Continuidade: ficou em andamento${t.note ? ` (parou em: ${t.note})` : ""}.`
        : res.items.length === 0
          ? `Próxima da sequência da Semana ${week}.`
          : "Cabe no tempo que sobrou.";
    if (remaining <= left) {
      res.items.push({ task: t, plannedMinutes: remaining, partial: false, reason });
      left -= remaining;
    } else if (res.items.length === 0) {
      res.items.push({
        task: t,
        plannedMinutes: left,
        partial: true,
        reason: `${reason} Não cabe inteira (faltam ~${remaining} min): faça ~${left} min e anote onde parou.`,
      });
      left = 0;
    }
    if (left < 15) break;
  }
  return res;
}

export function nextMissionText(track: Track): string {
  const t = get<Task>(
    "SELECT * FROM tasks WHERE track = ? AND status != 'done' ORDER BY CASE status WHEN 'doing' THEN 0 ELSE 1 END, week, position LIMIT 1",
    track,
  );
  return t ? `${t.id} ${t.title}${t.status === "doing" && t.note ? ` (continuar: ${t.note})` : ""}` : "Trilha concluída 🎉 — planejar próximos temas no chat";
}
