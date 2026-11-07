/**
 * Model chains, per vault tier. A rate limit moves on to the next model in the
 * chain straight away, which keeps a free-tier gateway usable under a demo.
 * Earlier tiers lead with weaker models because they make better early levels.
 */
const list = (env: string | undefined, fallback: string[]) => env?.split(",") ?? fallback;

export const AGENT_CHAINS: Record<number, string[]> = {
  // Measured with scripts/eval.mts: these fell to 4-5 of 5 sample attacks on Penny.
  0: list(process.env.MODEL_TIER_0, ["mistral/mistral-small", "meta/llama-4-scout", "google/gemini-2.5-flash-lite"]),
  // Fell to 2-3 of 5 on Otis's hardened prompt.
  1: list(process.env.MODEL_TIER_1, ["mistral/mistral-small", "meta/llama-4-scout", "google/gemini-2.5-flash-lite"]),
  // Fell to 0 of 4 on Agnes, before her filter and reviewer even run.
  2: list(process.env.MODEL_TIER_2, ["google/gemini-2.5-flash", "openai/gpt-4o-mini", "openai/gpt-5-mini"]),
};

export const ANALYST_CHAIN = list(process.env.MODEL_ANALYST, [
  "amazon/nova-lite",
  "google/gemini-2.5-flash-lite",
  "meta/llama-4-scout",
]);
export const REVIEW_CHAIN = list(process.env.MODEL_REVIEW, ["openai/gpt-4o-mini", "google/gemini-2.5-flash"]);

export const chainForTier = (tier: number) => AGENT_CHAINS[tier] ?? AGENT_CHAINS[0];

/** Runs `call` against each model until one answers. */
export async function firstAvailable<T>(models: string[], call: (model: string) => Promise<T>) {
  let last: unknown;
  for (const model of models) {
    try {
      return { value: await call(model), model };
    } catch (err) {
      last = err;
    }
  }
  throw last;
}
