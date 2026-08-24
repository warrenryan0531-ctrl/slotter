import { db } from "./db";
import { appMode } from "./env";

/** Durable, atomic rate limit via Postgres function (resolution #5). Returns true when allowed.
 *  Demo mode multiplies the ceiling ×10: demo traffic shares egress IPs (walkthroughs, QA suites)
 *  and the demo instance holds no production data. Prod keeps the strict limits. */
export async function rateLimit(key: string, windowSecs: number, max: number): Promise<boolean> {
  const effectiveMax = appMode() === "demo" ? max * 10 : max;
  const { data, error } = await db().rpc("bh_rate_limit", { p_key: key, p_window_secs: windowSecs, p_max: effectiveMax });
  if (error) throw new Error(`rate limit rpc failed: ${error.message}`);
  return data === true;
}

export function ipOf(req: Request): string {
  const h = req.headers.get("x-forwarded-for");
  return h ? h.split(",")[0].trim() : "local";
}
