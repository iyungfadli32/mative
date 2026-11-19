/**
 * Rumus progres campaign — features/campaign/progress.ts (P5-03, ASUMSI-5.2).
 * Dihitung dari linked content SETIAP KALI dibaca; TIDAK ADA persentase
 * yang disimpan / diketik manual. Satu-satunya tempat rumus ini hidup —
 * bila Tuan menetapkan rumus lain, ganti di sini saja.
 */
import type { CampaignProgress } from "./types";

const READY = new Set(["approved"]);
const IN_PRODUCTION = new Set(["ready_for_production", "in_production", "editing"]);
const WAITING_APPROVAL = new Set(["internal_review"]);
const NOT_STARTED = new Set(["idea", "brief", "scripting"]);
const EXCEPTION = new Set(["changes_requested", "blocked", "cancelled"]);
const ARCHIVED = new Set(["archived"]);

export function computeCampaignProgress(
  items: Array<{ production_status: string }>,
): CampaignProgress {
  const progress: CampaignProgress = {
    total: items.length,
    ready: 0,
    inProduction: 0,
    waitingApproval: 0,
    notStarted: 0,
    exception: 0,
    archived: 0,
    readyPercent: 0,
  };
  for (const item of items) {
    const s = item.production_status;
    if (READY.has(s)) progress.ready += 1;
    else if (IN_PRODUCTION.has(s)) progress.inProduction += 1;
    else if (WAITING_APPROVAL.has(s)) progress.waitingApproval += 1;
    else if (NOT_STARTED.has(s)) progress.notStarted += 1;
    else if (EXCEPTION.has(s)) progress.exception += 1;
    else if (ARCHIVED.has(s)) progress.archived += 1;
    // Status tak dikenal: dihitung di total saja (tidak masuk kategori).
  }
  progress.readyPercent =
    progress.total === 0 ? 0 : Math.round((progress.ready / progress.total) * 100);
  return progress;
}
