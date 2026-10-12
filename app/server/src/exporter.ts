import fs from "node:fs";
import { all, getMeta } from "./db";
import { FILES } from "./paths";
import { computeStats } from "./stats";
import { ENERGY_EMOJI, KIND_EMOJI, type Doubt, type Session, type Task, type Track, type Week } from "./types";
import { formatDuration } from "./util";

const ENERGY_EMOJI_ANY: Record<string, string> = ENERGY_EMOJI;

function taskLine(t: Task): string {
  const mark = t.status === "done" ? "x" : t.status === "doing" ? "~" : " ";
  const emojis = `${t.kind ? KIND_EMOJI[t.kind] : ""}${t.energy ? ENERGY_EMOJI[t.energy] : ""}`;
  const dur = t.minutes ? ` · ${formatDuration(t.minutes)}` : "";
  const note = t.note ? ` — ${t.note}` : "";
  return `- [${mark}] **${t.id}** ${emojis ? emojis + " " : ""}${t.title}${dur}${note}`;
}

function weekBlocks(track: Track, tasks: Task[], weeks: Week[]): string {
  const titles = new Map(weeks.filter((w) => w.track === track).map((w) => [w.number, w.title]));
  const nums = [...new Set([...titles.keys(), ...tasks.filter((t) => t.track === track).map((t) => t.week)])].sort((a, b) => a - b);
  return nums
    .map((n) => {
      const lines = tasks.filter((t) => t.track === track && t.week === n).map(taskLine);
      return [`## Semana ${n}: ${titles.get(n) ?? "Novos temas"}`, ...lines].join("\n");
    })
    .join("\n\n");
}

export function renderProgresso(): string {
  const tasks = all<Task>("SELECT * FROM tasks ORDER BY track, week, position");
  const weeks = all<Week>("SELECT * FROM weeks ORDER BY track, number");
  const s = computeStats();
  const pct = (t: Track) => (s.progress[t].total ? Math.round((s.progress[t].done / s.progress[t].total) * 100) : 0);
  const routines = getMeta("routinesMd") ?? "";

  return `# 📈 Progresso

> Gerado automaticamente pelo app **Mentor SRE** (\`app/\`). Pode editar à mão, mas depois clique em "Sincronizar do .md" no app.

## Status atual
- **Semana atual (estudo):** ${s.currentWeek.E}
- **Semana atual (trabalho):** ${s.currentWeek.T}
- **Início:** ${getMeta("startDate") ?? "—"}
- **Dias estudados seguidos:** ${s.streak}
- **Última sessão:** ${s.lastSession ?? "—"}
- **Concluído:** estudo ${s.progress.E.done}/${s.progress.E.total} (${pct("E")}%) · trabalho ${s.progress.T.done}/${s.progress.T.total} (${pct("T")}%)

**Legenda:** \`[ ]\` a fazer · \`[~]\` em andamento (anotar onde parou) · \`[x]\` concluído
**Tipo:** 📚 curso/vídeo · 📖 leitura · 🛠️ lab · 🧠 checkpoint/revisão
**Energia:** 🟢 baixa · 🟡 média · 🔴 alta

---

# 🏠 Estudo (casa)

${weekBlocks("E", tasks, weeks)}

---

# 🏢 Trabalho

## Rotinas (não marcar, são contínuas)
${routines}

${weekBlocks("T", tasks, weeks)}
`;
}

export function renderSessoes(): string {
  const sessions = all<Session>("SELECT * FROM sessions ORDER BY date DESC, id DESC");
  const header = `# 📓 Diário de sessões

> Entradas mais recentes no topo. O mentor preenche no fechamento de cada sessão.

<!-- Modelo:
## AAAA-MM-DD · XX min · casa|trabalho · energia 🟢|🟡|🔴
- **Missão:** <ID> <título>
- **Resultado:** concluído | parcial (parou em ...)
- **Aprendi:** <1–2 linhas>
- **Oportunidade de IA vista:** <1 linha ou "—">
- **Próxima missão:** <ID> <título>
-->
`;
  if (!sessions.length) return `${header}\n_Nenhuma sessão ainda. Diga "bora" para começar!_\n`;
  const body = sessions
    .map((s) =>
      [
        `## ${s.date} · ${s.minutes ?? 0} min · ${s.location ?? "casa"} · energia ${s.energy ? ENERGY_EMOJI_ANY[s.energy] : "🟡"}`,
        `- **Missão:** ${s.mission ?? "—"}`,
        `- **Resultado:** ${s.result ?? "—"}`,
        `- **Aprendi:** ${s.learned ?? "—"}`,
        `- **Oportunidade de IA vista:** ${s.ai_opportunity ?? "—"}`,
        `- **Próxima missão:** ${s.next_mission ?? "—"}`,
      ].join("\n"),
    )
    .join("\n\n");
  return `${header}\n${body}\n`;
}

export function renderDuvidas(): string {
  const ds = all<Doubt>("SELECT * FROM doubts ORDER BY id");
  const open = ds.filter((d) => d.status === "open" && d.kind === "doubt");
  const explore = ds.filter((d) => d.status === "open" && d.kind === "explore");
  const concepts = ds.filter((d) => d.status === "open" && d.kind === "concept");
  const resolved = ds.filter((d) => d.status === "resolved");
  const lines = (arr: string[]) => (arr.length ? "\n" + arr.join("\n") : "");

  return `# ❓ Dúvidas e conceitos para revisar

## Em aberto
<!-- - [ ] AAAA-MM-DD · <dúvida> · (origem: E1.3) -->${lines(
    open.map((d) => `- [ ] ${d.created_at} · ${d.text}${d.origin_task ? ` · (origem: ${d.origin_task})` : ""}`),
  )}

## Explorar depois (fora da missão atual)
<!-- - AAAA-MM-DD · <assunto> -->${lines(explore.map((d) => `- ${d.created_at} · ${d.text}`))}

## Conceitos para revisar (repetição espaçada)
<!-- - <conceito> · aprendido em AAAA-MM-DD · revisões: 0 · próxima: AAAA-MM-DD
     Intervalos: 1, 3, 7, 14 dias -->${lines(
    concepts.map(
      (d) => `- ${d.text} · aprendido em ${d.created_at} · revisões: ${d.reviews} · próxima: ${d.next_review ?? d.created_at}`,
    ),
  )}

## Resolvidas
<!-- - [x] AAAA-MM-DD · <dúvida> → <resposta curta> -->${lines(
    resolved.map((d) => `- [x] ${d.resolved_at ?? d.created_at} · ${d.text}${d.answer ? ` → ${d.answer}` : ""}`),
  )}
`;
}

/** Espelha o SQLite nos .md do workspace (chamado após cada mudança). */
export function exportAll() {
  try {
    fs.writeFileSync(FILES.progresso, renderProgresso(), "utf8");
    fs.writeFileSync(FILES.sessoes, renderSessoes(), "utf8");
    fs.writeFileSync(FILES.duvidas, renderDuvidas(), "utf8");
  } catch (e) {
    console.error("Falha ao exportar .md:", e);
  }
}
