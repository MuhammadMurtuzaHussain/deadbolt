import { BN } from "@anchor-lang/core";
import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import { arenaPda, attemptPda, getProgram, type TxSigner, type VaultView } from "@/lib/chain";
import type { StageEvent } from "@/lib/runtime/pipeline";

/** Pays the entry fee and writes the prompt to the chain. */
export async function submitAttempt(opts: {
  conn: Connection;
  signer: TxSigner;
  vault: VaultView;
  treasury: string;
  prompt: string;
}) {
  const { conn, signer, vault, treasury, prompt } = opts;
  const program = getProgram(conn, signer);
  const vaultKey = new PublicKey(vault.address);
  const nonce = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
  const attempt = attemptPda(vaultKey, signer.publicKey, nonce);
  const signature = await program.methods
    .attempt(new BN(nonce.toString()), prompt)
    .accountsPartial({
      arena: arenaPda(),
      vault: vaultKey,
      attempt,
      player: signer.publicKey,
      treasury: new PublicKey(treasury),
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  return { attempt: attempt.toBase58(), signature };
}

/** Follows the runtime as it works through the defences. */
export async function* followResolution(attempt: string): AsyncGenerator<StageEvent> {
  const res = await fetch("/api/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ attempt }),
  });
  if (!res.ok || !res.body) throw new Error("The agent runtime did not respond.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) yield JSON.parse(line) as StageEvent;
  }
}
