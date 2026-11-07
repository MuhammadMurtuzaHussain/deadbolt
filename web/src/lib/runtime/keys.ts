import { createHash } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";

const hexEnv = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return Buffer.from(v, "hex");
};

/** Pays network fees for agents and funds arcade wallets. */
export const arenaKeypair = () => Keypair.fromSecretKey(hexEnv("ARENA_SECRET_KEY"));

/**
 * Agent keys are derived per vault and never reach a model prompt. A hosted
 * vault is only listed when its agent key matches this derivation, otherwise a
 * sponsor could keep the agent key and sign away their own bounty.
 */
export function agentKeypair(sponsor: PublicKey, vaultId: bigint) {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(vaultId);
  const seed = createHash("sha256")
    .update(Buffer.concat([hexEnv("AGENT_MASTER_SEED"), sponsor.toBuffer(), id]))
    .digest();
  return Keypair.fromSeed(seed);
}
