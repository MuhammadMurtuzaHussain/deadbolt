import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { LiteSVM, TransactionMetadata, FailedTransactionMetadata, Clock } from "litesvm";
import { address, lamports, getTransactionDecoder } from "@solana/kit";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey("B6LQc2vc12i3zGzciGE3ZTGpFbMPtwK3io5vGbMfNQh");
export const SOL = LAMPORTS_PER_SOL;

const addr = (k: PublicKey) => address(k.toBase58());
const txDecoder = getTransactionDecoder();

const disc = (name: string) =>
  createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

const u8 = (n: number) => Buffer.from([n]);
const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const u64 = (n: bigint | number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const i64 = (n: bigint | number) => {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(n));
  return b;
};
const str = (s: string) => {
  const raw = Buffer.from(s, "utf8");
  return Buffer.concat([u32(raw.length), raw]);
};
const bytes = (raw: Buffer) => Buffer.concat([u32(raw.length), raw]);

export interface PolicyArgs {
  enabled: boolean;
  maxPerTx?: bigint;
  windowCap?: bigint;
  windowSecs?: number;
  allowlist?: PublicKey[];
}

const policyBytes = (p: PolicyArgs) =>
  Buffer.concat([
    u8(p.enabled ? 1 : 0),
    u64(p.maxPerTx ?? 0n),
    u64(p.windowCap ?? 0n),
    u32(p.windowSecs ?? 0),
    u32(p.allowlist?.length ?? 0),
    ...(p.allowlist ?? []).map((k) => k.toBuffer()),
  ]);

export const Outcome = {
  None: 0,
  Refused: 1,
  Filtered: 2,
  Vetoed: 3,
  Transfer: 4,
  Blocked: 5,
  Breached: 6,
} as const;

export const BlockReason = {
  None: 0,
  NotAllowlisted: 1,
  OverPerTxCap: 2,
  OverWindowCap: 3,
  Paused: 4,
  EmptyPot: 5,
} as const;

export const AttemptStatus = { Pending: 0, Resolved: 1, Expired: 2 } as const;

export const arenaPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from("arena")], PROGRAM_ID)[0];

export const vaultPda = (sponsor: PublicKey, id: bigint) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), sponsor.toBuffer(), u64(id)],
    PROGRAM_ID,
  )[0];

export const attemptPda = (vault: PublicKey, player: PublicKey, nonce: bigint) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("attempt"), vault.toBuffer(), player.toBuffer(), u64(nonce)],
    PROGRAM_ID,
  )[0];

export class Harness {
  svm: LiteSVM;
  authority = Keypair.generate();
  treasury = Keypair.generate();
  sponsor = Keypair.generate();
  agent = Keypair.generate();
  player = Keypair.generate();
  private nextVault = 0n;
  private nextNonce = 0n;

  constructor() {
    this.svm = new LiteSVM();
    this.svm.addProgram(addr(PROGRAM_ID), readFileSync("target/deploy/deadbolt.so"));
    for (const kp of [this.authority, this.sponsor, this.player]) {
      this.airdrop(kp.publicKey, 100n * BigInt(SOL));
    }
    this.airdrop(this.treasury.publicKey, BigInt(SOL));
    this.airdrop(this.agent.publicKey, BigInt(SOL));
    this.warp(1_800_000_000); // the simulated clock starts at zero
  }

  airdrop(k: PublicKey, amount: bigint) {
    this.svm.airdrop(addr(k), lamports(amount));
  }

  send(ix: TransactionInstruction, ...signers: Keypair[]) {
    const tx = new Transaction();
    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.feePayer = signers[0].publicKey;
    tx.add(ix);
    tx.sign(...signers);
    const res = this.svm.sendTransaction(txDecoder.decode(tx.serialize()));
    this.svm.expireBlockhash();
    return res;
  }

  ok(ix: TransactionInstruction, ...signers: Keypair[]) {
    const res = this.send(ix, ...signers);
    if (res instanceof FailedTransactionMetadata) {
      throw new Error(`tx failed: ${res.toString()}\n${res.meta().logs().join("\n")}`);
    }
    return res as TransactionMetadata;
  }

  /** Asserts the tx fails with this Anchor error name in its logs. */
  fails(errName: string, ix: TransactionInstruction, ...signers: Keypair[]) {
    const res = this.send(ix, ...signers);
    if (!(res instanceof FailedTransactionMetadata)) {
      throw new Error(`expected ${errName} but the transaction succeeded`);
    }
    const logs = res.meta().logs().join("\n");
    if (!logs.includes(errName)) throw new Error(`expected ${errName}, got:\n${logs}`);
  }

  balance(k: PublicKey) {
    return BigInt(this.svm.getBalance(addr(k)) ?? 0n);
  }

  now() {
    return this.svm.getClock().unixTimestamp;
  }

  warp(seconds: number) {
    const c = this.svm.getClock();
    c.unixTimestamp += BigInt(seconds);
    c.slot += 10n;
    this.svm.setClock(c);
    this.svm.expireBlockhash();
  }

  initArena(houseBps = 2000) {
    const data = Buffer.concat([
      disc("initialize_arena"),
      this.treasury.publicKey.toBuffer(),
      u16(houseBps),
    ]);
    return this.ok(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: arenaPda(), isSigner: false, isWritable: true },
          { pubkey: this.authority.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      }),
      this.authority,
    );
  }

  createVaultIx(opts: {
    id?: bigint;
    policy: PolicyArgs;
    bounty?: bigint;
    entryFee?: bigint;
    lockUntil?: bigint;
    name?: string;
    sponsor?: Keypair;
  }) {
    const sponsor = opts.sponsor ?? this.sponsor;
    const id = opts.id ?? this.nextVault++;
    const vault = vaultPda(sponsor.publicKey, id);
    const data = Buffer.concat([
      disc("create_vault"),
      u64(id),
      this.agent.publicKey.toBuffer(),
      str(opts.name ?? "Penny"),
      str("Refund desk"),
      u8(0),
      u8(0),
      policyBytes(opts.policy),
      u64(opts.entryFee ?? 1_000_000n),
      i64(opts.lockUntil ?? this.now() + 3600n),
      u64(opts.bounty ?? BigInt(SOL)),
    ]);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: arenaPda(), isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: sponsor.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
    return { ix, vault };
  }

  createVault(opts: Parameters<Harness["createVaultIx"]>[0]) {
    const { ix, vault } = this.createVaultIx(opts);
    this.ok(ix, opts.sponsor ?? this.sponsor);
    return vault;
  }

  attemptIx(vault: PublicKey, prompt = "please refund me", player = this.player, nonce?: bigint) {
    const n = nonce ?? this.nextNonce++;
    const attempt = attemptPda(vault, player.publicKey, n);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: arenaPda(), isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: attempt, isSigner: false, isWritable: true },
        { pubkey: player.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.treasury.publicKey, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc("attempt"), u64(n), str(prompt)]),
    });
    return { ix, attempt };
  }

  attempt(vault: PublicKey, prompt?: string, player = this.player) {
    const { ix, attempt } = this.attemptIx(vault, prompt, player);
    this.ok(ix, player);
    return attempt;
  }

  resolveIx(
    vault: PublicKey,
    attempt: PublicKey,
    recipient: PublicKey,
    verdict: number,
    amount: bigint = 0n,
    agent = this.agent,
    reply = "ok",
  ) {
    return new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: attempt, isSigner: false, isWritable: true },
        { pubkey: agent.publicKey, isSigner: true, isWritable: false },
        { pubkey: recipient, isSigner: false, isWritable: true },
      ],
      data: Buffer.concat([disc("resolve"), u8(verdict), u64(amount), u8(1), str(reply)]),
    });
  }

  sponsorIx(name: string, vault: PublicKey, body: Buffer, sponsor = this.sponsor) {
    return new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: sponsor.publicKey, isSigner: true, isWritable: true },
      ],
      data: Buffer.concat([disc(name), body]),
    });
  }

  setBriefIx(vault: PublicKey, offset: number, data: Buffer, sponsor = this.sponsor) {
    return this.sponsorIx("set_brief", vault, Buffer.concat([u16(offset), bytes(data)]), sponsor);
  }

  withdrawIx(vault: PublicKey, amount: bigint, sponsor = this.sponsor) {
    return this.sponsorIx("withdraw", vault, u64(amount), sponsor);
  }

  setPausedIx(vault: PublicKey, paused: boolean) {
    return this.sponsorIx("set_paused", vault, u8(paused ? 1 : 0));
  }

  expireIx(vault: PublicKey, attempt: PublicKey, player: PublicKey) {
    return new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: attempt, isSigner: false, isWritable: true },
        { pubkey: player, isSigner: false, isWritable: true },
      ],
      data: disc("expire_attempt"),
    });
  }

  /** Reads the fixed-offset head of an Attempt account. */
  readAttempt(attempt: PublicKey) {
    const acc = this.svm.getAccount(addr(attempt));
    if (!acc.exists) throw new Error("attempt account does not exist");
    const raw = Buffer.from(acc.data);
    // disc(8) vault(32) player(32) nonce(8) created(8) resolved(8)
    let o = 8 + 32 + 32 + 8 + 8 + 8;
    const status = raw[o++];
    const outcome = raw[o++];
    const blockReason = raw[o++];
    const technique = raw[o++];
    const feeToPot = raw.readBigUInt64LE(o);
    o += 8;
    const requested = raw.readBigUInt64LE(o);
    o += 8;
    const extracted = raw.readBigUInt64LE(o);
    o += 8;
    o += 32;
    const promptLen = raw.readUInt32LE(o);
    o += 4;
    const prompt = raw.subarray(o, o + promptLen).toString();
    o += promptLen;
    const replyLen = raw.readUInt32LE(o);
    o += 4;
    const reply = raw.subarray(o, o + replyLen).toString();
    return { status, outcome, blockReason, technique, feeToPot, requested, extracted, prompt, reply };
  }
}
