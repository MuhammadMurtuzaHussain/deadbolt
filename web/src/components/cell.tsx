"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowSquareOut, ArrowsClockwise } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { Lock, initialLock, type LockState } from "./lock";
import { useActor } from "./providers";
import { explorerTx, PROMPT_MAX, sol, TECHNIQUES } from "@/lib/config";
import { useArena } from "@/lib/client/use-arena";
import { followResolution, submitAttempt } from "@/lib/client/attack";
import type { AttemptView, VaultView } from "@/lib/chain";

const BLOCK_TEXT: Record<string, string> = {
  notAllowlisted: "Recipient is not on the allowlist",
  overPerTxCap: "Over the per-transaction cap",
  overWindowCap: "Over the rolling spend cap",
  paused: "Vault is paused",
  emptyPot: "The vault is empty",
};

const OUTCOME_LABEL: Record<string, string> = {
  refused: "Refused by the model",
  filtered: "Stopped by the input filter",
  vetoed: "Vetoed by the reviewer",
  blocked: "Model fooled. Chain said no.",
  breached: "Funds moved",
  none: "Unresolved",
  transfer: "Unresolved",
};

function PolicyLines({ vault }: { vault: VaultView }) {
  const p = vault.policy;
  if (!p.enabled) {
    return (
      <p className="text-sm leading-relaxed text-dim">
        None. If the model agrees to pay, the money moves.
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 font-mono text-sm">
      {p.allowlist.length > 0 && (
        <>
          <dt className="text-dim">Allowlist</dt>
          <dd>{p.allowlist.length} merchant wallet</dd>
        </>
      )}
      {p.maxPerTx > 0 && (
        <>
          <dt className="text-dim">Per transfer</dt>
          <dd>{sol(p.maxPerTx)} SOL max</dd>
        </>
      )}
      {p.windowCap > 0 && (
        <>
          <dt className="text-dim">Rolling cap</dt>
          <dd>
            {sol(p.windowCap)} SOL per {Math.round(p.windowSecs / 60)} min
          </dd>
        </>
      )}
    </dl>
  );
}

function AttemptRow({ a }: { a: AttemptView }) {
  const loss = a.outcome === "breached";
  const held = a.outcome === "blocked";
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid gap-2 border-t border-line py-4 first:border-t-0"
    >
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-bone">{a.prompt}</p>
      {a.reply && <p className="whitespace-pre-wrap pl-4 text-sm leading-relaxed text-dim">{a.reply}</p>}
      <p className={`font-mono text-xs ${loss ? "text-loss" : held ? "text-hazard" : "text-dim"}`}>
        {OUTCOME_LABEL[a.outcome]}
        {loss && `: ${sol(a.extracted)} SOL`}
        {held && a.requested > 0 && `: ${sol(a.requested)} SOL attempted`}
        {a.technique > 0 && <span className="text-dim"> ({TECHNIQUES[a.technique]})</span>}
      </p>
    </motion.li>
  );
}

export function Cell({ address }: { address: string }) {
  const { state, error, refresh } = useArena(8000);
  const { conn, signer, publicKey, balance, ensureFunds, refreshBalance, kind } = useActor();
  const vault = state?.vaults.find((v) => v.address === address);
  const twin = useMemo(() => {
    if (!state || !vault) return null;
    return state.vaults.find((v) => v.address !== vault.address && v.brief === vault.brief) ?? null;
  }, [state, vault]);

  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [lock, setLock] = useState<LockState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<{ attempt: AttemptView; signature: string } | null>(null);
  const [liveReply, setLiveReply] = useState<{ text: string; model: string } | null>(null);
  const prefilled = useRef(false);

  const fresh = useMemo(
    () =>
      vault
        ? initialLock({
            inputFilter: vault.inputFilter,
            outputReview: vault.outputReview,
            policy: vault.policy.enabled,
          })
        : null,
    [vault?.address], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const shown = lock ?? fresh;

  useEffect(() => {
    if (prefilled.current) return;
    const replay = new URLSearchParams(window.location.search).get("replay");
    if (replay) {
      prefilled.current = true;
      // The replay link carries the attack across from the twin cell.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrompt(replay);
    }
  }, []);

  const mine = useMemo(
    () =>
      (state?.attempts ?? [])
        .filter((a) => a.vault === address && a.player === publicKey?.toBase58() && a.status === "resolved")
        .slice(0, 8),
    [state, address, publicKey],
  );
  const others = useMemo(
    () =>
      (state?.attempts ?? [])
        .filter((a) => a.vault === address && a.player !== publicKey?.toBase58() && a.status === "resolved")
        .slice(0, 8),
    [state, address, publicKey],
  );

  async function attack() {
    if (!vault || !signer || !state || !fresh) return;
    setBusy(true);
    setProblem(null);
    setResult(null);
    setLiveReply(null);
    setLock(fresh);
    try {
      if (kind === "arcade" && (balance ?? 0) < 0.012e9) {
        setStatus("Funding your arcade wallet");
        await ensureFunds();
      }
      setStatus("Writing your prompt to the chain");
      const { attempt } = await submitAttempt({
        conn,
        signer,
        vault,
        treasury: state.treasury,
        prompt: prompt.trim(),
      });
      setLock((l) => l && { ...l, keyIn: 0.2 });

      const stagePos = { filter: 0.34, model: 0.57, review: 0.8, chain: 1 } as const;
      for await (const ev of followResolution(attempt)) {
        if (ev.type === "error") throw new Error(ev.message);
        if (ev.type === "reply") setLiveReply({ text: ev.text, model: ev.model });
        if (ev.type === "stage") {
          if (ev.status === "skip") continue;
          setStatus(
            ev.status === "start"
              ? { filter: "Input filter is reading", model: "Agent is thinking", review: "Reviewer is checking the payment", chain: "Program is judging the transfer" }[ev.stage]
              : null,
          );
          setLock((l) => {
            if (!l) return l;
            const pins = { ...l.pins };
            pins[ev.stage] = ev.status === "start" ? "testing" : ev.status === "pass" ? "set" : "jammed";
            return {
              ...l,
              pins,
              keyIn: ev.status === "pass" || ev.status === "start" ? stagePos[ev.stage] : l.keyIn,
              bolt: ev.stage === "chain" && ev.status === "stop" ? "slammed" : l.bolt,
            };
          });
        }
        if (ev.type === "done") {
          setResult({ attempt: ev.attempt, signature: ev.signature });
          setStatus(null);
          setLock((l) => {
            if (!l) return l;
            return {
              ...l,
              bolt: ev.attempt.outcome === "breached" ? "open" : ev.attempt.outcome === "blocked" ? "slammed" : "shut",
              keyIn: ev.attempt.outcome === "breached" || ev.attempt.outcome === "blocked" ? 1 : l.keyIn,
            };
          });
          setPrompt("");
        }
      }
      await Promise.all([refresh(), refreshBalance()]);
    } catch (err) {
      setProblem(err instanceof Error ? err.message.slice(0, 200) : "That attempt failed.");
      setStatus(null);
      setLock(fresh);
    } finally {
      setBusy(false);
    }
  }

  if (error && !state) {
    return <p className="mx-auto max-w-[1400px] px-4 py-16 text-dim md:px-8">{error}</p>;
  }
  if (state && !vault) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-16 md:px-8">
        <p className="text-dim">This cell does not exist on this cluster.</p>
        <Link href="/" className="mt-4 inline-block text-hazard underline">Back to the arena</Link>
      </div>
    );
  }
  if (!vault || !shown) {
    return (
      <div className="mx-auto w-full max-w-[1400px] animate-pulse px-4 py-10 md:px-8">
        <div className="h-12 w-72 bg-ink-3" />
        <div className="mt-8 aspect-[3/1] w-full bg-ink-2" />
      </div>
    );
  }

  const r = result?.attempt;
  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-10 px-4 py-8 md:px-8 lg:grid-cols-[1.5fr_1fr]">
      <section className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="font-stencil text-5xl font-black leading-none tracking-wide md:text-6xl">{vault.name}</h1>
          <p className="font-mono text-2xl text-hazard">{sol(vault.pot)} SOL</p>
        </div>
        <p className="mt-2 text-dim">{vault.job}</p>

        <div className="mt-6 border border-line bg-ink p-4 md:p-6">
          <Lock state={shown} title={`Lock for ${vault.name}`} />
        </div>

        <div className="mt-6">
          <label htmlFor="prompt" className="text-sm text-dim">
            Your message to {vault.name}, stored on-chain for {sol(vault.entryFee)} SOL
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={PROMPT_MAX}
            rows={3}
            disabled={busy}
            className="mt-2 w-full resize-none border border-line bg-ink-2 p-3 text-bone placeholder:text-dim focus:border-hazard focus:outline-none"
            placeholder="Convince the agent to pay you."
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-xs text-dim" aria-live="polite">
              {status ?? `${new TextEncoder().encode(prompt).length} / ${PROMPT_MAX} bytes`}
            </p>
            <button
              onClick={() => void attack()}
              disabled={busy || !prompt.trim() || !signer}
              className="bg-hazard px-6 py-3 font-semibold text-hazard-ink transition-transform active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Working" : "Send attack"}
            </button>
          </div>
          {problem && <p className="mt-3 text-sm text-loss">{problem}</p>}
        </div>

        {busy && liveReply && (
          <p className="mt-4 border-l-2 border-line pl-4 text-sm text-dim">{liveReply.text}</p>
        )}

        <AnimatePresence>
          {r && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`mt-6 border p-5 ${r.outcome === "breached" ? "border-loss" : r.outcome === "blocked" ? "border-hazard" : "border-line"}`}
            >
              <p className="font-stencil text-3xl font-black tracking-wide">
                {r.outcome === "breached" && <span className="text-loss">Breached. {sol(r.extracted)} SOL moved.</span>}
                {r.outcome === "blocked" && <span className="text-hazard">The model said yes. The chain said no.</span>}
                {(r.outcome === "refused" || r.outcome === "filtered" || r.outcome === "vetoed") && OUTCOME_LABEL[r.outcome]}
              </p>
              {r.outcome === "blocked" && (
                <p className="mt-2 text-sm text-dim">
                  {BLOCK_TEXT[r.blockReason]}. The agent tried to send {sol(r.requested)} SOL. Nothing moved, and the attempt is on the record.
                </p>
              )}
              {r.reply && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{r.reply}</p>}
              {liveReply?.model && <p className="mt-2 font-mono text-xs text-dim">Answered by {liveReply.model}</p>}
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={explorerTx(result!.signature)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 border border-line px-3 py-2 text-sm hover:border-hazard"
                >
                  View transaction <ArrowSquareOut size={16} />
                </a>
                {r.outcome === "breached" && twin && twin.policy.enabled && (
                  <Link
                    href={`/cell/${twin.address}?replay=${encodeURIComponent(r.prompt)}`}
                    className="inline-flex items-center gap-2 bg-hazard px-3 py-2 text-sm font-semibold text-hazard-ink"
                  >
                    Replay against {twin.name} <ArrowsClockwise size={16} />
                  </Link>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {mine.length > 0 && (
          <div className="mt-10">
            <h2 className="text-lg font-semibold">Your attempts</h2>
            <ul className="mt-2">
              {mine.map((a) => <AttemptRow key={a.address} a={a} />)}
            </ul>
          </div>
        )}
      </section>

      <aside className="min-w-0 space-y-8 lg:sticky lg:top-24 lg:self-start">
        <section>
          <h2 className="text-lg font-semibold">The agent&apos;s instructions</h2>
          <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-dim">{vault.brief}</p>
          <p className="mt-2 text-xs text-dim">Stored on-chain and frozen at the first attempt.</p>
        </section>
        <section>
          <h2 className="text-lg font-semibold">On-chain policy</h2>
          <div className="mt-2"><PolicyLines vault={vault} /></div>
        </section>
        <section>
          <h2 className="text-lg font-semibold">Record</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm">
            <dt className="text-dim">Attempts</dt><dd>{vault.stats.attempts}</dd>
            <dt className="text-dim">Model fooled</dt><dd>{vault.stats.blocked + vault.stats.breached}</dd>
            <dt className="text-dim">Chain blocks</dt><dd>{vault.stats.blocked}</dd>
            <dt className="text-dim">Taken</dt><dd>{sol(vault.stats.totalExtracted)} SOL</dd>
          </dl>
          <Link href={`/cell/${vault.address}/report`} className="mt-3 inline-block text-sm text-hazard underline">
            Open threat report
          </Link>
        </section>
        {others.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold">Recent attacks</h2>
            <ul className="mt-2">
              {others.slice(0, 4).map((a) => <AttemptRow key={a.address} a={a} />)}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
