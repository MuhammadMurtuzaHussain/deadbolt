"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useArena } from "@/lib/client/use-arena";
import { sol, TECHNIQUES } from "@/lib/config";
import type { ThreatSummary } from "@/lib/runtime/brain";

export function Report({ address }: { address: string }) {
  const { state } = useArena(10000);
  const vault = state?.vaults.find((v) => v.address === address);
  const attempts = useMemo(
    () => (state?.attempts ?? []).filter((a) => a.vault === address && a.status === "resolved"),
    [state, address],
  );
  const [report, setReport] = useState<ThreatSummary | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const families = useMemo(() => {
    const m = new Map<number, { total: number; fooled: number }>();
    for (const a of attempts) {
      const row = m.get(a.technique) ?? { total: 0, fooled: 0 };
      row.total += 1;
      if (a.outcome === "blocked" || a.outcome === "breached") row.fooled += 1;
      m.set(a.technique, row);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [attempts]);

  const stopped = attempts
    .filter((a) => a.outcome === "blocked")
    .reduce((sum, a) => sum + a.requested, 0);

  useEffect(() => {
    if (attempts.length === 0 || report || loading) return;
    let live = true;
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/report?vault=${address}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        if (live) setReport(body.report);
      } catch (err) {
        if (live) setProblem(err instanceof Error ? err.message : "The report failed.");
      } finally {
        if (live) setLoading(false);
      }
    };
    void run();
    return () => {
      live = false;
    };
    // Only needs to fire once attempts have loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts.length > 0, address]);

  if (!vault) {
    return <div className="mx-auto h-64 w-full max-w-[1000px] animate-pulse bg-ink-2 md:mt-10" />;
  }

  const max = Math.max(1, ...families.map(([, r]) => r.total));
  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-10 md:px-8">
      <Link href={`/cell/${address}`} className="text-sm text-dim hover:text-bone">Back to {vault.name}</Link>
      <h1 className="mt-3 font-stencil text-5xl font-black tracking-wide">Threat report: {vault.name}</h1>
      <p className="mt-2 max-w-[65ch] text-dim">
        Built from the on-chain attempt log, so nothing here can be edited after the fact.
      </p>

      <dl className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-4">
        {[
          ["Attempts", vault.stats.attempts],
          ["Model fooled", vault.stats.blocked + vault.stats.breached],
          ["SOL lost", sol(vault.stats.totalExtracted)],
          ["SOL stopped by chain", sol(stopped)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-sm text-dim">{k}</dt>
            <dd className="mt-1 font-mono text-3xl">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-12">
        <h2 className="text-xl font-semibold">How it was attacked</h2>
        {families.length === 0 ? (
          <p className="mt-3 text-dim">No attacks yet. Send the first one from the cell.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {families.map(([id, r]) => (
              <li key={id} className="grid grid-cols-[10rem_1fr_auto] items-center gap-4 text-sm">
                <span>{TECHNIQUES[id]}</span>
                <span className="h-2 bg-hazard" style={{ width: `${(r.total / max) * 100}%` }} />
                <span className="font-mono text-dim">{r.fooled} of {r.total} fooled it</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold">What the analyst recommends</h2>
        {loading && <div className="mt-4 h-24 animate-pulse bg-ink-2" />}
        {problem && <p className="mt-3 text-loss">{problem}</p>}
        {report && (
          <>
            <p className="mt-3 max-w-[65ch] leading-relaxed">{report.summary}</p>
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              {report.recommendations.map((r) => (
                <div key={r.title} className="border-t-2 border-hazard pt-3">
                  <h3 className="font-semibold">{r.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-dim">{r.detail}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
