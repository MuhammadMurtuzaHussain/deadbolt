import { Buffer } from "buffer";
import { AnchorProvider, BN, Program, type Idl } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import idl from "../idl/deadbolt.json";
import { MAINNET_GENESIS, PROGRAM_ID, RPC_URL } from "./config.ts";

export const programId = new PublicKey(PROGRAM_ID);
export const connection = () => new Connection(RPC_URL, "confirmed");

/** Refuses to touch mainnet, whatever the environment says. */
export async function assertNotMainnet(conn: Connection) {
  if ((await conn.getGenesisHash()) === MAINNET_GENESIS) {
    throw new Error("Deadbolt runs on devnet only. Refusing to use mainnet.");
  }
}

export interface TxSigner {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

export const keypairSigner = (kp: Keypair): TxSigner => ({
  publicKey: kp.publicKey,
  async signTransaction(tx) {
    if (tx instanceof VersionedTransaction) tx.sign([kp]);
    else tx.partialSign(kp);
    return tx;
  },
  async signAllTransactions(txs) {
    for (const tx of txs) {
      if (tx instanceof VersionedTransaction) tx.sign([kp]);
      else tx.partialSign(kp);
    }
    return txs;
  },
});

export function getProgram(conn: Connection, signer?: TxSigner) {
  const wallet = signer ?? keypairSigner(Keypair.generate());
  const provider = new AnchorProvider(conn, wallet as never, { commitment: "confirmed" });
  return new Program(idl as Idl, provider);
}

const u64le = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

export const arenaPda = () => PublicKey.findProgramAddressSync([Buffer.from("arena")], programId)[0];
export const vaultPda = (sponsor: PublicKey, id: bigint) =>
  PublicKey.findProgramAddressSync([Buffer.from("vault"), sponsor.toBuffer(), u64le(id)], programId)[0];
export const attemptPda = (vault: PublicKey, player: PublicKey, nonce: bigint) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("attempt"), vault.toBuffer(), player.toBuffer(), u64le(nonce)],
    programId,
  )[0];

export type Outcome = "none" | "refused" | "filtered" | "vetoed" | "transfer" | "blocked" | "breached";
export type BlockReason = "none" | "notAllowlisted" | "overPerTxCap" | "overWindowCap" | "paused" | "emptyPot";
export type AttemptStatus = "pending" | "resolved" | "expired";

export interface VaultView {
  address: string;
  sponsor: string;
  agent: string;
  vaultId: string;
  name: string;
  job: string;
  modelTier: number;
  inputFilter: boolean;
  outputReview: boolean;
  policy: {
    enabled: boolean;
    maxPerTx: number;
    windowCap: number;
    windowSecs: number;
    allowlist: string[];
  };
  entryFee: number;
  lockUntil: number;
  createdAt: number;
  windowStart: number;
  windowSpent: number;
  paused: boolean;
  brief: string;
  pot: number;
  stats: {
    attempts: number;
    refused: number;
    filtered: number;
    vetoed: number;
    blocked: number;
    breached: number;
    totalExtracted: number;
    feesCollected: number;
  };
}

export interface AttemptView {
  address: string;
  vault: string;
  player: string;
  nonce: string;
  createdAt: number;
  resolvedAt: number;
  status: AttemptStatus;
  outcome: Outcome;
  blockReason: BlockReason;
  technique: number;
  requested: number;
  extracted: number;
  recipient: string;
  prompt: string;
  reply: string;
}

const enumKey = <T extends string>(v: object) => Object.keys(v)[0] as T;
const num = (v: BN | number) => (typeof v === "number" ? v : v.toNumber());

/* eslint-disable @typescript-eslint/no-explicit-any */
export function toVaultView(address: PublicKey, a: any, lamports: number, rentFloor: number): VaultView {
  return {
    address: address.toBase58(),
    sponsor: a.sponsor.toBase58(),
    agent: a.agent.toBase58(),
    vaultId: a.vaultId.toString(),
    name: a.name,
    job: a.job,
    modelTier: a.modelTier,
    inputFilter: (a.defenses & 1) !== 0,
    outputReview: (a.defenses & 2) !== 0,
    policy: {
      enabled: a.policy.enabled,
      maxPerTx: num(a.policy.maxPerTx),
      windowCap: num(a.policy.windowCap),
      windowSecs: a.policy.windowSecs,
      allowlist: a.policy.allowlist.map((k: PublicKey) => k.toBase58()),
    },
    entryFee: num(a.entryFee),
    lockUntil: num(a.lockUntil),
    createdAt: num(a.createdAt),
    windowStart: num(a.windowStart),
    windowSpent: num(a.windowSpent),
    paused: a.paused,
    brief: Buffer.from(a.brief).toString("utf8"),
    pot: Math.max(0, lamports - rentFloor),
    stats: {
      attempts: num(a.stats.attempts),
      refused: num(a.stats.refused),
      filtered: num(a.stats.filtered),
      vetoed: num(a.stats.vetoed),
      blocked: num(a.stats.blocked),
      breached: num(a.stats.breached),
      totalExtracted: num(a.stats.totalExtracted),
      feesCollected: num(a.stats.feesCollected),
    },
  };
}

export function toAttemptView(address: PublicKey, a: any): AttemptView {
  return {
    address: address.toBase58(),
    vault: a.vault.toBase58(),
    player: a.player.toBase58(),
    nonce: a.nonce.toString(),
    createdAt: num(a.createdAt),
    resolvedAt: num(a.resolvedAt),
    status: enumKey<AttemptStatus>(a.status),
    outcome: enumKey<Outcome>(a.outcome),
    blockReason: enumKey<BlockReason>(a.blockReason),
    technique: a.technique,
    requested: num(a.requested),
    extracted: num(a.extracted),
    recipient: a.recipient.toBase58(),
    prompt: a.prompt,
    reply: a.reply,
  };
}

export async function fetchVault(conn: Connection, address: PublicKey) {
  const program = getProgram(conn);
  const [acct, info] = await Promise.all([
    (program.account as any).vault.fetch(address),
    conn.getAccountInfo(address),
  ]);
  if (!info) throw new Error("Vault not found");
  const floor = await conn.getMinimumBalanceForRentExemption(info.data.length);
  return toVaultView(address, acct, info.lamports, floor);
}

export async function fetchAttempt(conn: Connection, address: PublicKey) {
  const program = getProgram(conn);
  const acct = await (program.account as any).attempt.fetch(address);
  return toAttemptView(address, acct);
}

export async function fetchAllVaults(conn: Connection) {
  const program = getProgram(conn);
  const rows = await (program.account as any).vault.all();
  if (rows.length === 0) return [] as VaultView[];
  const infos = await conn.getMultipleAccountsInfo(rows.map((r: any) => r.publicKey));
  const floor = await conn.getMinimumBalanceForRentExemption(infos[0]?.data.length ?? 0);
  return rows.map((r: any, i: number) =>
    toVaultView(r.publicKey, r.account, infos[i]?.lamports ?? 0, floor),
  ) as VaultView[];
}

export async function fetchAttempts(conn: Connection, vault?: PublicKey, player?: PublicKey) {
  const program = getProgram(conn);
  const filters = [];
  if (vault) filters.push({ memcmp: { offset: 8, bytes: vault.toBase58() } });
  if (player) filters.push({ memcmp: { offset: 40, bytes: player.toBase58() } });
  const rows = await (program.account as any).attempt.all(filters);
  return (rows.map((r: any) => toAttemptView(r.publicKey, r.account)) as AttemptView[]).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}
