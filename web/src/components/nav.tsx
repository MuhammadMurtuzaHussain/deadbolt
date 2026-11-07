"use client";

import Link from "next/link";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useActor } from "./providers";
import { sol } from "@/lib/config";

export function Nav() {
  const { publicKey, kind, balance } = useActor();
  const { wallets, select, connect, disconnect, connected } = useWallet();
  const [open, setOpen] = useState(false);
  const short = publicKey ? `${publicKey.toBase58().slice(0, 4)}..${publicKey.toBase58().slice(-4)}` : "";

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ink/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center justify-between gap-4 px-4 md:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="font-stencil text-2xl font-black tracking-wide text-hazard">
            DEADBOLT
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-dim md:flex">
            <Link className="hover:text-bone" href="/#cells">Cells</Link>
            <Link className="hover:text-bone" href="/board">Board</Link>
            <Link className="hover:text-bone" href="/post">Post a bounty</Link>
          </nav>
        </div>
        <div className="relative flex items-center gap-3 font-mono text-xs">
          <span className="hidden text-dim sm:inline">devnet</span>
          {publicKey && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="border border-line px-3 py-2 text-bone transition-colors hover:border-hazard"
            >
              {balance === null ? short : `${sol(balance, 3)} SOL`}
              <span className="ml-2 text-dim">{kind === "arcade" ? "arcade" : short}</span>
            </button>
          )}
          {open && (
            <div className="absolute right-0 top-12 w-72 border border-line bg-ink-2 p-4 text-sm">
              <p className="font-sans text-dim">
                {kind === "arcade"
                  ? "Your arcade wallet is a throwaway devnet key stored in this browser. Connect your own to keep winnings there."
                  : `Connected ${short}. Devnet only, no real funds.`}
              </p>
              <div className="mt-3 flex flex-col gap-2 font-sans">
                {connected ? (
                  <button className="border border-line px-3 py-2 hover:border-hazard" onClick={() => void disconnect()}>
                    Use arcade wallet
                  </button>
                ) : wallets.length === 0 ? (
                  <p className="text-xs text-dim">No wallet extension found in this browser.</p>
                ) : (
                  wallets.map((w) => (
                    <button
                      key={w.adapter.name}
                      className="border border-line px-3 py-2 text-left hover:border-hazard"
                      onClick={async () => {
                        select(w.adapter.name);
                        setOpen(false);
                        await connect().catch(() => undefined);
                      }}
                    >
                      Connect {w.adapter.name}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
