import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { HttpError, errMsg } from "./util";

let client: GoogleGenAI | null = null;
let workingModel: string | null = null;

const MODELS = [
  ...new Set(
    [process.env.GEMINI_MODEL, "gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"].filter(
      (m): m is string => !!m,
    ),
  ),
];

export const hasKey = () => !!process.env.GEMINI_API_KEY?.trim();
export const currentModel = () => workingModel ?? MODELS[0];

function getClient(): GoogleGenAI {
  if (!hasKey()) {
    throw new HttpError(400, "Falta a GEMINI_API_KEY em app/server/.env (crie em aistudio.google.com e reinicie o app).");
  }
  return (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!.trim() }));
}

function statusOf(e: unknown): number | undefined {
  const any = e as { status?: number; code?: number };
  if (typeof any?.status === "number") return any.status;
  if (typeof any?.code === "number") return any.code;
  const m = errMsg(e).match(/\b(400|401|403|404|429|500|503)\b/);
  return m ? Number(m[1]) : undefined;
}

/**
 * Chama o Gemini tentando os modelos em ordem. Se um modelo não existe (404)
 * ou estourou a quota do free tier (429), tenta o próximo — cada modelo tem quota própria.
 */
export async function generate(req: Omit<GenerateContentParameters, "model">): Promise<GenerateContentResponse> {
  const order = workingModel ? [workingModel, ...MODELS.filter((m) => m !== workingModel)] : MODELS;
  let last: unknown;
  let sawQuota = false;
  for (const model of order) {
    try {
      const res = await getClient().models.generateContent({ ...req, model });
      workingModel = model;
      return res;
    } catch (e) {
      last = e;
      const st = statusOf(e);
      if (st === 429) sawQuota = true;
      if (st === 404 || st === 429 || st === 503 || /not found|not supported|overloaded/i.test(errMsg(e))) continue;
      if (st === 400 && /api key/i.test(errMsg(e))) throw new HttpError(401, "GEMINI_API_KEY inválida. Confira o app/server/.env.");
      if (st === 401 || st === 403) throw new HttpError(401, "GEMINI_API_KEY inválida ou sem permissão. Confira o app/server/.env.");
      throw new HttpError(502, `Erro do Gemini: ${errMsg(e)}`);
    }
  }
  if (sawQuota) throw new HttpError(429, "Quota do free tier do Gemini esgotada em todos os modelos. Tente mais tarde (reseta à meia-noite do Pacífico).");
  throw new HttpError(502, `Nenhum modelo Gemini respondeu: ${errMsg(last)}`);
}

/** Texto da resposta, ignorando partes de "thinking" e chamadas de função. */
export function extractText(res: GenerateContentResponse): string {
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("");
}
