import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type Track = "E" | "T";
type Kind = "course" | "reading" | "lab" | "checkpoint";
type Energy = "low" | "med" | "high";
type Status = "todo" | "doing" | "done";

interface Task {
  id: string;
  track: Track;
  week: number;
  title: string;
  kind: Kind | null;
  energy: Energy | null;
  minutes: number | null;
  spent_minutes: number;
  status: Status;
  note: string | null;
  position: number;
  done_at: string | null;
}
interface Week {
  track: Track;
  number: number;
  title: string;
}
interface Doubt {
  id: number;
  kind: "doubt" | "explore" | "concept";
  text: string;
  origin_task: string | null;
  status: "open" | "resolved";
  answer: string | null;
  created_at: string;
  resolved_at: string | null;
  reviews: number;
  next_review: string | null;
}
interface Session {
  id: number;
  date: string;
  minutes: number | null;
  energy: Energy | null;
  location: string | null;
  mission: string | null;
  result: string | null;
  learned: string | null;
  ai_opportunity: string | null;
  next_mission: string | null;
}
interface Settings {
  focusMin: number;
  breakMin: number;
  longBreakMin: number;
  cyclesBeforeLong: number;
  quizQuestions: number;
  quizPassPct: number;
}
interface AppState {
  tasks: Task[];
  weeks: Week[];
  doubts: Doubt[];
  sessions: Session[];
  stats: {
    currentWeek: Record<Track, number | null>;
    streak: number;
    lastSession: string | null;
    progress: Record<Track, { done: number; total: number }>;
  };
  settings: Settings;
  routinesMd: string;
  llm: { hasKey: boolean; model: string };
}
interface PlanItem {
  task: Task;
  plannedMinutes: number | null;
  partial: boolean;
  reason: string;
}
interface PlanResult {
  track: Track;
  week: number | null;
  weekTitle: string | null;
  available: number;
  items: PlanItem[];
  reviews: Doubt[];
  message: string | null;
}
interface ChatMessage {
  id: number;
  role: "user" | "model" | "system_note";
  content: string;
  created_at: string;
}
interface PendingAction {
  id: number;
  message_id: number;
  name: string;
  args: Record<string, unknown>;
  description: string;
  status: "pending" | "applied" | "rejected" | "failed";
  result: string | null;
}
interface QuizQuestion {
  question: string;
  options: string[];
  concept: string;
}
interface QuizGradeResult {
  correct: number;
  total: number;
  pct: number;
  passed: boolean;
  passPct: number;
  mode: "complete" | "review";
  task: Task;
  results: Array<QuizQuestion & { chosen: number; correctIndex: number; correct: boolean; explanation: string }>;
}

const KIND_ICON: Record<Kind, string> = { course: "📚", reading: "📖", lab: "🛠️", checkpoint: "🧠" };
const ENERGY_ICON: Record<Energy, string> = { low: "🟢", med: "🟡", high: "🔴" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro HTTP ${res.status}`);
  return data as T;
}

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, 350);
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<"study" | "roadmap" | "chat" | "doubts" | "settings">("study");
  const [error, setError] = useState<string | null>(null);

  // Check-in & plano
  const [minutes, setMinutes] = useState<number>(40);
  const [energy, setEnergy] = useState<Energy>("med");
  const [location, setLocation] = useState<"casa" | "trabalho">("casa");
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [studyNotes, setStudyNotes] = useState<string>("");

  // Pomodoro
  const [pomoPhase, setPomoPhase] = useState<"focus" | "break" | "long">("focus");
  const [pomoSeconds, setPomoSeconds] = useState<number>(25 * 60);
  const [pomoRunning, setPomoRunning] = useState<boolean>(false);
  const [pomoCycles, setPomoCycles] = useState<number>(0);
  const focusAccSec = useRef<number>(0);

  // Quiz modal
  const [quizOpen, setQuizOpen] = useState<boolean>(false);
  const [quizLoading, setQuizLoading] = useState<boolean>(false);
  const [quizTask, setQuizTask] = useState<Task | null>(null);
  const [quizMode, setQuizMode] = useState<"complete" | "review">("complete");
  const [quizConceptId, setQuizConceptId] = useState<number | undefined>(undefined);
  const [quizAttemptId, setQuizAttemptId] = useState<number | null>(null);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizResult, setQuizResult] = useState<QuizGradeResult | null>(null);

  // Fechamento de sessão
  const [closeOpen, setCloseOpen] = useState<boolean>(false);
  const [closeLearned, setCloseLearned] = useState<string>("");
  const [closeOpp, setCloseOpp] = useState<string>("");
  const [closeResult, setCloseResult] = useState<string>("concluído");

  // Roadmap view
  const [rmTrack, setRmTrack] = useState<Track>("E");
  const [rmFilter, setRmFilter] = useState<"all" | Status>("all");
  const [newTaskWeek, setNewTaskWeek] = useState<number>(1);
  const [newTaskTitle, setNewTaskTitle] = useState<string>("");
  const [newTaskKind, setNewTaskKind] = useState<Kind>("reading");
  const [newTaskEnergy, setNewTaskEnergy] = useState<Energy>("low");
  const [newTaskMin, setNewTaskMin] = useState<number>(45);

  // Chat
  const [chatMsgs, setChatMsgs] = useState<ChatMessage[]>([]);
  const [chatActions, setChatActions] = useState<PendingAction[]>([]);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatSending, setChatSending] = useState<boolean>(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Dúvidas
  const [doubtKind, setDoubtKind] = useState<"doubt" | "explore" | "concept">("doubt");
  const [doubtText, setDoubtText] = useState<string>("");

  async function loadAll() {
    try {
      const [s, c] = await Promise.all([
        api<AppState>("/api/state"),
        api<{ messages: ChatMessage[]; actions: PendingAction[] }>("/api/chat"),
      ]);
      setState(s);
      setChatMsgs(c.messages);
      setChatActions(c.actions);
      const p = await api<PlanResult>("/api/plan", {
        method: "POST",
        body: JSON.stringify({ minutes, energy, location }),
      });
      setPlan(p);
      if (p.items[0] && !activeTaskId) {
        setActiveTaskId(p.items[0].task.id);
        setStudyNotes(p.items[0].task.note ?? "");
      }
      setPomoSeconds(s.settings.focusMin * 60);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function requestPlan(min = minutes, en = energy, loc = location) {
    try {
      const p = await api<PlanResult>("/api/plan", {
        method: "POST",
        body: JSON.stringify({ minutes: min, energy: en, location: loc }),
      });
      setPlan(p);
      if (p.items[0]) {
        setActiveTaskId(p.items[0].task.id);
        setStudyNotes(p.items[0].task.note ?? "");
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Timer Pomodoro
  useEffect(() => {
    if (!pomoRunning || !state) return;
    const id = setInterval(() => {
      if (pomoPhase === "focus" && activeTaskId) {
        focusAccSec.current += 1;
        if (focusAccSec.current >= 60) {
          focusAccSec.current -= 60;
          api<AppState>(`/api/tasks/${activeTaskId}/spent`, {
            method: "POST",
            body: JSON.stringify({ minutes: 1 }),
          })
            .then(setState)
            .catch(() => {});
        }
      }
      setPomoSeconds((s) => {
        if (s > 1) return s - 1;
        beep();
        if (pomoPhase === "focus") {
          const nextCycles = pomoCycles + 1;
          setPomoCycles(nextCycles);
          const isLong = nextCycles % state.settings.cyclesBeforeLong === 0;
          setPomoPhase(isLong ? "long" : "break");
          return (isLong ? state.settings.longBreakMin : state.settings.breakMin) * 60;
        } else {
          setPomoPhase("focus");
          return state.settings.focusMin * 60;
        }
      });
    }, 1000);
    return () => clearInterval(id);
  }, [pomoRunning, pomoPhase, pomoCycles, activeTaskId, state]);

  function selectPomoPhase(phase: "focus" | "break" | "long") {
    if (!state) return;
    setPomoRunning(false);
    setPomoPhase(phase);
    const min =
      phase === "focus"
        ? state.settings.focusMin
        : phase === "break"
          ? state.settings.breakMin
          : state.settings.longBreakMin;
    setPomoSeconds(min * 60);
  }

  async function savePartialNote(taskId: string, note: string) {
    try {
      const s = await api<AppState>(`/api/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "doing", note }),
      });
      setState(s);
      await requestPlan();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function startQuiz(task: Task, mode: "complete" | "review" = "complete", conceptId?: number) {
    setError(null);
    setQuizTask(task);
    setQuizMode(mode);
    setQuizConceptId(conceptId);
    setQuizOpen(true);
    setQuizLoading(true);
    setQuizResult(null);
    setQuizQuestions([]);
    try {
      const r = await api<{ attemptId: number; questions: QuizQuestion[] }>("/api/quiz/generate", {
        method: "POST",
        body: JSON.stringify({ taskId: task.id, notes: studyNotes, mode, conceptId }),
      });
      setQuizAttemptId(r.attemptId);
      setQuizQuestions(r.questions);
      setQuizAnswers(new Array(r.questions.length).fill(-1));
    } catch (e) {
      setError((e as Error).message);
      setQuizOpen(false);
    } finally {
      setQuizLoading(false);
    }
  }

  async function submitQuiz() {
    if (quizAttemptId == null) return;
    setQuizLoading(true);
    try {
      const r = await api<QuizGradeResult & { state: AppState }>(`/api/quiz/${quizAttemptId}/grade`, {
        method: "POST",
        body: JSON.stringify({ answers: quizAnswers }),
      });
      setQuizResult(r);
      setState(r.state);
      await requestPlan();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setQuizLoading(false);
    }
  }

  async function saveSessionLog() {
    try {
      const ids = plan?.items.map((i) => i.task.id) ?? (activeTaskId ? [activeTaskId] : []);
      const s = await api<AppState>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          minutes,
          energy,
          location,
          taskIds: ids,
          mission: ids.join(", "),
          result: closeResult,
          learned: closeLearned,
          aiOpportunity: closeOpp,
        }),
      });
      setState(s);
      setCloseOpen(false);
      setCloseLearned("");
      setCloseOpp("");
      await requestPlan();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function sendChatMessage(customPrompt?: string) {
    const text = (customPrompt ?? chatInput).trim();
    if (!text || chatSending) return;
    if (!customPrompt) setChatInput("");
    setChatSending(true);
    setError(null);
    try {
      const c = await api<{ messages: ChatMessage[]; actions: PendingAction[] }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text }),
      });
      setChatMsgs(c.messages);
      setChatActions(c.actions);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChatSending(false);
    }
  }

  async function handleActionDecision(actionId: number, decision: "apply" | "reject") {
    try {
      const r = await api<{ chat: { messages: ChatMessage[]; actions: PendingAction[] }; state: AppState }>(
        `/api/chat/actions/${actionId}`,
        { method: "POST", body: JSON.stringify({ decision }) },
      );
      setChatMsgs(r.chat.messages);
      setChatActions(r.chat.actions);
      setState(r.state);
      await requestPlan();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!state) {
    return <div className="app">Carregando Mentor SRE...</div>;
  }

  const activeTask = state.tasks.find((t) => t.id === activeTaskId) ?? plan?.items[0]?.task ?? null;
  const pctE = state.stats.progress.E.total
    ? Math.round((state.stats.progress.E.done / state.stats.progress.E.total) * 100)
    : 0;
  const pctT = state.stats.progress.T.total
    ? Math.round((state.stats.progress.T.done / state.stats.progress.T.total) * 100)
    : 0;

  const fmtClock = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="app">
      {/* Topbar */}
      <header className="topbar">
        <div className="brand">
          <span style={{ fontSize: "1.9rem" }}>🎓</span>
          <div>
            <h1>Mentor de IA para SRE</h1>
            <small>
              Modelo: {state.llm.model} {state.llm.hasKey ? "🟢" : "🔴 sem API key"} · Sincronizado com{" "}
              <code>progresso.md</code>
            </small>
          </div>
        </div>
        <div className="stats-pills">
          <span className="pill">🏠 Semana {state.stats.currentWeek.E} · {pctE}% ({state.stats.progress.E.done}/{state.stats.progress.E.total})</span>
          <span className="pill">🏢 Semana {state.stats.currentWeek.T} · {pctT}% ({state.stats.progress.T.done}/{state.stats.progress.T.total})</span>
          <span className="pill">🔥 Sequência: {state.stats.streak}d</span>
        </div>
      </header>

      {error && (
        <div className="banner-err">
          <span>⚠️ {error}</span>
          <button className="btn sm" onClick={() => setError(null)}>Fechar</button>
        </div>
      )}

      {/* Tabs */}
      <nav className="tabs">
        <button className={`tab ${tab === "study" ? "active" : ""}`} onClick={() => setTab("study")}>
          🎯 Estudar Agora
        </button>
        <button className={`tab ${tab === "roadmap" ? "active" : ""}`} onClick={() => setTab("roadmap")}>
          🗺️ Roadmap ({state.stats.progress.E.done + state.stats.progress.T.done}/{state.stats.progress.E.total + state.stats.progress.T.total})
        </button>
        <button className={`tab ${tab === "chat" ? "active" : ""}`} onClick={() => setTab("chat")}>
          💬 Chat & Refinar Roadmap
        </button>
        <button className={`tab ${tab === "doubts" ? "active" : ""}`} onClick={() => setTab("doubts")}>
          🧠 Dúvidas & Revisão ({state.doubts.filter((d) => d.status === "open").length})
        </button>
        <button className={`tab ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>
          ⚙️ Configurações
        </button>
      </nav>

      {/* ABA 1: ESTUDAR AGORA */}
      {tab === "study" && (
        <div className="grid-2">
          <div>
            {/* Check-in */}
            <div className="card">
              <h3>1️⃣ Check-in rápido</h3>
              <div className="row" style={{ marginBottom: 10 }}>
                <label>⏱️ Tempo (min):</label>
                <input
                  type="number"
                  className="input"
                  style={{ width: 85 }}
                  value={minutes}
                  min={10}
                  max={360}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                />
                {[20, 40, 60, 90, 120].map((m) => (
                  <button
                    key={m}
                    className={`btn sm chip ${minutes === m ? "selected" : ""}`}
                    onClick={() => {
                      setMinutes(m);
                      requestPlan(m, energy, location);
                    }}
                  >
                    {m}m
                  </button>
                ))}
              </div>
              <div className="row" style={{ marginBottom: 10 }}>
                <label>🔋 Energia:</label>
                {([
                  ["low", "🟢 Baixa (ler/vídeo)"],
                  ["med", "🟡 Média (exercício)"],
                  ["high", "🔴 Alta (codar lab)"],
                ] as const).map(([val, label]) => (
                  <button
                    key={val}
                    className={`btn sm chip ${energy === val ? "selected" : ""}`}
                    onClick={() => {
                      setEnergy(val);
                      requestPlan(minutes, val, location);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="row">
                <label>📍 Onde:</label>
                {([
                  ["casa", "🏠 Casa (Estudo)"],
                  ["trabalho", "🏢 Trabalho"],
                ] as const).map(([loc, label]) => (
                  <button
                    key={loc}
                    className={`btn sm chip ${location === loc ? "selected" : ""}`}
                    onClick={() => {
                      setLocation(loc);
                      requestPlan(minutes, energy, loc);
                    }}
                  >
                    {label}
                  </button>
                ))}
                <button className="btn primary sm" onClick={() => requestPlan()}>
                  🔄 Recalcular missão
                </button>
              </div>
            </div>

            {/* Missão sugerida */}
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>
                  2️⃣ Missão sugerida{" "}
                  {plan?.week ? `— Semana ${plan.week}${plan.weekTitle ? `: ${plan.weekTitle}` : ""}` : ""}
                </h3>
                <span className="badge">{plan?.available ?? minutes - 5} min úteis + 5 min fechamento</span>
              </div>
              {plan?.message && <p className="muted">{plan.message}</p>}

              {plan?.items.map((item) => {
                const t = state.tasks.find((x) => x.id === item.task.id) ?? item.task;
                const isSel = activeTask?.id === t.id;
                return (
                  <div
                    key={t.id}
                    className={`mission-item ${isSel ? "selected" : ""}`}
                    onClick={() => {
                      setActiveTaskId(t.id);
                      setStudyNotes(t.note ?? "");
                    }}
                  >
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <strong>
                        {t.id} · {t.kind ? KIND_ICON[t.kind] : ""}{" "}
                        {t.energy ? ENERGY_ICON[t.energy] : ""} {t.title}
                      </strong>
                      <span className="badge">
                        {item.plannedMinutes ? `${item.plannedMinutes} min hoje` : ""}
                        {t.minutes ? ` (total ${t.minutes}m · feito ${t.spent_minutes}m)` : ""}
                      </span>
                    </div>
                    <div className="muted" style={{ marginTop: 4 }}>📌 {item.reason}</div>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button
                        className="btn ok sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          startQuiz(t, "complete");
                        }}
                      >
                        ✅ Estudei! Fazer Mini-Quiz p/ concluir
                      </button>
                      <button
                        className="btn sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTab("chat");
                          sendChatMessage(`Estou estudando a tarefa ${t.id} (${t.title}). Me dê um guia rápido dos pontos-chave e como isso conecta com SRE.`);
                        }}
                      >
                        💬 Pedir resumo/dica no Chat
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Anotação de progresso / onde parou */}
              {activeTask && (
                <div style={{ marginTop: 14 }}>
                  <label className="muted" style={{ display: "block", marginBottom: 6 }}>
                    📝 O que estudei / onde parei em <strong>{activeTask.id}</strong> (usado para personalizar o quiz ou retomar na próxima sessão):
                  </label>
                  <textarea
                    rows={3}
                    value={studyNotes}
                    placeholder="Ex.: Assisti até o vídeo 4. Entendi ANI vs AGI e a regra de 1 segundo..."
                    onChange={(e) => setStudyNotes(e.target.value)}
                  />
                  <div className="row" style={{ marginTop: 8 }}>
                    <button
                      className="btn warn sm"
                      onClick={() => savePartialNote(activeTask.id, studyNotes || "Em andamento")}
                    >
                      ⏸️ Salvar parcial ([~] continuar depois)
                    </button>
                    <button className="btn ok sm" onClick={() => startQuiz(activeTask, "complete")}>
                      🧠 Fazer Mini-Quiz agora ({state.settings.quizQuestions} perguntas · {state.settings.quizPassPct}% p/ aprovar)
                    </button>
                    <button className="btn sm" onClick={() => setCloseOpen(true)}>
                      📓 Registrar fechamento no diário
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Coluna direita: Pomodoro + Revisões */}
          <div>
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3 style={{ margin: 0 }}>⏱️ Timer Pomodoro</h3>
                <span className="badge">Ciclos hoje: {pomoCycles}</span>
              </div>
              {activeTask && (
                <p className="muted" style={{ marginBottom: 8 }}>
                  Contabilizando tempo em: <strong>{activeTask.id}</strong> ({activeTask.spent_minutes} min acumulados)
                </p>
              )}
              <div className="row" style={{ justifyContent: "center" }}>
                <button
                  className={`btn sm chip ${pomoPhase === "focus" ? "selected" : ""}`}
                  onClick={() => selectPomoPhase("focus")}
                >
                  🎯 Foco ({state.settings.focusMin}m)
                </button>
                <button
                  className={`btn sm chip ${pomoPhase === "break" ? "selected" : ""}`}
                  onClick={() => selectPomoPhase("break")}
                >
                  ☕ Pausa ({state.settings.breakMin}m)
                </button>
                <button
                  className={`btn sm chip ${pomoPhase === "long" ? "selected" : ""}`}
                  onClick={() => selectPomoPhase("long")}
                >
                  🌴 Pausa longa ({state.settings.longBreakMin}m)
                </button>
              </div>

              <div className="pomo-clock">{fmtClock(pomoSeconds)}</div>

              <div className="row" style={{ justifyContent: "center" }}>
                <button className="btn primary" onClick={() => setPomoRunning((r) => !r)}>
                  {pomoRunning ? "⏸️ Pausar" : "▶️ Iniciar"}
                </button>
                <button className="btn" onClick={() => selectPomoPhase(pomoPhase)}>
                  🔄 Resetar
                </button>
                <button className="btn sm" onClick={() => setTab("settings")}>
                  ⚙️ Configurar tempos
                </button>
              </div>
            </div>

            {/* Revisão espaçada */}
            {plan?.reviews && plan.reviews.length > 0 && (
              <div className="card">
                <h3>🔁 Revisão espaçada pendente</h3>
                {plan.reviews.map((rev) => {
                  const t = state.tasks.find((x) => x.id === rev.origin_task);
                  return (
                    <div key={rev.id} className="task-row">
                      <div>
                        <strong>{rev.text}</strong>
                        <div className="muted">Revisões feitas: {rev.reviews}/4</div>
                      </div>
                      {t && (
                        <button className="btn primary sm" onClick={() => startQuiz(t, "review", rev.id)}>
                          🧠 Revisar
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA 2: ROADMAP */}
      {tab === "roadmap" && (
        <div>
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row">
                <button className={`btn chip ${rmTrack === "E" ? "selected" : ""}`} onClick={() => setRmTrack("E")}>
                  🏠 Estudo em Casa ({state.stats.progress.E.done}/{state.stats.progress.E.total})
                </button>
                <button className={`btn chip ${rmTrack === "T" ? "selected" : ""}`} onClick={() => setRmTrack("T")}>
                  🏢 Trabalho ({state.stats.progress.T.done}/{state.stats.progress.T.total})
                </button>
                <select value={rmFilter} onChange={(e) => setRmFilter(e.target.value as "all" | Status)}>
                  <option value="all">Todos os status</option>
                  <option value="todo">[ ] A fazer</option>
                  <option value="doing">[~] Em andamento</option>
                  <option value="done">[x] Concluídos</option>
                </select>
              </div>
              <div className="row">
                <button
                  className="btn sm"
                  onClick={async () => {
                    const s = await api<AppState>("/api/sync-from-md", { method: "POST" });
                    setState(s);
                  }}
                >
                  📥 Importar do progresso.md
                </button>
                <button
                  className="btn sm"
                  onClick={async () => {
                    await api("/api/export-md", { method: "POST" });
                  }}
                >
                  📤 Exportar p/ .md
                </button>
              </div>
            </div>

            {/* Adicionar nova tarefa manual */}
            <div className="row" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <strong>➕ Nova tarefa:</strong>
              <input
                type="number"
                className="input"
                style={{ width: 70 }}
                value={newTaskWeek}
                min={1}
                max={52}
                onChange={(e) => setNewTaskWeek(Number(e.target.value))}
                title="Semana"
              />
              <input
                className="input"
                style={{ flex: 1, minWidth: 220 }}
                placeholder="Título da tarefa..."
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
              />
              <select value={newTaskKind} onChange={(e) => setNewTaskKind(e.target.value as Kind)}>
                <option value="course">📚 Curso/vídeo</option>
                <option value="reading">📖 Leitura</option>
                <option value="lab">🛠️ Lab</option>
                <option value="checkpoint">🧠 Checkpoint</option>
              </select>
              <select value={newTaskEnergy} onChange={(e) => setNewTaskEnergy(e.target.value as Energy)}>
                <option value="low">🟢 Baixa</option>
                <option value="med">🟡 Média</option>
                <option value="high">🔴 Alta</option>
              </select>
              <input
                type="number"
                className="input"
                style={{ width: 80 }}
                value={newTaskMin}
                onChange={(e) => setNewTaskMin(Number(e.target.value))}
              />
              <button
                className="btn primary sm"
                onClick={async () => {
                  if (!newTaskTitle.trim()) return;
                  const r = await api<{ id: string; state: AppState }>("/api/tasks", {
                    method: "POST",
                    body: JSON.stringify({
                      track: rmTrack,
                      week: newTaskWeek,
                      title: newTaskTitle,
                      kind: newTaskKind,
                      energy: newTaskEnergy,
                      minutes: newTaskMin,
                    }),
                  });
                  setState(r.state);
                  setNewTaskTitle("");
                }}
              >
                Adicionar
              </button>
            </div>
          </div>

          {state.weeks
            .filter((w) => w.track === rmTrack)
            .map((w) => {
              const allWeekTasks = state.tasks.filter((t) => t.track === rmTrack && t.week === w.number);
              const doneCount = allWeekTasks.filter((t) => t.status === "done").length;
              const pct = allWeekTasks.length ? Math.round((doneCount / allWeekTasks.length) * 100) : 0;
              const visible = allWeekTasks.filter((t) => rmFilter === "all" || t.status === rmFilter);
              if (!visible.length && rmFilter !== "all") return null;

              return (
                <div key={`${w.track}-${w.number}`} className="card">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <h3 style={{ margin: 0 }}>
                      Semana {w.number}: {w.title}
                    </h3>
                    <span className="badge">
                      {doneCount}/{allWeekTasks.length} ({pct}%)
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div style={{ width: `${pct}%` }} />
                  </div>
                  {visible.map((t) => (
                    <div key={t.id} className={`task-row ${t.status === "done" ? "done" : ""}`}>
                      <div>
                        <span className="badge" style={{ marginRight: 8 }}>
                          {t.status === "done" ? "✓" : t.status === "doing" ? "~" : " "} {t.id}
                        </span>
                        <span className="task-title">
                          {t.kind ? KIND_ICON[t.kind] : ""} {t.energy ? ENERGY_ICON[t.energy] : ""} {t.title}
                        </span>
                        {t.minutes && <span className="muted"> · {t.minutes} min</span>}
                        {t.note && <div className="muted">📝 {t.note}</div>}
                      </div>
                      <div className="row">
                        {t.status !== "done" && (
                          <button
                            className="btn ok sm"
                            onClick={() => {
                              setActiveTaskId(t.id);
                              setStudyNotes(t.note ?? "");
                              startQuiz(t, "complete");
                            }}
                          >
                            🧠 Quiz p/ concluir
                          </button>
                        )}
                        <select
                          value={t.status}
                          onChange={async (e) => {
                            const s = await api<AppState>(`/api/tasks/${t.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ status: e.target.value }),
                            });
                            setState(s);
                            requestPlan();
                          }}
                        >
                          <option value="todo">[ ] A fazer</option>
                          <option value="doing">[~] Em andamento</option>
                          <option value="done">[x] Concluído</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
        </div>
      )}

      {/* ABA 3: CHAT DO ROADMAP */}
      {tab === "chat" && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <div>
              <h3 style={{ margin: 0 }}>💬 Conversar com o Mentor & Refinar Roadmap</h3>
              <span className="muted">
                Peça para adicionar temas, reorganizar semanas, quebrar tarefas grandes ou tirar dúvidas. O mentor propõe as mudanças e você aprova com 1 clique.
              </span>
            </div>
            <button
              className="btn sm"
              onClick={async () => {
                const c = await api<{ messages: ChatMessage[]; actions: PendingAction[] }>("/api/chat", {
                  method: "DELETE",
                });
                setChatMsgs(c.messages);
                setChatActions(c.actions);
              }}
            >
              🗑️ Limpar conversa
            </button>
          </div>

          <div className="row" style={{ marginBottom: 10 }}>
            {[
              "Quero adicionar um estudo sobre Kubernetes MCP Server na Semana 6",
              "Como estou no roadmap e qual deve ser meu foco desta semana?",
              "Quebre a tarefa E1.1 em duas partes menores de 45 min",
              "Me faça uma pergunta socrática sobre Eliminating Toil",
            ].map((q) => (
              <button key={q} className="btn sm" onClick={() => sendChatMessage(q)}>
                ✨ {q}
              </button>
            ))}
          </div>

          <div className="chat-box">
            {chatMsgs.length === 0 && (
              <p className="muted">Nenhuma mensagem ainda. Mande sua ideia ou clique em uma sugestão acima!</p>
            )}
            {chatMsgs.map((m) => {
              const msgActions = chatActions.filter((a) => a.message_id === m.id);
              return (
                <div key={m.id} className={`msg ${m.role}`}>
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                  {msgActions.map((a) => (
                    <div key={a.id} className="action-card">
                      <div>
                        <strong>{a.description}</strong>
                        {a.result && <div className="muted">Resultado: {a.result}</div>}
                      </div>
                      {a.status === "pending" ? (
                        <div className="row">
                          <button className="btn ok sm" onClick={() => handleActionDecision(a.id, "apply")}>
                            ✓ Aprovar mudança
                          </button>
                          <button className="btn danger sm" onClick={() => handleActionDecision(a.id, "reject")}>
                            ✕ Rejeitar
                          </button>
                        </div>
                      ) : (
                        <span className="badge">
                          {a.status === "applied" ? "✅ Aplicado" : a.status === "rejected" ? "🚫 Rejeitado" : "⚠️ Falhou"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
            {chatSending && <div className="msg model">⏳ Pensando...</div>}
            <div ref={chatEndRef} />
          </div>

          <div className="row">
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="Ex.: Quero incluir Terraform + IA na semana 7, ou: me explica OIDC no GitHub Actions..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendChatMessage();
                }
              }}
            />
            <button className="btn primary" disabled={chatSending} onClick={() => sendChatMessage()}>
              Enviar
            </button>
          </div>
        </div>
      )}

      {/* ABA 4: DÚVIDAS & REVISÃO */}
      {tab === "doubts" && (
        <div className="grid-2">
          <div className="card">
            <h3>❓ Dúvidas, Explorar Depois & Repetição Espaçada</h3>
            <div className="row" style={{ marginBottom: 14 }}>
              <select value={doubtKind} onChange={(e) => setDoubtKind(e.target.value as "doubt" | "explore" | "concept")}>
                <option value="doubt">❓ Dúvida em aberto</option>
                <option value="explore">🔭 Explorar depois</option>
                <option value="concept">🔁 Conceito p/ revisão</option>
              </select>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="Anote uma dúvida ou conceito..."
                value={doubtText}
                onChange={(e) => setDoubtText(e.target.value)}
              />
              <button
                className="btn primary sm"
                onClick={async () => {
                  if (!doubtText.trim()) return;
                  const s = await api<AppState>("/api/doubts", {
                    method: "POST",
                    body: JSON.stringify({ kind: doubtKind, text: doubtText, origin_task: activeTask?.id }),
                  });
                  setState(s);
                  setDoubtText("");
                }}
              >
                Adicionar
              </button>
            </div>

            {state.doubts.length === 0 && <p className="muted">Nenhum item registrado ainda.</p>}
            {state.doubts.map((d) => (
              <div key={d.id} className="task-row">
                <div>
                  <span className="badge" style={{ marginRight: 8 }}>
                    {d.kind === "doubt" ? "❓ Dúvida" : d.kind === "explore" ? "🔭 Explorar" : "🔁 Revisão"}
                  </span>
                  <strong style={{ textDecoration: d.status === "resolved" ? "line-through" : "none" }}>
                    {d.text}
                  </strong>
                  {d.origin_task && <span className="muted"> ({d.origin_task})</span>}
                  {d.next_review && d.status === "open" && (
                    <div className="muted">Próxima revisão: {d.next_review} · feitas: {d.reviews}/4</div>
                  )}
                  {d.answer && <div className="muted">💡 {d.answer}</div>}
                </div>
                <div className="row">
                  {d.status === "open" ? (
                    <button
                      className="btn ok sm"
                      onClick={async () => {
                        const ans = prompt("Resumo rápido da resposta (opcional):") ?? "resolvido";
                        const s = await api<AppState>(`/api/doubts/${d.id}/resolve`, {
                          method: "POST",
                          body: JSON.stringify({ answer: ans }),
                        });
                        setState(s);
                      }}
                    >
                      ✓ Resolver
                    </button>
                  ) : (
                    <button
                      className="btn sm"
                      onClick={async () => {
                        const s = await api<AppState>(`/api/doubts/${d.id}/reopen`, { method: "POST" });
                        setState(s);
                      }}
                    >
                      Reabrir
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <h3>📓 Últimas sessões registradas</h3>
            {state.sessions.length === 0 && <p className="muted">Nenhuma sessão registrada ainda.</p>}
            {state.sessions.map((s) => (
              <div key={s.id} className="mission-item">
                <strong>
                  {s.date} · {s.minutes} min · {s.location}
                </strong>
                <div className="muted">🎯 Missão: {s.mission} ({s.result})</div>
                {s.learned && <div className="muted">🧠 Aprendi: {s.learned}</div>}
                {s.ai_opportunity && <div className="muted">💡 Oportunidade IA: {s.ai_opportunity}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ABA 5: CONFIGURAÇÕES */}
      {tab === "settings" && (
        <div className="card" style={{ maxWidth: 540 }}>
          <h3>⚙️ Configurações do Pomodoro & Quiz</h3>
          <div style={{ display: "grid", gap: 12 }}>
            <label className="row" style={{ justifyContent: "space-between" }}>
              <span>🎯 Minutos de Foco (Pomodoro):</span>
              <input
                type="number"
                className="input"
                value={state.settings.focusMin}
                onChange={async (e) => {
                  const s = await api<AppState>("/api/settings", {
                    method: "PUT",
                    body: JSON.stringify({ focusMin: Number(e.target.value) }),
                  });
                  setState(s);
                }}
              />
            </label>
            <label className="row" style={{ justifyContent: "space-between" }}>
              <span>☕ Pausa curta (min):</span>
              <input
                type="number"
                className="input"
                value={state.settings.breakMin}
                onChange={async (e) => {
                  const s = await api<AppState>("/api/settings", {
                    method: "PUT",
                    body: JSON.stringify({ breakMin: Number(e.target.value) }),
                  });
                  setState(s);
                }}
              />
            </label>
            <label className="row" style={{ justifyContent: "space-between" }}>
              <span>🌴 Pausa longa (min):</span>
              <input
                type="number"
                className="input"
                value={state.settings.longBreakMin}
                onChange={async (e) => {
                  const s = await api<AppState>("/api/settings", {
                    method: "PUT",
                    body: JSON.stringify({ longBreakMin: Number(e.target.value) }),
                  });
                  setState(s);
                }}
              />
            </label>
            <label className="row" style={{ justifyContent: "space-between" }}>
              <span>🧠 Quantidade de perguntas no Mini-Quiz:</span>
              <input
                type="number"
                className="input"
                min={1}
                max={10}
                value={state.settings.quizQuestions}
                onChange={async (e) => {
                  const s = await api<AppState>("/api/settings", {
                    method: "PUT",
                    body: JSON.stringify({ quizQuestions: Number(e.target.value) }),
                  });
                  setState(s);
                }}
              />
            </label>
            <label className="row" style={{ justifyContent: "space-between" }}>
              <span>🏆 Nota mínima p/ concluir tarefa (%):</span>
              <input
                type="number"
                className="input"
                min={50}
                max={100}
                value={state.settings.quizPassPct}
                onChange={async (e) => {
                  const s = await api<AppState>("/api/settings", {
                    method: "PUT",
                    body: JSON.stringify({ quizPassPct: Number(e.target.value) }),
                  });
                  setState(s);
                }}
              />
            </label>
          </div>
        </div>
      )}

      {/* MODAL DO MINI-QUIZ */}
      {quizOpen && quizTask && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>
                🧠 Mini-Quiz: {quizTask.id} — {quizTask.title}
              </h3>
              <button className="btn sm" onClick={() => setQuizOpen(false)}>✕ Fechar</button>
            </div>

            {quizLoading && <p>⏳ Gerando/corrigindo quiz com o Gemini...</p>}

            {!quizLoading && !quizResult && quizQuestions.map((q, qi) => (
              <div key={qi} className="mission-item">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>
                    {qi + 1}. {q.question}
                  </strong>
                  <span className="badge">{q.concept}</span>
                </div>
                {q.options.map((opt, oi) => (
                  <button
                    key={oi}
                    className={`quiz-opt ${quizAnswers[qi] === oi ? "selected" : ""}`}
                    onClick={() => {
                      const next = [...quizAnswers];
                      next[qi] = oi;
                      setQuizAnswers(next);
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ))}

            {!quizLoading && !quizResult && quizQuestions.length > 0 && (
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
                <button
                  className="btn ok"
                  disabled={quizAnswers.some((a) => a < 0)}
                  onClick={submitQuiz}
                >
                  ✅ Enviar respostas e validar conclusão
                </button>
              </div>
            )}

            {quizResult && (
              <div>
                <div
                  className="mission-item"
                  style={{
                    borderColor: quizResult.passed ? "var(--ok)" : "var(--warn)",
                  }}
                >
                  <h3>
                    {quizResult.passed
                      ? `🎉 Aprovado! (${quizResult.correct}/${quizResult.total} — ${quizResult.pct}%)`
                      : `📚 Quase lá! (${quizResult.correct}/${quizResult.total} — ${quizResult.pct}%, mínimo ${quizResult.passPct}%)`}
                  </h3>
                  <p className="muted">
                    {quizResult.passed
                      ? `A tarefa ${quizTask.id} foi marcada como concluída [x] no SQLite e no progresso.md, e o roadmap avançou automaticamente!`
                      : `A tarefa ficou como em andamento [~] e os pontos que você errou entraram em Dúvidas para revisar.`}
                  </p>
                </div>

                {quizResult.results.map((r, i) => (
                  <div key={i} className="mission-item">
                    <strong>
                      {r.correct ? "✅" : "❌"} {i + 1}. {r.question}
                    </strong>
                    {r.options.map((opt, oi) => {
                      const cls =
                        oi === r.correctIndex ? "correct" : oi === r.chosen && !r.correct ? "wrong" : "";
                      return (
                        <div key={oi} className={`quiz-opt ${cls}`}>
                          {opt}
                        </div>
                      );
                    })}
                    <div className="muted" style={{ marginTop: 6 }}>
                      💡 {r.explanation}
                    </div>
                  </div>
                ))}

                <div className="row" style={{ justifyContent: "space-between", marginTop: 12 }}>
                  <button className="btn" onClick={() => startQuiz(quizTask, quizMode, quizConceptId)}>
                    🔄 Tentar novo Quiz
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => {
                      setQuizOpen(false);
                      if (quizResult.passed) setCloseOpen(true);
                    }}
                  >
                    {quizResult.passed ? "📓 Registrar aprendizado da sessão" : "Fechar"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL DE FECHAMENTO DE SESSÃO */}
      {closeOpen && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>📓 Fechamento da sessão (salva no SQLite + sessoes.md)</h3>
            <div style={{ display: "grid", gap: 12 }}>
              <label>
                <span className="muted">Resultado da sessão:</span>
                <select
                  style={{ width: "100%", marginTop: 4 }}
                  value={closeResult}
                  onChange={(e) => setCloseResult(e.target.value)}
                >
                  <option value="concluído">Concluído</option>
                  <option value={`parcial (${studyNotes || "em andamento"})`}>Parcial (em andamento)</option>
                </select>
              </label>
              <label>
                <span className="muted">O que você aprendeu hoje (1–2 linhas):</span>
                <textarea
                  rows={2}
                  value={closeLearned}
                  onChange={(e) => setCloseLearned(e.target.value)}
                  placeholder="Ex.: Diferença entre ANI e AGI, regra de 1 segundo para automação com ML..."
                />
              </label>
              <label>
                <span className="muted">Oportunidade de IA vista no trabalho hoje (ou "—"):</span>
                <input
                  className="input"
                  style={{ width: "100%" }}
                  value={closeOpp}
                  onChange={(e) => setCloseOpp(e.target.value)}
                  placeholder="Ex.: Classificar falhas recorrentes de pipeline no GitHub Actions"
                />
              </label>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button className="btn" onClick={() => setCloseOpen(false)}>Cancelar</button>
                <button className="btn ok" onClick={saveSessionLog}>💾 Salvar sessão</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
