/**
 * Aturan transisi status task — features/production/transitions.ts (Phase 3)
 * Cermin APLIKASI dari mesin di migrasi 0010 (transition_task_status).
 * Bila keduanya berbeda, yang DI DATABASE yang menang — perbaiki file ini.
 *
 *   todo → in_progress | blocked | cancelled
 *   in_progress → in_review | blocked | cancelled
 *   in_review → done | blocked | cancelled
 *   blocked → todo | cancelled
 *   cancelled → todo
 *   done → terminal (tidak ada transisi keluar)
 */
import { TASK_STATUSES } from "./constants";
import type { TaskStatus } from "./types";

const TASK_NEXT: Record<TaskStatus, TaskStatus[]> = {
  todo: ["in_progress", "blocked", "cancelled"],
  in_progress: ["in_review", "blocked", "cancelled"],
  in_review: ["done", "blocked", "cancelled"],
  done: [],
  blocked: ["todo", "cancelled"],
  cancelled: ["todo"],
};

/** Apakah transisi status task from → to diizinkan? */
export function isValidTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return false;
  return (TASK_NEXT[from] ?? []).includes(to);
}

/** Semua tujuan yang valid dari satu status task (untuk UI pemilih). */
export function validTaskTargets(from: TaskStatus): TaskStatus[] {
  return TASK_STATUSES.filter((to) => isValidTaskTransition(from, to));
}

/** Apakah status task ini terminal (tidak bisa maju lagi)? */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === "done";
}
