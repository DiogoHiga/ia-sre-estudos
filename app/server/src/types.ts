export type Track = "E" | "T";
export type Kind = "course" | "reading" | "lab" | "checkpoint";
export type Energy = "low" | "med" | "high";
export type Status = "todo" | "doing" | "done";
export type DoubtKind = "doubt" | "explore" | "concept";

export interface Task {
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

export interface Week {
  track: Track;
  number: number;
  title: string;
}

export interface Doubt {
  id: number;
  kind: DoubtKind;
  text: string;
  origin_task: string | null;
  status: "open" | "resolved";
  answer: string | null;
  created_at: string;
  resolved_at: string | null;
  reviews: number;
  next_review: string | null;
}

export interface Session {
  id: number;
  date: string;
  minutes: number | null;
  energy: Energy | null;
  location: string | null;
  task_ids: string | null;
  mission: string | null;
  result: string | null;
  learned: string | null;
  ai_opportunity: string | null;
  next_mission: string | null;
}

export interface ChatMessage {
  id: number;
  role: "user" | "model" | "system_note";
  content: string;
  created_at: string;
}

export interface PendingActionRow {
  id: number;
  message_id: number;
  name: string;
  args: string;
  description: string;
  status: "pending" | "applied" | "rejected" | "failed";
  result: string | null;
}

export const KINDS: Kind[] = ["course", "reading", "lab", "checkpoint"];
export const ENERGIES: Energy[] = ["low", "med", "high"];
export const STATUSES: Status[] = ["todo", "doing", "done"];
export const DOUBT_KINDS: DoubtKind[] = ["doubt", "explore", "concept"];

export const KIND_EMOJI: Record<Kind, string> = { course: "📚", reading: "📖", lab: "🛠️", checkpoint: "🧠" };
export const ENERGY_EMOJI: Record<Energy, string> = { low: "🟢", med: "🟡", high: "🔴" };
