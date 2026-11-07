import { PublicKey } from "@solana/web3.js";
import { connection, fetchAllVaults, fetchAttempts, getProgram, arenaPda, type AttemptView, type VaultView } from "@/lib/chain";
import { agentKeypair, arenaKeypair } from "@/lib/runtime/keys";

interface Snapshot {
  vaults: VaultView[];
  attempts: AttemptView[];
  treasury: string;
  arenaAuthority: string;
  at: number;
}

let cache: Snapshot | null = null;
let inflight: Promise<Snapshot> | null = null;

async function load(): Promise<Snapshot> {
  const conn = connection();
  const [vaults, attempts, arena] = await Promise.all([
    fetchAllVaults(conn),
    fetchAttempts(conn),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getProgram(conn).account as any).arena.fetch(arenaPda()),
  ]);
  // Only vaults whose agent key this runtime derived. See keys.ts for why.
  const trusted = vaults.filter(
    (v) => v.opened && agentKeypair(new PublicKey(v.sponsor), BigInt(v.vaultId)).publicKey.toBase58() === v.agent,
  );
  const ids = new Set(trusted.map((v) => v.address));
  return {
    vaults: trusted,
    attempts: attempts.filter((a) => ids.has(a.vault)).slice(0, 200),
    treasury: arena.treasury.toBase58(),
    arenaAuthority: arenaKeypair().publicKey.toBase58(),
    at: Date.now(),
  };
}

export async function GET() {
  if (!cache || Date.now() - cache.at > 3000) {
    inflight ??= load().finally(() => (inflight = null));
    try {
      cache = await inflight;
    } catch (err) {
      if (!cache) {
        return Response.json(
          { error: err instanceof Error ? err.message : "Could not read the chain" },
          { status: 503 },
        );
      }
    }
  }
  // Public devnet RPC rate limits getProgramAccounts hard, so let the CDN share one read.
  return Response.json(cache, { headers: { "cache-control": "public, s-maxage=4, stale-while-revalidate=30" } });
}
