"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ConnectionProvider, WalletProvider, useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { Connection, PublicKey } from "@solana/web3.js";
import { keypairSigner, type TxSigner } from "@/lib/chain";
import { RPC_URL } from "@/lib/config";
import { loadArcadeKeypair } from "@/lib/client/arcade";

interface Actor {
  conn: Connection;
  signer: TxSigner | null;
  publicKey: PublicKey | null;
  kind: "arcade" | "wallet";
  balance: number | null;
  refreshBalance: () => Promise<void>;
  /** Tops up an arcade wallet from the arena treasury. */
  ensureFunds: () => Promise<void>;
}

const ActorContext = createContext<Actor | null>(null);
export const useActor = () => {
  const ctx = useContext(ActorContext);
  if (!ctx) throw new Error("useActor needs Providers");
  return ctx;
};

function ActorProvider({ children }: { children: React.ReactNode }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [arcade, setArcade] = useState<TxSigner | null>(null);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    // localStorage only exists once mounted in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArcade(keypairSigner(loadArcadeKeypair()));
  }, []);

  const signer = useMemo<TxSigner | null>(() => {
    if (wallet.connected && wallet.publicKey && wallet.signTransaction && wallet.signAllTransactions) {
      return {
        publicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction,
        signAllTransactions: wallet.signAllTransactions,
      };
    }
    return arcade;
  }, [wallet.connected, wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions, arcade]);

  const publicKey = signer?.publicKey ?? null;
  const kind = wallet.connected ? "wallet" : "arcade";

  const refreshBalance = useCallback(async () => {
    if (publicKey) setBalance(await connection.getBalance(publicKey).catch(() => null));
  }, [connection, publicKey]);

  useEffect(() => {
    // Reads the wallet's balance from the chain when the active wallet changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshBalance();
    const t = setInterval(() => {
      if (!document.hidden) void refreshBalance();
    }, 8000);
    return () => clearInterval(t);
  }, [refreshBalance]);

  const ensureFunds = useCallback(async () => {
    if (!publicKey) throw new Error("No wallet ready yet");
    const res = await fetch("/api/faucet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: publicKey.toBase58() }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "The faucet failed");
    await refreshBalance();
  }, [publicKey, refreshBalance]);

  const value = useMemo(
    () => ({ conn: connection, signer, publicKey, kind, balance, refreshBalance, ensureFunds }) as Actor,
    [connection, signer, publicKey, kind, balance, refreshBalance, ensureFunds],
  );
  return <ActorContext.Provider value={value}>{children}</ActorContext.Provider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={[]} autoConnect>
        <ActorProvider>{children}</ActorProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
