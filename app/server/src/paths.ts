import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_DIR = path.resolve(here, "..");
/** Raiz do workspace de estudos (onde ficam progresso.md, sessoes.md, duvidas.md). */
export const WORKSPACE_DIR = process.env.WORKSPACE_DIR
  ? path.resolve(process.env.WORKSPACE_DIR)
  : path.resolve(SERVER_DIR, "..", "..");
export const DATA_DIR = path.join(SERVER_DIR, "data");
export const WEB_DIST = path.resolve(SERVER_DIR, "..", "web", "dist");

export const FILES = {
  progresso: path.join(WORKSPACE_DIR, "progresso.md"),
  sessoes: path.join(WORKSPACE_DIR, "sessoes.md"),
  duvidas: path.join(WORKSPACE_DIR, "duvidas.md"),
  planoCasa: path.join(WORKSPACE_DIR, "planos", "plano_estudo_casa.md"),
  planoTrabalho: path.join(WORKSPACE_DIR, "planos", "plano_trabalho.md"),
};
