"use client";

import { useCallback, useEffect, useState } from "react";
import type { AttemptView, VaultView } from "@/lib/chain";

export interface ArenaState {
  vaults: VaultView[];
  attempts: AttemptView[];
  treasury: string;
  arenaAuthority: string;
}

/** Polls the chain snapshot. Pauses while the tab is hidden. */
export function useArena(intervalMs = 6000) {
  const [state, setState] = useState<ArenaState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not read the chain");
      setState(body);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the chain");
    }
  }, []);

  useEffect(() => {
    // First load, then a timer for live pots and the attack feed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const t = setInterval(() => {
      if (!document.hidden) void refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);

  return { state, error, refresh };
}
