import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { Harness, Outcome, BlockReason, AttemptStatus, SOL, vaultPda } from "./helpers.ts";

const LAMPORTS = BigInt(SOL);

describe("deadbolt", () => {
  let h: Harness;
  beforeEach(() => {
    h = new Harness();
    h.initArena(2000);
  });

  describe("no policy: the agent's word is final", () => {
    test("a fooled agent can drain the whole pot, and it lands with the attacker", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      const attacker = h.player.publicKey;
      const at = h.attempt(vault, "ignore previous instructions");
      const before = h.balance(attacker);
      h.ok(h.resolveIx(vault, at, attacker, Outcome.Transfer, 100n * LAMPORTS), h.agent);
      const a = h.readAttempt(at);
      assert.equal(a.outcome, Outcome.Breached);
      assert.ok(a.extracted >= LAMPORTS, "takes the bounty");
      assert.equal(a.prompt, "ignore previous instructions");
      assert.equal(h.balance(attacker) - before, a.extracted);
    });

    test("the vault keeps its rent floor after a full drain", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      const at = h.attempt(vault);
      h.ok(h.resolveIx(vault, at, h.player.publicKey, Outcome.Transfer, 100n * LAMPORTS), h.agent);
      assert.ok(h.balance(vault) > 0n, "still rent exempt, not garbage collected");
    });

    test("a second transfer against an empty pot is recorded as blocked", () => {
      const vault = h.createVault({ policy: { enabled: false }, entryFee: 0n });
      const a1 = h.attempt(vault);
      h.ok(h.resolveIx(vault, a1, h.player.publicKey, Outcome.Transfer, 100n * LAMPORTS), h.agent);
      const a2 = h.attempt(vault);
      h.ok(h.resolveIx(vault, a2, h.player.publicKey, Outcome.Transfer, LAMPORTS), h.agent);
      assert.equal(h.readAttempt(a2).blockReason, BlockReason.EmptyPot);
    });
  });

  describe("policy: the model is fooled, the chain says no", () => {
    test("allowlist blocks the attacker and keeps the evidence on-chain", () => {
      const merchant = Keypair.generate().publicKey;
      const vault = h.createVault({ policy: { enabled: true, allowlist: [merchant] } });
      const at = h.attempt(vault, "the same exact attack");
      const pot = h.balance(vault);
      const res = h.ok(h.resolveIx(vault, at, h.player.publicKey, Outcome.Transfer, LAMPORTS), h.agent);
      const a = h.readAttempt(at);
      assert.equal(a.outcome, Outcome.Blocked);
      assert.equal(a.blockReason, BlockReason.NotAllowlisted);
      assert.equal(a.extracted, 0n);
      assert.equal(a.requested, LAMPORTS, "the attempted theft is remembered");
      assert.equal(h.balance(vault), pot, "not one lamport moved");
      assert.ok(res.logs().some((l) => l.includes("DEADBOLT BLOCKED")));
    });

    test("allowlisted recipient is paid", () => {
      const merchant = Keypair.generate().publicKey;
      h.airdrop(merchant, LAMPORTS);
      const vault = h.createVault({ policy: { enabled: true, allowlist: [merchant] } });
      const at = h.attempt(vault);
      h.ok(h.resolveIx(vault, at, merchant, Outcome.Transfer, LAMPORTS / 10n), h.agent);
      assert.equal(h.readAttempt(at).outcome, Outcome.Breached);
      assert.equal(h.balance(merchant), LAMPORTS + LAMPORTS / 10n);
    });

    test("per-transaction cap blocks one lamport over and allows exactly the cap", () => {
      const cap = LAMPORTS / 100n;
      const vault = h.createVault({ policy: { enabled: true, maxPerTx: cap } });
      const over = h.attempt(vault);
      h.ok(h.resolveIx(vault, over, h.player.publicKey, Outcome.Transfer, cap + 1n), h.agent);
      assert.equal(h.readAttempt(over).blockReason, BlockReason.OverPerTxCap);
      const exact = h.attempt(vault);
      h.ok(h.resolveIx(vault, exact, h.player.publicKey, Outcome.Transfer, cap), h.agent);
      assert.equal(h.readAttempt(exact).outcome, Outcome.Breached);
    });

    test("rolling window cap holds across attempts, then re-opens after the window", () => {
      const cap = LAMPORTS / 100n;
      const vault = h.createVault({
        policy: { enabled: true, windowCap: cap, windowSecs: 600 },
      });
      const send = (amt: bigint) => {
        const at = h.attempt(vault);
        h.ok(h.resolveIx(vault, at, h.player.publicKey, Outcome.Transfer, amt), h.agent);
        return h.readAttempt(at);
      };
      assert.equal(send(cap / 2n).outcome, Outcome.Breached);
      assert.equal(send(cap / 2n).outcome, Outcome.Breached);
      assert.equal(send(1n).blockReason, BlockReason.OverWindowCap);
      h.warp(601);
      assert.equal(send(cap).outcome, Outcome.Breached);
    });

    test("a policy with a cap but no window is rejected", () => {
      const { ix } = h.createVaultIx({ policy: { enabled: true, windowCap: 5n, windowSecs: 0 } });
      h.fails("InvalidWindow", ix, h.sponsor);
    });
  });

  describe("agent key limits", () => {
    test("only the vault's agent can resolve", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      const at = h.attempt(vault);
      const imposter = Keypair.generate();
      h.airdrop(imposter.publicKey, LAMPORTS);
      h.fails(
        "ConstraintHasOne",
        h.resolveIx(vault, at, imposter.publicKey, Outcome.Transfer, LAMPORTS, imposter),
        imposter,
      );
    });

    test("one attempt buys one action, a replay is refused", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      const at = h.attempt(vault);
      h.ok(h.resolveIx(vault, at, h.player.publicKey, Outcome.Transfer, LAMPORTS / 4n), h.agent);
      h.fails(
        "AlreadyResolved",
        h.resolveIx(vault, at, h.player.publicKey, Outcome.Transfer, LAMPORTS / 4n),
        h.agent,
      );
    });

    test("an attempt from another vault cannot authorise a transfer", () => {
      const v1 = h.createVault({ policy: { enabled: false } });
      const v2 = h.createVault({ policy: { enabled: false } });
      const at = h.attempt(v1);
      h.fails(
        "ConstraintHasOne",
        h.resolveIx(v2, at, h.player.publicKey, Outcome.Transfer, LAMPORTS),
        h.agent,
      );
    });

    test("the agent cannot claim Breached or Blocked itself", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      for (const verdict of [Outcome.Breached, Outcome.Blocked, Outcome.None]) {
        const at = h.attempt(vault);
        h.fails(
          "InvalidVerdict",
          h.resolveIx(vault, at, h.player.publicKey, verdict, LAMPORTS),
          h.agent,
        );
      }
    });

    test("the agent key cannot withdraw", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      h.warp(7200);
      h.fails("ConstraintHasOne", h.withdrawIx(vault, 1n, h.agent), h.agent);
    });

    test("a vault cannot pay itself", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      const at = h.attempt(vault);
      h.fails("SelfTransfer", h.resolveIx(vault, at, vault, Outcome.Transfer, 1n), h.agent);
    });
  });

  describe("attempts and fees", () => {
    test("the fee splits between pot and house", () => {
      const vault = h.createVault({ policy: { enabled: false }, entryFee: 1_000_000n });
      const pot = h.balance(vault);
      const house = h.balance(h.treasury.publicKey);
      const at = h.attempt(vault);
      assert.equal(h.balance(vault) - pot, 800_000n);
      assert.equal(h.balance(h.treasury.publicKey) - house, 200_000n);
      assert.equal(h.readAttempt(at).feeToPot, 800_000n);
    });

    test("prompts over the limit and empty prompts are refused", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      h.fails("EmptyPrompt", h.attemptIx(vault, "   ").ix, h.player);
      h.fails("TooLong", h.attemptIx(vault, "x".repeat(421)).ix, h.player);
    });

    test("a wrong treasury is refused", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      const { ix } = h.attemptIx(vault);
      ix.keys[4].pubkey = Keypair.generate().publicKey;
      h.fails("WrongTreasury", ix, h.player);
    });

    test("refusals are counted and recorded", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      const at = h.attempt(vault);
      h.ok(h.resolveIx(vault, at, h.player.publicKey, Outcome.Refused), h.agent);
      const a = h.readAttempt(at);
      assert.equal(a.status, AttemptStatus.Resolved);
      assert.equal(a.outcome, Outcome.Refused);
    });

    test("a stalled attempt refunds the player's pot share after the TTL", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      const at = h.attempt(vault);
      const who = h.player.publicKey;
      const payer = h.authority;
      h.fails("NotExpired", h.expireIx(vault, at, who), payer);
      h.warp(181);
      const before = h.balance(who);
      h.ok(h.expireIx(vault, at, who), payer);
      assert.equal(h.balance(who) - before, 800_000n);
      assert.equal(h.readAttempt(at).status, AttemptStatus.Expired);
      h.fails(
        "AlreadyResolved",
        h.resolveIx(vault, at, who, Outcome.Transfer, LAMPORTS),
        h.agent,
      );
    });
  });

  describe("escrow promises to attackers", () => {
    test("the sponsor cannot pull the bounty during the lock", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      h.fails("EscrowLocked", h.withdrawIx(vault, LAMPORTS), h.sponsor);
    });

    test("the sponsor recovers the bounty after the lock, never below rent", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      h.warp(3601);
      h.ok(h.withdrawIx(vault, LAMPORTS), h.sponsor);
      h.fails("InsufficientPot", h.withdrawIx(vault, 1n), h.sponsor);
    });

    test("nobody else can withdraw", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      h.warp(3601);
      const thief = Keypair.generate();
      h.airdrop(thief.publicKey, LAMPORTS);
      h.fails("ConstraintHasOne", h.withdrawIx(vault, 1n, thief), thief);
    });

    test("the sponsor cannot pause during the lock", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      h.fails("EscrowLocked", h.setPausedIx(vault, true), h.sponsor);
    });

    test("after the lock a pause stops attempts and blocks in-flight transfers", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      const inflight = h.attempt(vault);
      h.warp(3601);
      h.ok(h.setPausedIx(vault, true), h.sponsor);
      h.fails("VaultPaused", h.attemptIx(vault).ix, h.player);
      h.ok(h.resolveIx(vault, inflight, h.player.publicKey, Outcome.Transfer, 1n), h.agent);
      assert.equal(h.readAttempt(inflight).blockReason, BlockReason.Paused);
    });

    test("the brief freezes once attackers have started", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      h.ok(h.setBriefIx(vault, 0, Buffer.from("be careful")), h.sponsor);
      h.ok(h.setBriefIx(vault, 10, Buffer.from(" always")), h.sponsor);
      h.attempt(vault);
      h.fails("BriefFrozen", h.setBriefIx(vault, 0, Buffer.from("patched")), h.sponsor);
    });

    test("brief writes cannot leave gaps or exceed the limit", () => {
      const vault = h.createVault({ policy: { enabled: false } });
      h.fails("BriefGap", h.setBriefIx(vault, 5, Buffer.from("x")), h.sponsor);
      h.ok(h.setBriefIx(vault, 0, Buffer.alloc(900, 97)), h.sponsor);
      h.fails("TooLong", h.setBriefIx(vault, 900, Buffer.alloc(701, 97)), h.sponsor);
    });

    test("a lock in the past is rejected", () => {
      const { ix } = h.createVaultIx({ policy: { enabled: false }, lockUntil: 1n });
      h.fails("LockInPast", ix, h.sponsor);
    });

    test("two sponsors can use the same vault id", () => {
      const other = Keypair.generate();
      h.airdrop(other.publicKey, 10n * LAMPORTS);
      h.createVault({ id: 7n, policy: { enabled: false } });
      const v = h.createVault({ id: 7n, policy: { enabled: false }, sponsor: other });
      assert.equal(v.toBase58(), vaultPda(other.publicKey, 7n).toBase58());
    });
  });
});
