import { PublicKey } from "@solana/web3.js";
import { agentKeypair } from "@/lib/runtime/keys";

/** Gives a sponsor the runtime-held agent key to bind into a new vault. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const sponsor = new PublicKey(url.searchParams.get("sponsor") ?? "");
    const id = BigInt(url.searchParams.get("id") ?? "");
    return Response.json({ agent: agentKeypair(sponsor, id).publicKey.toBase58() });
  } catch {
    return Response.json({ error: "sponsor and id are required" }, { status: 400 });
  }
}
