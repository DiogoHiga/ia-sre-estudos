import fs from "node:fs";
import { all, get, getSettings, run, tx } from "./db";
import { exportAll } from "./exporter";
import { extractText, generate } from "./llm";
import { FILES } from "./paths";
import { addDoubt, getDoubt, getTask, reviewConcept, updateTask } from "./roadmap";
import { KIND_EMOJI, type Task } from "./types";
import { HttpError, formatDuration, oneLine } from "./util";

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  concept: string;
}

interface AttemptRow {
  id: number;
  task_id: string;
  mode: "complete" | "review";
  concept_id: number | null;
  questions: string;
  graded_at: string | null;
}

const QUIZ_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string", description: "Pergunta curta e objetiva" },
          options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
          correctIndex: { type: "integer", minimum: 0, maximum: 3 },
          explanation: { type: "string", description: "Por que a correta está certa (1–2 frases)" },
          concept: { type: "string", description: "Conceito avaliado, em 2–5 palavras" },
        },
        required: ["question", "options", "correctIndex", "explanation", "concept"],
      },
    },
  },
  required: ["questions"],
};

export function readPlan(track: "E" | "T"): string {
  const file = track === "E" ? FILES.planoCasa : FILES.planoTrabalho;
  try {
    return fs.readFileSync(file, "utf8").slice(0, 12000);
  } catch {
    return "";
  }
}

function describeTask(t: Task) {
  return `${t.id} ${t.kind ? KIND_EMOJI[t.kind] : ""} "${t.title}"${t.minutes ? ` (${formatDuration(t.minutes)})` : ""}`;
}

export async function createQuiz(body: { taskId: string; notes?: string; mode?: string; conceptId?: number }) {
  const mode = body.mode === "review" ? "review" : "complete";
  const task = getTask(body.taskId);
  if (mode === "review") getDoubt(body.conceptId);
  const { quizQuestions } = getSettings();

  const previous = all<{ questions: string }>(
    "SELECT questions FROM quiz_attempts WHERE task_id = ? ORDER BY id DESC LIMIT 2",
    task.id,
  ).flatMap((r) => (JSON.parse(r.questions) as QuizQuestion[]).map((q) => q.question));

  const prompt = [
    mode === "review"
      ? `Revisão espaçada do conteúdo ${describeTask(task)}, estudado há alguns dias.`
      : `O Diogo acabou de estudar: ${describeTask(task)}.`,
    body.notes?.trim() ? `Anotações dele sobre o que estudou / onde parou:\n"""${body.notes.trim().slice(0, 2000)}"""` : "",
    `Gere exatamente ${quizQuestions} perguntas de múltipla escolha (4 alternativas, só 1 correta) em português do Brasil.`,
    "Regras:",
    "- Avalie COMPREENSÃO dos conceitos centrais desse conteúdo (o que é, por que, quando usar, o que acontece se), não decoreba de nomes ou números.",
    "- Se for curso/vídeo conhecido, baseie-se no que esse material realmente ensina. Se for lab (🛠️), pergunte sobre os conceitos e decisões técnicas envolvidas.",
    "- Sempre que fizer sentido, contextualize com o dia a dia de SRE (Dynatrace, Rundeck, GitHub Actions, AWS/Azure, Kubernetes).",
    "- Alternativas erradas plausíveis; varie a posição da correta.",
    "- Se ele anotou que estudou só parte do conteúdo, pergunte apenas sobre essa parte.",
    previous.length ? `- Não repita estas perguntas já feitas:\n${previous.map((q) => `  • ${q}`).join("\n")}` : "",
    `\nContexto do plano de estudos (para entender o objetivo):\n${readPlan(task.track)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await generate({
    contents: prompt,
    config: {
      systemInstruction: "Você é um tutor técnico que cria quizzes curtos e justos para um SRE aprendendo IA aplicada a operações.",
      responseMimeType: "application/json",
      responseJsonSchema: QUIZ_SCHEMA,
      temperature: 0.8,
    },
  });

  let parsed: { questions?: QuizQuestion[] };
  try {
    parsed = JSON.parse(extractText(res));
  } catch {
    throw new HttpError(502, "O modelo devolveu um quiz em formato inválido. Tente de novo.");
  }
  const questions = (parsed.questions ?? [])
    .filter(
      (q) =>
        q &&
        typeof q.question === "string" &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        Number.isInteger(q.correctIndex) &&
        q.correctIndex >= 0 &&
        q.correctIndex < 4,
    )
    .slice(0, quizQuestions);
  if (!questions.length) throw new HttpError(502, "O modelo não devolveu perguntas válidas. Tente de novo.");

  const r = run(
    "INSERT INTO quiz_attempts (task_id, mode, concept_id, questions) VALUES (?, ?, ?, ?)",
    task.id, mode, mode === "review" ? Number(body.conceptId) : null, JSON.stringify(questions),
  );
  // O gabarito fica só no servidor até a correção.
  return {
    attemptId: Number(r.lastInsertRowid),
    questions: questions.map(({ question, options, concept }) => ({ question, options, concept })),
  };
}

export function gradeQuiz(attemptId: number, answers: unknown) {
  const a = get<AttemptRow>("SELECT * FROM quiz_attempts WHERE id = ?", attemptId);
  if (!a) throw new HttpError(404, "Quiz não encontrado");
  if (a.graded_at) throw new HttpError(409, "Esse quiz já foi corrigido. Gere um novo para tentar de novo.");
  const qs = JSON.parse(a.questions) as QuizQuestion[];
  const ans = Array.isArray(answers) ? answers.map((x) => Number(x)) : [];
  const results = qs.map((q, i) => ({ ...q, chosen: ans[i] ?? -1, correct: ans[i] === q.correctIndex }));
  const correct = results.filter((r) => r.correct).length;
  const pct = Math.round((correct / qs.length) * 100);
  const { quizPassPct } = getSettings();
  const passed = pct >= quizPassPct;
  const task = getTask(a.task_id);

  tx(() => {
    run(
      "UPDATE quiz_attempts SET answers = ?, score = ?, passed = ?, graded_at = datetime('now', 'localtime') WHERE id = ?",
      JSON.stringify(ans), pct, passed ? 1 : 0, a.id,
    );
    if (a.mode === "complete") {
      if (passed) {
        updateTask(task.id, { status: "done" });
        addDoubt("concept", `${task.id} ${task.title}`, task.id);
        // dúvidas abertas desse conteúdo que o quiz confirmou
        run(
          "UPDATE doubts SET status = 'resolved', resolved_at = date('now', 'localtime'), answer = COALESCE(answer, 'confirmado no quiz') WHERE kind = 'doubt' AND status = 'open' AND origin_task = ?",
          task.id,
        );
      } else if (task.status === "todo") {
        updateTask(task.id, { status: "doing" });
      }
    } else if (a.concept_id) {
      reviewConcept(a.concept_id, passed);
    }
    for (const r of results.filter((x) => !x.correct)) {
      addDoubt("doubt", oneLine(`${r.concept}: ${r.question}`), task.id);
    }
  });
  exportAll();

  return {
    correct,
    total: qs.length,
    pct,
    passed,
    passPct: quizPassPct,
    mode: a.mode,
    task: getTask(task.id),
    results,
  };
}
