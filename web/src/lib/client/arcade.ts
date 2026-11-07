import { Keypair } from "@solana/web3.js";

const KEY = "deadbolt.arcade.v1";

/** A throwaway devnet key kept in this browser, so playing needs no wallet install. */
export function loadArcadeKeypair(): Keypair {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    const kp = Keypair.generate();
    localStorage.setItem(KEY, JSON.stringify(Array.from(kp.secretKey)));
    return kp;
  } catch {
    return Keypair.generate();
  }
}
