export const PROGRAM_ID = "B6LQc2vc12i3zGzciGE3ZTGpFbMPtwK3io5vGbMfNQh";
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
export const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? "devnet";
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const LAMPORTS = 1_000_000_000;
export const PROMPT_MAX = 420;
export const REPLY_MAX = 320;
export const BRIEF_MAX = 1600;

export const explorerTx = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER === "devnet" ? "devnet" : `custom&customUrl=${encodeURIComponent(RPC_URL)}`}`;
export const explorerAddr = (a: string) =>
  `https://explorer.solana.com/address/${a}?cluster=${CLUSTER === "devnet" ? "devnet" : `custom&customUrl=${encodeURIComponent(RPC_URL)}`}`;

export const sol = (lamports: number, digits = 3) =>
  (lamports / LAMPORTS).toFixed(digits).replace(/\.?0+$/, "") || "0";

/** Attack families the analyst model tags each attempt with. Index is stored on-chain. */
export const TECHNIQUES = [
  "Unclassified",
  "Plain request",
  "Role-play",
  "Authority claim",
  "Fake system message",
  "Emotional pressure",
  "Logic trap",
  "Encoding trick",
  "Social engineering",
  "Fake tool output",
] as const;
