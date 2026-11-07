import { PublicKey } from "@solana/web3.js";
import { connection } from "@/lib/chain";
import { LAMPORTS } from "@/lib/config";
import { grantArcadeFunds } from "@/lib/runtime/pipeline";
import { arenaKeypair } from "@/lib/runtime/keys";

const GRANT = Math.round(0.06 * LAMPORTS);
const ENOUGH = Math.round(0.02 * LAMPORTS);
const FLOOR = Math.round(0.5 * LAMPORTS);
const PER_HOUR = 6;
const hits = new Map<string, number[]>();

/** Devnet SOL for the arcade wallet, so a judge can play without installing anything. */
export async function POST(req: Request) {
  const { wallet } = (await req.json()) as { wallet?: string };
  let key: PublicKey;
  try {
    key = new PublicKey(wallet ?? "");
  } catch {
    return Response.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_HOUR) {
    return Response.json({ error: "The arcade faucet is resting. Try again in an hour." }, { status: 429 });
  }

  const conn = connection();
  const balance = await conn.getBalance(key);
  if (balance >= ENOUGH) return Response.json({ balance, funded: false });

  if ((await conn.getBalance(arenaKeypair().publicKey)) < FLOOR) {
    return Response.json({ error: "The arena treasury is low. Try again later." }, { status: 503 });
  }

  hits.set(ip, [...recent, now]);
  const signature = await grantArcadeFunds(key, GRANT);
  await conn.confirmTransaction(signature, "confirmed");
  return Response.json({ balance: balance + GRANT, funded: true, signature });
}
