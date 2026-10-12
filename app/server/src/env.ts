// Carrega app/server/.env antes de qualquer outro módulo ler process.env.
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(serverDir, ".env"));
} catch {
  // sem .env: o app funciona, mas quiz/chat avisam que falta a chave
}
