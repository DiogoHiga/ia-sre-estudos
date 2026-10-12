export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Data local no formato AAAA-MM-DD. */
export const today = () => new Date().toLocaleDateString("sv-SE");

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

export function parseDuration(s: string): number | null {
  const t = s.trim();
  let m = t.match(/^(\d+)\s*h\s*(\d+)?\s*(min)?$/i);
  if (m) return Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
  m = t.match(/^(\d+)\s*min$/i);
  if (m) return Number(m[1]);
  return null;
}

export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
