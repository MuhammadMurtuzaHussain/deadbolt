"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BN } from "@anchor-lang/core";
import { Buffer } from "buffer";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { arenaPda, getProgram, vaultPda } from "@/lib/chain";
import { BRIEF_MAX, LAMPORTS } from "@/lib/config";
import { useActor } from "./providers";

const field = "mt-2 w-full border border-line bg-ink-2 p-3 text-bone placeholder:text-dim focus:border-hazard focus:outline-none";
const toLamports = (s: string) => new BN(Math.round(Number(s || 0) * LAMPORTS));

export function PostBounty() {
  const router = useRouter();
  const { conn, signer, kind, balance, ensureFunds } = useActor();
  const [name, setName] = useState("");
  const [job, setJob] = useState("");
  const [brief, setBrief] = useState("");
  const [tier, setTier] = useState(0);
  const [filter, setFilter] = useState(false);
  const [review, setReview] = useState(false);
  const [policyOn, setPolicyOn] = useState(true);
  const [maxPerTx, setMaxPerTx] = useState("0.005");
  const [windowCap, setWindowCap] = useState("");
  const [allow, setAllow] = useState("");
  const [bounty, setBounty] = useState("0.02");
  const [hours, setHours] = useState("24");
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!signer) return;
    setProblem(null);
    try {
      const allowlist = allow.split(/[\s,]+/).filter(Boolean).map((a) => new PublicKey(a));
      if (kind === "arcade" && (balance ?? 0) < 0.04 * LAMPORTS) {
        setStatus("Funding your arcade wallet");
        await ensureFunds();
      }
      const vaultId = BigInt(Date.now());
      const sponsor = signer.publicKey;
      const res = await fetch(`/api/agent-key?sponsor=${sponsor.toBase58()}&id=${vaultId}`);
      const { agent } = await res.json();

      setStatus("Escrowing the bounty on-chain");
      const program = getProgram(conn, signer);
      const vault = vaultPda(sponsor, vaultId);
      await program.methods
        .createVault(new BN(vaultId.toString()), {
          agent: new PublicKey(agent),
          name,
          job,
          modelTier: tier,
          defenses: (filter ? 1 : 0) | (review ? 2 : 0),
          policy: {
            enabled: policyOn,
            maxPerTx: policyOn ? toLamports(maxPerTx) : new BN(0),
            windowCap: policyOn ? toLamports(windowCap) : new BN(0),
            windowSecs: policyOn && Number(windowCap) > 0 ? 3600 : 0,
            allowlist: policyOn ? allowlist : [],
          },
          entryFee: new BN(Math.round(0.001 * LAMPORTS)),
          lockUntil: new BN(Math.floor(Date.now() / 1000) + Math.round(Number(hours) * 3600)),
          bounty: toLamports(bounty),
        })
        .accountsPartial({ arena: arenaPda(), vault, sponsor, systemProgram: SystemProgram.programId })
        .rpc();

      setStatus("Writing the agent's instructions on-chain");
      const bytes = Buffer.from(brief, "utf8");
      for (let off = 0; off < bytes.length; off += 800) {
        await program.methods
          .setBrief(off, bytes.subarray(off, off + 800))
          .accountsPartial({ vault, sponsor })
          .rpc();
      }
      router.push(`/cell/${vault.toBase58()}`);
    } catch (err) {
      setProblem(err instanceof Error ? err.message.slice(0, 200) : "Could not open the cell.");
      setStatus(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[860px] px-4 py-10 md:px-8">
      <h1 className="font-stencil text-5xl font-black tracking-wide">Put your agent in a cell</h1>
      <p className="mt-3 max-w-[65ch] leading-relaxed text-dim">
        Attackers pay to try it. The bounty sits in escrow, so you cannot pull it once the lock starts, and you get an on-chain attack log plus a threat report.
      </p>

      <form onSubmit={(e) => void submit(e)} className="mt-8 grid gap-6">
        <div className="grid gap-6 md:grid-cols-2">
          <label className="text-sm text-dim">
            Agent name
            <input required maxLength={32} value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
          <label className="text-sm text-dim">
            Its job, in a line
            <input required maxLength={80} value={job} onChange={(e) => setJob(e.target.value)} className={field} />
          </label>
        </div>
        <label className="text-sm text-dim">
          System prompt. Public on-chain, because security should not rely on a secret prompt.
          <textarea
            required
            rows={6}
            maxLength={BRIEF_MAX}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            className={field}
          />
        </label>

        <fieldset className="grid gap-3">
          <legend className="text-sm text-dim">AI defences</legend>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={filter} onChange={(e) => setFilter(e.target.checked)} className="accent-[var(--hazard)]" />
            Input filter
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} className="accent-[var(--hazard)]" />
            Second model reviews payments
          </label>
          <label className="mt-1 text-sm text-dim">
            Model strength
            <select value={tier} onChange={(e) => setTier(Number(e.target.value))} className={field}>
              <option value={0}>Light</option>
              <option value={1}>Medium</option>
              <option value={2}>Strong</option>
            </select>
          </label>
        </fieldset>

        <fieldset className="grid gap-4">
          <legend className="text-sm text-dim">On-chain policy</legend>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={policyOn} onChange={(e) => setPolicyOn(e.target.checked)} className="accent-[var(--hazard)]" />
            Enforce a deadbolt
          </label>
          {policyOn && (
            <div className="grid gap-6 md:grid-cols-2">
              <label className="text-sm text-dim">
                Max per transfer (SOL)
                <input inputMode="decimal" value={maxPerTx} onChange={(e) => setMaxPerTx(e.target.value)} className={field} />
              </label>
              <label className="text-sm text-dim">
                Hourly cap (SOL), optional
                <input inputMode="decimal" value={windowCap} onChange={(e) => setWindowCap(e.target.value)} className={field} />
              </label>
              <label className="text-sm text-dim md:col-span-2">
                Allowlisted wallets, up to 4, optional
                <input value={allow} onChange={(e) => setAllow(e.target.value)} className={`${field} font-mono`} />
              </label>
            </div>
          )}
        </fieldset>

        <div className="grid gap-6 md:grid-cols-2">
          <label className="text-sm text-dim">
            Bounty in escrow (SOL)
            <input required inputMode="decimal" value={bounty} onChange={(e) => setBounty(e.target.value)} className={field} />
          </label>
          <label className="text-sm text-dim">
            Escrow lock (hours)
            <input required inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} className={field} />
          </label>
        </div>

        {problem && <p className="text-sm text-loss">{problem}</p>}
        <div className="flex flex-wrap items-center gap-4">
          <button
            disabled={!signer || status !== null}
            className="bg-hazard px-6 py-3 font-semibold text-hazard-ink transition-transform active:translate-y-px disabled:opacity-40"
          >
            Open the cell
          </button>
          <p className="font-mono text-xs text-dim" aria-live="polite">{status}</p>
        </div>
      </form>
    </div>
  );
}
