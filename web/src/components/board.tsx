"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useArena } from "@/lib/client/use-arena";
import { useActor } from "./providers";
import { sol, TECHNIQUES } from "@/lib/config";

interface Row {
  player: string;
  extracted: number;
  fooled: number;
  attempts: number;
}

export function Board() {
  const { state, error } = useArena(8000);
  const { publicKey } = useActor();

  const rows = useMemo(() => {
    const m = new Map<string, Row>();
    for (const a of state?.attempts ?? []) {
      if (a.status !== "resolved") continue;
      const r = m.get(a.player) ?? { player: a.player, extracted: 0, fooled: 0, attempts: 0 };
      r.attempts += 1;
      r.extracted += a.extracted;
      if (a.outcome === "blocked" || a.outcome === "breached") r.fooled += 1;
      m.set(a.player, r);
    }
    return [...m.values()].sort((a, b) => b.extracted - a.extracted || b.fooled - a.fooled);
  }, [state]);

  const recent = (state?.attempts ?? []).filter((a) => a.outcome === "breached" || a.outcome === "blocked").slice(0, 6);
  const names = new Map(state?.vaults.map((v) => [v.address, v.name]));

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-12 px-4 py-10 md:px-8 lg:grid-cols-[1.3fr_1fr]">
      <section>
        <h1 className="font-stencil text-5xl font-black tracking-wide">Board</h1>
        <p className="mt-2 max-w-[65ch] text-dim">
          Ranked by SOL taken, then by how many times a player fooled a model. Read straight from the chain.
        </p>
        {error && !state && <p className="mt-6 text-loss">{error}</p>}
        {!state && !error && <div className="mt-6 h-48 animate-pulse bg-ink-2" />}
        {state && rows.length === 0 && (
          <p className="mt-6 text-dim">
            Nobody is on the board yet. <Link className="text-hazard underline" href="/#cells">Pick a lock</Link>.
          </p>
        )}
        {rows.length > 0 && (
          <table className="mt-6 w-full text-left text-sm">
            <thead className="text-dim">
              <tr>
                <th className="py-2 font-normal">Player</th>
                <th className="py-2 text-right font-normal">Taken</th>
                <th className="py-2 text-right font-normal">Fooled</th>
                <th className="py-2 text-right font-normal">Tries</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rows.slice(0, 20).map((r, i) => (
                <tr key={r.player} className={`border-t border-line ${r.player === publicKey?.toBase58() ? "text-hazard" : ""}`}>
                  <td className="py-3">{i + 1}. {r.player.slice(0, 4)}..{r.player.slice(-4)}</td>
                  <td className="py-3 text-right">{sol(r.extracted)} SOL</td>
                  <td className="py-3 text-right">{r.fooled}</td>
                  <td className="py-3 text-right">{r.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h2 className="text-xl font-semibold">Attacks that worked on a model</h2>
        <ul className="mt-4 space-y-5">
          {recent.map((a) => (
            <li key={a.address} className="border-l-2 border-line pl-4">
              <p className="text-sm leading-relaxed">{a.prompt}</p>
              <p className={`mt-1 font-mono text-xs ${a.outcome === "breached" ? "text-loss" : "text-hazard"}`}>
                {names.get(a.vault)}: {a.outcome === "breached" ? `${sol(a.extracted)} SOL taken` : "stopped by the chain"}
                <span className="text-dim"> ({TECHNIQUES[a.technique]})</span>
              </p>
            </li>
          ))}
          {state && recent.length === 0 && <li className="text-dim">Nothing yet.</li>}
        </ul>
      </section>
    </div>
  );
}
