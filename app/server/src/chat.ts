import type { Content, FunctionDeclaration } from "@google/genai";
import { all, get, run } from "./db";
import { exportAll } from "./exporter";
import { extractText, generate } from "./llm";
import { readPlan } from "./quiz";
import {
  addDoubt,
  addTask,
  deleteTask,
  getDoubt,
  getTask,
  moveTask,
  resolveDoubt,
  updateTask,
  upsertWeek,
} from "./roadmap";
import { computeStats } from "./stats";
import { ENERGY_EMOJI, KIND_EMOJI, type ChatMessage, type Doubt, type PendingActionRow, type Task, type Week } from "./types";
import { HttpError, errMsg, formatDuration, today } from "./util";

const kindEnum = { type: "string", enum: ["course", "reading", "lab", "checkpoint"], description: "course=📚 curso/vídeo, reading=📖 leitura, lab=🛠️ prática, checkpoint=🧠 revisão" };
const energyEnum = { type: "string", enum: ["low", "med", "high"], description: "Energia necessária: low=🟢 med=🟡 high=🔴" };
const trackEnum = { type: "string", enum: ["E", "T"], description: "E = estudo em casa, T = trabalho" };

const TOOLS: FunctionDeclaration[] = [
  {
    name: "add_task",
    description: "Propõe adicionar uma micro-tarefa ao roadmap. O ID é gerado automaticamente.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        track: trackEnum,
        week: { type: "integer", description: "Número da semana (pode ser uma nova semana, ex.: 9)" },
        title: { type: "string" },
        kind: kindEnum,
        energy: energyEnum,
        minutes: { type: "integer", description: "Duração estimada (15–150)" },
        after_task_id: { type: "string", description: "Opcional: inserir logo depois desta tarefa (ex.: E2.3)" },
      },
      required: ["track", "week", "title"],
    },
  },
  {
    name: "update_task",
    description: "Propõe alterar campos de uma tarefa existente (título, tipo, energia, duração, status, nota).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        kind: kindEnum,
        energy: energyEnum,
        minutes: { type: "integer" },
        status: { type: "string", enum: ["todo", "doing", "done"] },
        note: { type: "string", description: "Onde parou / observação" },
      },
      required: ["id"],
    },
  },
  {
    name: "move_task",
    description: "Propõe mover uma tarefa para outra semana (o ID muda para refletir a semana) ou reordenar.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        week: { type: "integer" },
        after_task_id: { type: "string", description: "Opcional: posicionar depois desta tarefa" },
      },
      required: ["id", "week"],
    },
  },
  {
    name: "delete_task",
    description: "Propõe remover uma tarefa do roadmap.",
    parametersJsonSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "set_week",
    description: "Propõe criar uma semana nova ou renomear o tema de uma semana.",
    parametersJsonSchema: {
      type: "object",
      properties: { track: trackEnum, number: { type: "integer" }, title: { type: "string" } },
      required: ["track", "number", "title"],
    },
  },
  {
    name: "add_doubt",
    description: "Propõe registrar uma dúvida, um assunto para explorar depois, ou um conceito para revisão espaçada.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["doubt", "explore", "concept"] },
        text: { type: "string" },
        origin_task: { type: "string" },
      },
      required: ["kind", "text"],
    },
  },
  {
    name: "resolve_doubt",
    description: "Propõe marcar uma dúvida como resolvida, com a resposta curta.",
    parametersJsonSchema: {
      type: "object",
      properties: { id: { type: "integer" }, answer: { type: "string" } },
      required: ["id", "answer"],
    },
  },
];

function roadmapContext(): string {
  const tasks = all<Task>("SELECT * FROM tasks ORDER BY track, week, position");
  const weeks = all<Week>("SELECT * FROM weeks ORDER BY track, number");
  const doubts = all<Doubt>("SELECT * FROM doubts WHERE status = 'open' ORDER BY id");
  const s = computeStats();
  const mark = (t: Task) => (t.status === "done" ? "[x]" : t.status === "doing" ? "[~]" : "[ ]");
  const block = (track: "E" | "T") =>
    weeks
      .filter((w) => w.track === track)
      .map((w) => {
        const lines = tasks
          .filter((t) => t.track === track && t.week === w.number)
          .map(
            (t) =>
              `${mark(t)} ${t.id} | ${t.kind ?? "-"}/${t.energy ?? "-"} | ${t.minutes ? formatDuration(t.minutes) : "-"} | ${t.title}${t.note ? ` (nota: ${t.note})` : ""}${t.spent_minutes ? ` (já estudou ${t.spent_minutes} min)` : ""}`,
          );
        return `Semana ${w.number}: ${w.title}\n${lines.join("\n") || "(vazia)"}`;
      })
      .join("\n\n");
  return `## Estado atual (hoje: ${today()})
Semana atual: estudo ${s.currentWeek.E}, trabalho ${s.currentWeek.T}. Concluído: estudo ${s.progress.E.done}/${s.progress.E.total}, trabalho ${s.progress.T.done}/${s.progress.T.total}. Sequência: ${s.streak} dia(s). Última sessão: ${s.lastSession ?? "nenhuma"}.

## Roadmap de estudo (E)
${block("E")}

## Roadmap de trabalho (T)
${block("T")}

## Dúvidas/conceitos abertos
${doubts.map((d) => `#${d.id} [${d.kind}] ${d.text}${d.origin_task ? ` (origem ${d.origin_task})` : ""}${d.kind === "concept" ? ` (próxima revisão ${d.next_review})` : ""}`).join("\n") || "(nenhuma)"}`;
}

function systemInstruction(): string {
  return `Você é o **Mentor de Estudos** do Diogo, um SRE aprendendo a aplicar IA em operações (Dynatrace, Rundeck, GitHub Actions, AWS/Azure, AKS/EKS).
Fale sempre em português do Brasil, tom direto, encorajador e prático. Respostas curtas (use listas quando ajudar).

Neste chat você ajuda a: estabelecer e refinar o roadmap, discutir/adicionar novos temas, replanejar quando ele atrasar e tirar dúvidas conceituais (com analogias de SRE; prefira uma pergunta socrática antes de entregar a resposta pronta quando for conceito).

Como alterar o roadmap:
- Use as funções (add_task, update_task, move_task, delete_task, set_week, add_doubt, resolve_doubt). Cada chamada vira uma PROPOSTA que o Diogo aprova ou rejeita com um clique — nada muda sem aprovação.
- Antes de chamar, explique em 1–3 linhas o porquê. Pode chamar várias funções de uma vez.
- Tarefas são micro-tarefas de 15 min a 2h30, com tipo (📚📖🛠️🧠) e energia (🟢🟡🔴). Cada semana termina com um checkpoint 🧠.
- Novos temas: encaixe na semana que faz sentido ou crie uma semana nova (set_week + add_task). Ligue sempre o tema ao objetivo (IA aplicada a SRE).
- Mensagens começando com "[sistema]" informam ações aprovadas/rejeitadas; não as repita.

Regras: decida e recomende (no máximo 1 alternativa, nunca listas de opções); não invente links de cursos (diga nome e plataforma); nunca sugira colar dados da empresa em ferramentas pessoais; ao propor labs, lembre de budget alarm e permissões mínimas.

${roadmapContext()}

## Plano de estudo (resumo do arquivo planos/plano_estudo_casa.md)
${readPlan("E")}

## Plano de trabalho (resumo do arquivo planos/plano_trabalho.md)
${readPlan("T")}`;
}

// ---------------- descrição e aplicação das ações ----------------
type Args = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));

function describeAction(name: string, a: Args): string {
  const emo = `${a.kind ? (KIND_EMOJI as Record<string, string>)[str(a.kind)] ?? "" : ""}${a.energy ? (ENERGY_EMOJI as Record<string, string>)[str(a.energy)] ?? "" : ""}`;
  const dur = a.minutes ? ` · ${formatDuration(Number(a.minutes))}` : "";
  switch (name) {
    case "add_task":
      return `➕ Adicionar em ${str(a.track) === "T" ? "Trabalho" : "Estudo"} · Semana ${str(a.week)}: ${emo ? emo + " " : ""}"${str(a.title)}"${dur}${a.after_task_id ? ` (depois de ${str(a.after_task_id)})` : ""}`;
    case "update_task": {
      const ch = ["title", "kind", "energy", "minutes", "status", "note"]
        .filter((k) => a[k] !== undefined)
        .map((k) => `${k} → ${str(a[k])}`);
      let title = "";
      try {
        title = ` "${getTask(str(a.id)).title}"`;
      } catch {
        /* tarefa pode não existir; o erro aparece ao aplicar */
      }
      return `✏️ Atualizar ${str(a.id)}${title}: ${ch.join(", ") || "(sem mudanças)"}`;
    }
    case "move_task":
      return `↔️ Mover ${str(a.id)} para a Semana ${str(a.week)}${a.after_task_id ? ` (depois de ${str(a.after_task_id)})` : ""}`;
    case "delete_task": {
      let title = "";
      try {
        title = ` "${getTask(str(a.id)).title}"`;
      } catch {
        /* idem */
      }
      return `🗑️ Remover ${str(a.id)}${title}`;
    }
    case "set_week":
      return `📅 ${str(a.track) === "T" ? "Trabalho" : "Estudo"} · Semana ${str(a.number)}: "${str(a.title)}"`;
    case "add_doubt": {
      const label = { doubt: "dúvida", explore: "explorar depois", concept: "conceito p/ revisão" }[str(a.kind)] ?? str(a.kind);
      return `❓ Registrar ${label}: "${str(a.text)}"`;
    }
    case "resolve_doubt": {
      let text = "";
      try {
        text = ` "${getDoubt(a.id).text}"`;
      } catch {
        /* idem */
      }
      return `✅ Resolver dúvida #${str(a.id)}${text} → ${str(a.answer)}`;
    }
    default:
      return `${name}(${JSON.stringify(a)})`;
  }
}

function applyAction(name: string, a: Args): string {
  switch (name) {
    case "add_task":
      return `criada ${addTask(a)}`;
    case "update_task":
      return `atualizada ${updateTask(str(a.id), a).id}`;
    case "move_task":
      return `agora é ${moveTask(str(a.id), a.week, a.after_task_id)}`;
    case "delete_task":
      return `removida ${deleteTask(str(a.id)).id}`;
    case "set_week":
      upsertWeek(a.track, a.number, a.title);
      return "semana salva";
    case "add_doubt":
      return `registrada #${addDoubt(a.kind, a.text, a.origin_task)}`;
    case "resolve_doubt":
      resolveDoubt(a.id, a.answer);
      return "resolvida";
    default:
      throw new HttpError(400, `Ação desconhecida: ${name}`);
  }
}

// ---------------- API ----------------
export function getChat() {
  return {
    messages: all<ChatMessage>("SELECT * FROM chat_messages ORDER BY id"),
    actions: all<PendingActionRow>("SELECT * FROM pending_actions ORDER BY id").map((a) => ({ ...a, args: JSON.parse(a.args) })),
  };
}

export async function sendChat(textRaw: unknown) {
  const text = str(textRaw).trim();
  if (!text) throw new HttpError(400, "Mensagem vazia");
  run("INSERT INTO chat_messages (role, content) VALUES ('user', ?)", text.slice(0, 8000));

  const history = all<ChatMessage>("SELECT * FROM chat_messages ORDER BY id DESC LIMIT 40").reverse();
  const contents: Content[] = [];
  for (const m of history) {
    const role = m.role === "model" ? "model" : "user";
    const t = m.role === "system_note" ? `[sistema] ${m.content}` : m.content;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts!.push({ text: t });
    else contents.push({ role, parts: [{ text: t }] });
  }
  while (contents.length && contents[0].role === "model") contents.shift();

  const res = await generate({
    contents,
    config: { systemInstruction: systemInstruction(), tools: [{ functionDeclarations: TOOLS }], temperature: 0.6 },
  });
  const reply = extractText(res).trim();
  const calls = (res.functionCalls ?? []).filter((c) => c.name);
  const msg = run(
    "INSERT INTO chat_messages (role, content) VALUES ('model', ?)",
    reply || (calls.length ? "Proponho estas mudanças:" : "(sem resposta — tente reformular)"),
  );
  const mid = Number(msg.lastInsertRowid);
  for (const c of calls) {
    const args = (c.args ?? {}) as Args;
    run(
      "INSERT INTO pending_actions (message_id, name, args, description) VALUES (?, ?, ?, ?)",
      mid, c.name!, JSON.stringify(args), describeAction(c.name!, args),
    );
  }
  return getChat();
}

export function decideAction(id: number, decision: unknown) {
  const a = get<PendingActionRow>("SELECT * FROM pending_actions WHERE id = ?", id);
  if (!a) throw new HttpError(404, "Ação não encontrada");
  if (a.status !== "pending") throw new HttpError(409, "Essa ação já foi decidida");
  if (decision === "apply") {
    try {
      const result = applyAction(a.name, JSON.parse(a.args));
      run("UPDATE pending_actions SET status = 'applied', result = ? WHERE id = ?", result, a.id);
      run("INSERT INTO chat_messages (role, content) VALUES ('system_note', ?)", `Aplicado: ${a.description} (${result})`);
      exportAll();
    } catch (e) {
      run("UPDATE pending_actions SET status = 'failed', result = ? WHERE id = ?", errMsg(e), a.id);
      run("INSERT INTO chat_messages (role, content) VALUES ('system_note', ?)", `Falhou: ${a.description} (${errMsg(e)})`);
    }
  } else {
    run("UPDATE pending_actions SET status = 'rejected' WHERE id = ?", a.id);
    run("INSERT INTO chat_messages (role, content) VALUES ('system_note', ?)", `Diogo rejeitou: ${a.description}`);
  }
  return getChat();
}

export function clearChat() {
  run("DELETE FROM pending_actions");
  run("DELETE FROM chat_messages");
  return getChat();
}
