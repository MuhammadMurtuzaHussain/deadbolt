import { PublicKey } from "@solana/web3.js";
import { connection, fetchAttempts, fetchVault } from "@/lib/chain";
import { LAMPORTS, TECHNIQUES, sol } from "@/lib/config";
import { summariseThreats, type ThreatSummary } from "@/lib/runtime/brain";

const cache = new Map<string, { count: number; report: ThreatSummary; at: number }>();
const inflight = new Map<string, Promise<ThreatSummary>>();
const MIN_REFRESH_MS = 60_000;

export async function GET(req: Request) {
  let vaultKey: PublicKey;
  try {
    vaultKey = new PublicKey(new URL(req.url).searchParams.get("vault") ?? "");
  } catch {
    return Response.json({ error: "vault is required" }, { status: 400 });
  }
  const conn = connection();
  const [vault, attempts] = await Promise.all([fetchVault(conn, vaultKey), fetchAttempts(conn, vaultKey)]);
  const resolved = attempts.filter((a) => a.status === "resolved");
  if (resolved.length === 0) return Response.json({ report: null });

  const hit = cache.get(vault.address);
  if (hit && (hit.count === resolved.length || Date.now() - hit.at < MIN_REFRESH_MS)) {
    return Response.json({ report: hit.report });
  }

  const p = vault.policy;
  // Only limits that exist: an unset cap is absent, not a cap of zero.
  const limits = [
    p.allowlist.length > 0 && `recipients restricted to an allowlist of ${p.allowlist.length} wallet(s)`,
    p.maxPerTx > 0 && `at most ${sol(p.maxPerTx)} SOL per transfer`,
    p.windowCap > 0 && `at most ${sol(p.windowCap)} SOL per ${Math.round(p.windowSecs / 60)} minutes`,
  ].filter(Boolean);
  const policy = p.enabled && limits.length > 0 ? limits.join("; ") : "none: the agent's decision is final";
  try {
    let run = inflight.get(vault.address);
    if (!run) {
      run = summariseThreats({
        name: vault.name,
        brief: vault.brief,
        policy,
        attempts: resolved.map((a) => ({
          outcome: a.blockReason === "none" ? a.outcome : `${a.outcome} (${a.blockReason})`,
          technique: TECHNIQUES[a.technique] ?? "Unclassified",
          prompt: a.prompt,
          requestedSol: a.requested / LAMPORTS,
        })),
      }).finally(() => inflight.delete(vault.address));
      inflight.set(vault.address, run);
    }
    const report = await run;
    cache.set(vault.address, { count: resolved.length, report, at: Date.now() });
    return Response.json({ report });
  } catch {
    return Response.json({ error: "The analyst is busy. Try again in a minute." }, { status: 503 });
  }
}
