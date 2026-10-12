import "./env";
import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { clearChat, decideAction, getChat, sendChat } from "./chat";
import { all, getMeta, getSettings, run, saveSettings } from "./db";
import { exportAll } from "./exporter";
import { initData, syncFromMarkdown } from "./importer";
import { currentModel, hasKey } from "./llm";
import { WEB_DIST } from "./paths";
import { nextMissionText, plan, validatePlanParams } from "./planner";
import { createQuiz, gradeQuiz } from "./quiz";
import {
  addDoubt,
  addSpent,
  addTask,
  deleteDoubt,
  deleteTask,
  moveTask,
  reopenDoubt,
  resolveDoubt,
  updateTask,
  upsertWeek,
} from "./roadmap";
import { computeStats } from "./stats";
import type { Doubt, Session, Task, Week } from "./types";
import { HttpError, errMsg, oneLine, today } from "./util";

initData();

const app = express();
app.use(express.json({ limit: "1mb" }));

const wrap =
  (fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res)).catch(next);

function state() {
  return {
    tasks: all<Task>("SELECT * FROM tasks ORDER BY track, week, position"),
    weeks: all<Week>("SELECT * FROM weeks ORDER BY track, number"),
    doubts: all<Doubt>("SELECT * FROM doubts ORDER BY status, id DESC"),
    sessions: all<Session>("SELECT * FROM sessions ORDER BY date DESC, id DESC LIMIT 30"),
    stats: computeStats(),
    settings: getSettings(),
    routinesMd: getMeta("routinesMd") ?? "",
    llm: { hasKey: hasKey(), model: currentModel() },
  };
}

app.get("/api/health", (_req, res) => res.json({ status: "ok", hasKey: hasKey(), model: currentModel() }));
app.get("/api/state", (_req, res) => res.json(state()));

app.post(
  "/api/sync-from-md",
  wrap((_req, res) => {
    syncFromMarkdown();
    res.json(state());
  }),
);
app.post(
  "/api/export-md",
  wrap((_req, res) => {
    exportAll();
    res.json({ ok: true });
  }),
);
app.put(
  "/api/settings",
  wrap((req, res) => {
    saveSettings(req.body ?? {});
    res.json(state());
  }),
);

// Check-in → plano
app.post(
  "/api/plan",
  wrap((req, res) => res.json(plan(validatePlanParams(req.body ?? {})))),
);

// Tarefas & semanas
app.post(
  "/api/tasks",
  wrap((req, res) => {
    const id = addTask(req.body ?? {});
    exportAll();
    res.json({ id, state: state() });
  }),
);
app.patch(
  "/api/tasks/:id",
  wrap((req, res) => {
    updateTask(String(req.params.id), req.body ?? {});
    exportAll();
    res.json(state());
  }),
);
app.post(
  "/api/tasks/:id/move",
  wrap((req, res) => {
    const id = moveTask(String(req.params.id), req.body?.week, req.body?.after_task_id);
    exportAll();
    res.json({ id, state: state() });
  }),
);
app.post(
  "/api/tasks/:id/spent",
  wrap((req, res) => {
    addSpent(String(req.params.id), req.body?.minutes);
    res.json(state());
  }),
);
app.delete(
  "/api/tasks/:id",
  wrap((req, res) => {
    deleteTask(String(req.params.id));
    exportAll();
    res.json(state());
  }),
);
app.post(
  "/api/weeks",
  wrap((req, res) => {
    upsertWeek(req.body?.track, req.body?.number, req.body?.title);
    exportAll();
    res.json(state());
  }),
);

// Dúvidas
app.post(
  "/api/doubts",
  wrap((req, res) => {
    addDoubt(req.body?.kind, req.body?.text, req.body?.origin_task);
    exportAll();
    res.json(state());
  }),
);
app.post(
  "/api/doubts/:id/resolve",
  wrap((req, res) => {
    resolveDoubt(req.params.id, req.body?.answer);
    exportAll();
    res.json(state());
  }),
);
app.post(
  "/api/doubts/:id/reopen",
  wrap((req, res) => {
    reopenDoubt(req.params.id);
    exportAll();
    res.json(state());
  }),
);
app.delete(
  "/api/doubts/:id",
  wrap((req, res) => {
    deleteDoubt(req.params.id);
    exportAll();
    res.json(state());
  }),
);

// Sessões (fechamento)
app.post(
  "/api/sessions",
  wrap((req, res) => {
    const b = req.body ?? {};
    const track = b.location === "trabalho" ? "T" : "E";
    const ids: string[] = Array.isArray(b.taskIds) ? b.taskIds.map(String) : [];
    const next = oneLine(String(b.nextMission || "")) || nextMissionText(track);
    run(
      `INSERT INTO sessions (date, minutes, energy, location, task_ids, mission, result, learned, ai_opportunity, next_mission)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.date && /^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) ? String(b.date) : today(),
      Math.max(1, Math.round(Number(b.minutes) || 0)),
      ["low", "med", "high"].includes(b.energy) ? b.energy : "med",
      track === "T" ? "trabalho" : "casa",
      JSON.stringify(ids),
      oneLine(String(b.mission || ids.join(", ") || "Estudo")),
      oneLine(String(b.result || "concluído")),
      oneLine(String(b.learned || "—")),
      oneLine(String(b.aiOpportunity || "—")),
      next,
    );
    exportAll();
    res.json(state());
  }),
);

// Quiz
app.post(
  "/api/quiz/generate",
  wrap(async (req, res) => res.json(await createQuiz(req.body ?? {}))),
);
app.post(
  "/api/quiz/:id/grade",
  wrap((req, res) => res.json({ ...gradeQuiz(Number(req.params.id), req.body?.answers), state: state() })),
);

// Chat
app.get("/api/chat", (_req, res) => res.json(getChat()));
app.post(
  "/api/chat",
  wrap(async (req, res) => res.json(await sendChat(req.body?.message))),
);
app.post(
  "/api/chat/actions/:id",
  wrap((req, res) => res.json({ chat: decideAction(Number(req.params.id), req.body?.decision), state: state() })),
);
app.delete("/api/chat", (_req, res) => res.json(clearChat()));

// Build estático (quando rodar `npm start`)
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: errMsg(err) });
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`🎓 Mentor SRE API em http://localhost:${port} (key: ${hasKey() ? "configurada" : "faltando"})`));
