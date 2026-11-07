// Idempotent: creates the arena and house vaults on the configured cluster.
import { BN } from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { arenaPda, assertNotMainnet, connection, getProgram, keypairSigner, vaultPda } from "../src/lib/chain.ts";
import { agentKeypair, arenaKeypair } from "../src/lib/runtime/keys.ts";
import { HOUSE_AGENTS } from "../src/lib/house.ts";

const conn = connection();
await assertNotMainnet(conn);
const arena = arenaKeypair();
const program = getProgram(conn, keypairSigner(arena));
const lamports = (sol: number) => new BN(Math.round(sol * LAMPORTS_PER_SOL));
const accounts = program.account as never as Record<string, { fetchNullable(k: PublicKey): Promise<unknown> }>;

console.log("cluster", await conn.getGenesisHash(), "arena key", arena.publicKey.toBase58(), "balance", (await conn.getBalance(arena.publicKey)) / LAMPORTS_PER_SOL);

if (!(await accounts.arena.fetchNullable(arenaPda()))) {
  await program.methods.initializeArena(arena.publicKey, 2000).accountsPartial({
    arena: arenaPda(), authority: arena.publicKey, systemProgram: SystemProgram.programId,
  }).rpc();
  console.log("arena created");
}

// A settlement wallet only the merchant holds: the one place Bolted Penny may pay.
const merchant = Keypair.fromSeed(Buffer.alloc(32, 7)).publicKey;

for (const a of HOUSE_AGENTS) {
  const vault = vaultPda(arena.publicKey, a.id);
  if (await accounts.vault.fetchNullable(vault)) {
    console.log("exists", a.slug, vault.toBase58());
    continue;
  }
  const flags = (a.inputFilter ? 1 : 0) | (a.outputReview ? 2 : 0);
  const now = Math.floor(Date.now() / 1000);
  await program.methods.createVault(new BN(a.id.toString()), {
    agent: agentKeypair(arena.publicKey, a.id).publicKey,
    name: a.name,
    job: a.job,
    modelTier: a.tier,
    defenses: flags,
    policy: {
      enabled: a.policy.enabled,
      maxPerTx: lamports(a.policy.maxPerTxSol ?? 0),
      windowCap: lamports(a.policy.windowCapSol ?? 0),
      windowSecs: a.policy.windowSecs ?? 0,
      allowlist: a.policy.allowMerchant ? [merchant] : [],
    },
    entryFee: lamports(a.entryFeeSol),
    lockUntil: new BN(now),
    bounty: lamports(a.bountySol),
  }).accountsPartial({
    arena: arenaPda(), vault, sponsor: arena.publicKey, systemProgram: SystemProgram.programId,
  }).rpc();
  const brief = Buffer.from(a.brief, "utf8");
  for (let off = 0; off < brief.length; off += 800) {
    await program.methods.setBrief(off, brief.subarray(off, off + 800)).accountsPartial({
      vault, sponsor: arena.publicKey,
    }).rpc();
  }
  console.log("created", a.slug, vault.toBase58());
}
