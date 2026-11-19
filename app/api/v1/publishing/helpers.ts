/**
 * Helper bersama route API publishing (P6-08).
 * errorJson + requireContext dipakai ulang dari route approval (pola yang
 * sama: identitas dari sesi + DB, BUKAN dari body).
 */
export { errorJson, requireContext } from "../approvals/helpers";

/** Pemetaan kode hasil aksi/RPC ke status HTTP. */
export function actionStatusFor(code?: string): number {
  switch (code) {
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "UNAUTHENTICATED":
      return 401;
    default:
      return 400;
  }
}
