import { PublicKey } from "@solana/web3.js";
import { connection, fetchAttempts, fetchVault } from "@/lib/chain";
import { LAMPORTS, TECHNIQUES, sol } from "@/lib/config";
import { summariseThreats, type ThreatSummary } from "@/lib/runtime/brain";

const cache = new Map<string, { count: number; report: ThreatSummary }>();

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
  if (hit && hit.count === resolved.length) return Response.json({ report: hit.report });

  const p = vault.policy;
  const policy = p.enabled
    ? `allowlist of ${p.allowlist.length}, per-transfer cap ${sol(p.maxPerTx)} SOL, rolling cap ${sol(p.windowCap)} SOL per ${p.windowSecs}s`
    : "none";
  try {
    const report = await summariseThreats({
      name: vault.name,
      brief: vault.brief,
      policy,
      attempts: resolved.map((a) => ({
        outcome: a.outcome,
        technique: TECHNIQUES[a.technique] ?? "Unclassified",
        prompt: a.prompt,
        requestedSol: a.requested / LAMPORTS,
      })),
    });
    cache.set(vault.address, { count: resolved.length, report });
    return Response.json({ report });
  } catch {
    return Response.json({ error: "The analyst is busy. Try again in a minute." }, { status: 503 });
  }
}
