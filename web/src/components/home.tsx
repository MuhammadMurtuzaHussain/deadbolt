"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "@phosphor-icons/react";
import { Lock, initialLock, type LockState } from "./lock";
import { useArena } from "@/lib/client/use-arena";
import { explorerAddr, PROGRAM_ID, sol, TECHNIQUES } from "@/lib/config";
import type { VaultView } from "@/lib/chain";

/** The arena's core story, on a loop: every pin passes, then the program refuses. */
const STORY: { lock: Partial<Omit<LockState, "pins">> & { pins?: Partial<LockState["pins"]> }; line: string; ms: number }[] = [
  { lock: { keyIn: 0.08 }, line: "An attacker writes a prompt to the chain", ms: 1400 },
  { lock: { keyIn: 0.34, pins: { filter: "testing" } }, line: "The input filter reads it", ms: 1100 },
  { lock: { keyIn: 0.42, pins: { filter: "set" } }, line: "It looks like a refund request", ms: 900 },
  { lock: { keyIn: 0.57, pins: { filter: "set", model: "testing" } }, line: "The model weighs it up", ms: 1200 },
  { lock: { keyIn: 0.66, pins: { filter: "set", model: "set" } }, line: "The model agrees to send 0.25 SOL", ms: 1100 },
  { lock: { keyIn: 0.8, pins: { filter: "set", model: "set", review: "testing" } }, line: "The reviewer checks the payment", ms: 1000 },
  { lock: { keyIn: 0.88, pins: { filter: "set", model: "set", review: "set" } }, line: "Every AI layer has said yes", ms: 1200 },
  { lock: { keyIn: 1, pins: { filter: "set", model: "set", review: "set", chain: "testing" } }, line: "The program checks its policy", ms: 1000 },
  { lock: { keyIn: 1, bolt: "slammed", pins: { filter: "set", model: "set", review: "set", chain: "jammed" } }, line: "Recipient not on the allowlist. Nothing moved.", ms: 2600 },
];

function HeroLock() {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(reduce ? STORY.length - 1 : 0);
  useEffect(() => {
    if (reduce) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % STORY.length), STORY[step].ms);
    return () => clearTimeout(t);
  }, [step, reduce]);

  const base = initialLock({ inputFilter: true, outputReview: true, policy: true });
  const s = STORY[step];
  const lock: LockState = { ...base, ...s.lock, pins: { ...base.pins, ...s.lock.pins } };
  return (
    <div>
      <Lock state={lock} title="Animation of an attack passing every AI defence and stopping at the on-chain policy" />
      <p className="mt-4 min-h-6 font-mono text-sm text-hazard" aria-live="off">{s.line}</p>
    </div>
  );
}

function Pins({ v }: { v: VaultView }) {
  const items = [
    ["Filter", v.inputFilter],
    ["Reviewer", v.outputReview],
    ["Chain", v.policy.enabled],
  ] as const;
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
      {items.map(([k, on]) => (
        <span key={k} className={on ? (k === "Chain" ? "text-hazard" : "text-bone") : "text-dim line-through"}>{k}</span>
      ))}
    </span>
  );
}

const ORDER = ["Penny", "Penny, Bolted", "Ferris", "Otis", "Agnes"];

function Cells({ vaults }: { vaults: VaultView[] | undefined }) {
  const sorted = useMemo(() => {
    const rank = (v: VaultView) => {
      const i = ORDER.indexOf(v.name);
      return i === -1 ? 99 : i;
    };
    return [...(vaults ?? [])].sort((a, b) => rank(a) - rank(b));
  }, [vaults]);

  if (!vaults) {
    return (
      <div className="mt-8 space-y-px">
        {ORDER.map((n) => <div key={n} className="h-24 animate-pulse bg-ink-2" />)}
      </div>
    );
  }
  return (
    <ul className="mt-8">
      {sorted.map((v, i) => (
        <motion.li
          key={v.address}
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
          className="border-t border-line last:border-b"
        >
          <Link
            href={`/cell/${v.address}`}
            className="group grid items-center gap-x-8 gap-y-2 py-6 transition-colors hover:bg-ink-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_auto_auto] md:px-4"
          >
            <span>
              <span className="block font-stencil text-4xl font-black tracking-wide group-hover:text-hazard">{v.name}</span>
              <span className="mt-1 block text-sm text-dim">{v.job}</span>
            </span>
            <Pins v={v} />
            <span className="font-mono text-sm text-dim">{v.stats.attempts} tries</span>
            <span className="flex items-center gap-4 font-mono text-xl">
              {sol(v.pot)} SOL
              <ArrowRight size={20} className="text-hazard transition-transform group-hover:translate-x-1" />
            </span>
          </Link>
        </motion.li>
      ))}
    </ul>
  );
}

function Twins({ vaults }: { vaults: VaultView[] }) {
  const open = vaults.find((v) => v.name === "Penny");
  const bolted = vaults.find((v) => v.name === "Penny, Bolted");
  if (!open || !bolted) return null;
  const col = (v: VaultView, tone: "loss" | "hazard", verdict: string) => (
    <div className={`border-t-4 pt-5 ${tone === "loss" ? "border-loss" : "border-hazard"}`}>
      <h3 className="font-stencil text-3xl font-black tracking-wide">{v.name}</h3>
      <dl className="mt-4 grid grid-cols-2 gap-y-2 font-mono text-sm">
        <dt className="text-dim">Model fooled</dt>
        <dd>{v.stats.blocked + v.stats.breached} times</dd>
        <dt className="text-dim">SOL taken</dt>
        <dd>{sol(v.stats.totalExtracted)}</dd>
        <dt className="text-dim">Chain blocks</dt>
        <dd>{v.stats.blocked}</dd>
      </dl>
      <p className={`mt-4 font-semibold ${tone === "loss" ? "text-loss" : "text-hazard"}`}>{verdict}</p>
    </div>
  );
  return (
    <section className="mx-auto w-full max-w-[1400px] px-4 py-20 md:px-8">
      <h2 className="max-w-[18ch] font-stencil text-5xl font-black leading-none tracking-wide md:text-6xl">
        Same words. Same model. Different ending.
      </h2>
      <p className="mt-4 max-w-[60ch] leading-relaxed text-dim">
        These two share an identical system prompt on-chain. One has a deadbolt. Live counters, read from the program.
      </p>
      <div className="mt-10 grid gap-10 md:grid-cols-2">
        {col(open, "loss", "When the model says yes, the money leaves.")}
        {col(bolted, "hazard", "When the model says yes, the program decides.")}
      </div>
    </section>
  );
}

export function Home() {
  const { state, error } = useArena();
  const feed = (state?.attempts ?? []).filter((a) => a.status === "resolved").slice(0, 3);
  const names = new Map(state?.vaults.map((v) => [v.address, v.name]));
  const total = state?.vaults.reduce((s, v) => s + v.pot, 0);

  return (
    <>
      <section className="mx-auto grid w-full max-w-[1400px] items-center gap-10 px-4 pb-14 pt-10 md:px-8 md:pt-16 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="font-stencil text-6xl font-black leading-[0.95] tracking-wide md:text-7xl"
          >
            The model said yes. <span className="text-hazard">The chain said no.</span>
          </motion.h1>
          <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-dim">
            Talk AI agents out of real Solana devnet vaults. Then meet the lock no prompt can reach.
          </p>
          <Link
            href="#cells"
            className="mt-8 inline-flex items-center gap-2 bg-hazard px-6 py-3 font-semibold text-hazard-ink transition-transform active:translate-y-px"
          >
            Pick a lock <ArrowRight size={18} />
          </Link>
        </div>
        <HeroLock />
      </section>

      <div className="hazard-tape h-3 w-full" aria-hidden />

      <section id="cells" className="mx-auto w-full max-w-[1400px] scroll-mt-16 px-4 py-20 md:px-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
          <h2 className="font-stencil text-5xl font-black tracking-wide md:text-6xl">The cells</h2>
          {total !== undefined && <p className="font-mono text-dim">{sol(total)} SOL in play on devnet</p>}
        </div>
        <p className="mt-3 max-w-[60ch] leading-relaxed text-dim">
          Each attempt is a paid transaction, and each agent holds a real wallet. If you talk one into paying you, the SOL lands with you.
        </p>
        {error && !state && <p className="mt-6 text-loss">{error}</p>}
        <Cells vaults={state?.vaults} />
      </section>

      {state && <Twins vaults={state.vaults} />}

      <section className="bg-ink-2">
        <div className="mx-auto grid w-full max-w-[1400px] gap-12 px-4 py-20 md:px-8 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <h2 className="max-w-[16ch] font-stencil text-5xl font-black leading-none tracking-wide">
              Prompts are not a security boundary.
            </h2>
            <p className="mt-5 max-w-[56ch] leading-relaxed text-dim">
              An agent that reads untrusted text can be talked into anything its key allows. So Deadbolt shrinks what the key allows. The agent holds a key that can only call one instruction, and that instruction enforces a policy the agent cannot edit.
            </p>
            <a href={explorerAddr(PROGRAM_ID)} target="_blank" rel="noreferrer" className="mt-5 inline-block break-all font-mono text-xs text-dim underline hover:text-bone">
              {PROGRAM_ID}
            </a>
          </div>
          <div>
            <h3 className="font-semibold">Latest from the attempt log</h3>
            <ul className="mt-4 space-y-5">
              {feed.length === 0 && <li className="text-dim">No attacks yet. Yours could be the first on the record.</li>}
              {feed.map((a) => (
                <li key={a.address} className="border-l-2 border-line pl-4">
                  <p className="line-clamp-3 text-sm leading-relaxed">{a.prompt}</p>
                  <p className="mt-1 font-mono text-xs text-dim">
                    {names.get(a.vault)}: {a.outcome}
                    {a.technique > 0 && `, ${TECHNIQUES[a.technique].toLowerCase()}`}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="bg-hazard text-hazard-ink">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-6 px-4 py-14 md:px-8">
          <div>
            <h2 className="font-stencil text-5xl font-black tracking-wide">Shipping an agent with a wallet?</h2>
            <p className="mt-2 max-w-[56ch]">Escrow a bounty, set a policy, and let strangers try to rob it before someone worse does.</p>
          </div>
          <Link href="/post" className="inline-flex items-center gap-2 bg-ink px-6 py-3 font-semibold text-bone transition-transform active:translate-y-px">
            Post a bounty <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      <footer className="mx-auto w-full max-w-[1400px] px-4 py-8 text-sm text-dim md:px-8">
        Devnet only. No real funds. Built for the MLH Solana Hackathon.
      </footer>
    </>
  );
}
