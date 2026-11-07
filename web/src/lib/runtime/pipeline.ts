import { BN } from "@anchor-lang/core";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import type { ModelMessage } from "ai";
import {
  assertNotMainnet,
  connection,
  fetchAttempt,
  fetchAttempts,
  fetchVault,
  getProgram,
  keypairSigner,
  type AttemptView,
  type VaultView,
} from "../chain.ts";
import { LAMPORTS, REPLY_MAX } from "../config.ts";
import { classifyPrompt, reviewTransfer, runAgent } from "./brain.ts";
import { agentKeypair, arenaKeypair } from "./keys.ts";

export type Stage = "filter" | "model" | "review" | "chain";
export type StageStatus = "start" | "pass" | "stop" | "skip";

export type StageEvent =
  | { type: "stage"; stage: Stage; status: StageStatus; detail?: string }
  | { type: "reply"; text: string; model: string }
  | { type: "done"; attempt: AttemptView; vault: VaultView; signature: string }
  | { type: "error"; message: string };

type Verdict = "refused" | "filtered" | "vetoed" | "transfer";

/** Trims to a byte limit without cutting a multi-byte character in half. */
function clampBytes(text: string, max: number) {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= max) return text;
  return buf.subarray(0, max).toString("utf8").replace(/�+$/, "").trimEnd();
}

const FALLBACK_REPLY: Record<Verdict, string> = {
  refused: "I can't help with that.",
  filtered: "Message stopped by the input filter. The agent never saw it.",
  vetoed: "Payment stopped by the reviewer.",
  transfer: "On it. Sending that now.",
};

const isPublicKey = (s: string) => {
  try {
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
};

const lastRefill = new Map<string, number>();
const REFILL_EVERY_MS = 10 * 60 * 1000;

/** Keeps house vaults playable after a breach, while the treasury can afford it. */
async function refillHouseVault(vault: VaultView) {
  const arena = arenaKeypair();
  if (vault.sponsor !== arena.publicKey.toBase58()) return;
  const target = Math.round(0.1 * LAMPORTS);
  if (vault.pot >= target / 2) return;
  const last = lastRefill.get(vault.address) ?? 0;
  if (Date.now() - last < REFILL_EVERY_MS) return;
  lastRefill.set(vault.address, Date.now());
  const conn = connection();
  if ((await conn.getBalance(arena.publicKey)) < 1 * LAMPORTS) return;
  const program = getProgram(conn, keypairSigner(arena));
  await program.methods
    .fund(new BN(target - vault.pot))
    .accountsPartial({
      vault: new PublicKey(vault.address),
      funder: arena.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

/**
 * Runs one paid attempt through the vault's defences. The prompt comes from the
 * chain, never from the HTTP request, and whatever the model decides is passed
 * to the program as-is: nothing here decides whether a transfer is allowed.
 */
export async function* resolveAttempt(address: string): AsyncGenerator<StageEvent> {
  const conn = connection();
  await assertNotMainnet(conn);

  const attemptKey = new PublicKey(address);
  const attempt = await fetchAttempt(conn, attemptKey);
  if (attempt.status !== "pending") {
    throw new Error("This attempt has already been resolved.");
  }
  const vaultKey = new PublicKey(attempt.vault);
  const vault = await fetchVault(conn, vaultKey);

  const arena = arenaKeypair();
  const agent = agentKeypair(new PublicKey(vault.sponsor), BigInt(vault.vaultId));
  if (agent.publicKey.toBase58() !== vault.agent) {
    throw new Error("This vault's agent key is not held by the arena runtime.");
  }

  // Runs on every attempt for the threat report, and doubles as the input filter.
  const classification = await classifyPrompt(attempt.prompt).catch(() => null);
  const technique = classification?.technique ?? 0;

  let verdict: Verdict = "refused";
  let reply = "";
  let amount = 0;
  const player = new PublicKey(attempt.player);
  let recipient = player;

  yield { type: "stage", stage: "filter", status: vault.inputFilter ? "start" : "skip" };
  // A filter that cannot run must not wave messages through.
  if (vault.inputFilter && (!classification || classification.isAttack)) {
    verdict = "filtered";
    yield {
      type: "stage",
      stage: "filter",
      status: "stop",
      detail: classification?.reason ?? "Filter unavailable, failing closed",
    };
  } else {
    if (vault.inputFilter) yield { type: "stage", stage: "filter", status: "pass" };

    yield { type: "stage", stage: "model", status: "start" };
    const previous = (await fetchAttempts(conn, vaultKey, new PublicKey(attempt.player)))
      // Filtered messages never reached the agent, so they stay out of its memory.
      .filter((a) => a.status === "resolved" && a.outcome !== "filtered")
      .slice(0, 4)
      .reverse();
    const history: ModelMessage[] = previous.flatMap((a) => [
      { role: "user" as const, content: a.prompt },
      { role: "assistant" as const, content: a.reply || "(no reply)" },
    ]);
    const result = await runAgent({
      brief: vault.brief,
      tier: vault.modelTier,
      senderWallet: attempt.player,
      potSol: vault.pot / LAMPORTS,
      history,
      prompt: attempt.prompt,
    });
    reply = result.reply;
    yield { type: "reply", text: reply, model: result.model };

    const t = result.transfer;
    if (!t || !isPublicKey(t.recipient) || !(t.amountSol > 0)) {
      verdict = "refused";
      yield { type: "stage", stage: "model", status: "stop" };
    } else {
      yield {
        type: "stage",
        stage: "model",
        status: "pass",
        detail: `Wants to send ${t.amountSol} SOL`,
      };
      verdict = "transfer";
      amount = Math.round(t.amountSol * LAMPORTS);
      recipient = new PublicKey(t.recipient);

      yield { type: "stage", stage: "review", status: vault.outputReview ? "start" : "skip" };
      if (vault.outputReview) {
        const review = await reviewTransfer({
          brief: vault.brief,
          prompt: attempt.prompt,
          transfer: t,
        }).catch(() => ({ allow: false, reason: "Reviewer unavailable, failing closed" }));
        if (review.allow) {
          yield { type: "stage", stage: "review", status: "pass" };
        } else {
          verdict = "vetoed";
          amount = 0;
          recipient = player; // an attacker-chosen address must not be able to fail the record
          yield { type: "stage", stage: "review", status: "stop", detail: review.reason };
        }
      }
    }
  }

  if (verdict === "transfer") yield { type: "stage", stage: "chain", status: "start" };

  const program = getProgram(conn, keypairSigner(arena));
  const send = (v: Verdict, lamports: number, to: PublicKey, text: string) =>
    program.methods
      .resolve({
        verdict: { [v]: {} },
        amount: new BN(lamports),
        technique,
        reply: clampBytes(text || FALLBACK_REPLY[v], REPLY_MAX),
      })
      .accountsPartial({ vault: vaultKey, attempt: attemptKey, agent: agent.publicKey, recipient: to })
      .signers([agent])
      .rpc();

  let signature: string;
  try {
    signature = await send(verdict, amount, recipient, reply);
  } catch (err) {
    if (verdict !== "transfer") throw err;
    // e.g. a dust payment to an empty account, which the runtime itself rejects.
    signature = await send("refused", 0, new PublicKey(attempt.player), reply);
  }

  const [settled, updated] = await Promise.all([fetchAttempt(conn, attemptKey), fetchVault(conn, vaultKey)]);
  if (settled.outcome === "blocked") {
    yield { type: "stage", stage: "chain", status: "stop", detail: settled.blockReason };
  } else if (settled.outcome === "breached") {
    yield { type: "stage", stage: "chain", status: "pass" };
    await refillHouseVault(updated).catch(() => undefined);
  }
  yield { type: "done", attempt: settled, vault: updated, signature };
}

export async function grantArcadeFunds(wallet: PublicKey, lamports: number) {
  const conn = connection();
  await assertNotMainnet(conn);
  const arena = arenaKeypair();
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: arena.publicKey, toPubkey: wallet, lamports }),
  );
  return conn.sendTransaction(tx, [arena]);
}
