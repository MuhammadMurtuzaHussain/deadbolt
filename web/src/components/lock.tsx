"use client";

import { motion, useReducedMotion } from "motion/react";

export type PinKey = "filter" | "model" | "review" | "chain";
export type PinState = "absent" | "idle" | "testing" | "set" | "jammed";
export type BoltState = "shut" | "open" | "slammed";

export interface LockState {
  pins: Record<PinKey, PinState>;
  keyIn: number;
  bolt: BoltState;
}

export const PIN_LABELS: Record<PinKey, string> = {
  filter: "Input filter",
  model: "Model",
  review: "Reviewer",
  chain: "On-chain policy",
};

const ORDER: PinKey[] = ["filter", "model", "review", "chain"];
const PIN_X = [176, 276, 376, 476];
const SHEAR = 104;
const spring = { type: "spring", stiffness: 260, damping: 18 } as const;

function Pin({ x, state, chain }: { x: number; state: PinState; chain: boolean }) {
  const reduce = useReducedMotion();
  const lift = state === "set" ? -22 : state === "testing" ? -12 : 0;
  const color =
    state === "set" ? "var(--hazard)" : state === "jammed" ? "var(--bone)" : "var(--dim)";
  if (state === "absent") {
    return (
      <g opacity={0.5}>
        <rect x={x - 15} y={34} width={30} height={92} fill="var(--ink)" stroke="var(--line)" strokeDasharray="4 4" />
        <line x1={x - 9} y1={72} x2={x + 9} y2={90} stroke="var(--line)" strokeWidth={2} />
        <line x1={x + 9} y1={72} x2={x - 9} y2={90} stroke="var(--line)" strokeWidth={2} />
      </g>
    );
  }
  return (
    <g>
      <rect x={x - 15} y={34} width={30} height={92} fill="var(--ink)" stroke="var(--line)" />
      <motion.g
        animate={{ y: lift }}
        transition={
          state === "testing" && !reduce
            ? { y: { repeat: Infinity, repeatType: "mirror", duration: 0.22 } }
            : spring
        }
      >
        {/* driver pin, pushed down by the spring */}
        <rect x={x - 11} y={58} width={22} height={SHEAR - 58} fill="var(--ink-3)" stroke="var(--line)" />
        {/* key pin, the part the key has to lift */}
        <path
          d={`M${x - 11} ${SHEAR + 2} h22 v14 l-11 10 l-11 -10 z`}
          fill={color}
          stroke={chain && state === "idle" ? "var(--hazard)" : "none"}
        />
      </motion.g>
    </g>
  );
}

/** A pin-tumbler cross-section. Each defence is a pin; the last one is on-chain. */
export function Lock({ state, title }: { state: LockState; title?: string }) {
  const boltX = state.bolt === "open" ? -86 : 0;
  const present = ORDER.filter((k) => state.pins[k] !== "absent").length;
  return (
    <figure className="w-full">
      <svg
        viewBox="0 0 720 230"
        className="h-auto w-full"
        role="img"
        aria-label={title ?? `Lock with ${present} active defences`}
      >
        {/* housing */}
        <rect x={110} y={20} width={430} height={190} fill="var(--ink-2)" stroke="var(--line)" strokeWidth={2} />
        {/* plug and keyway */}
        <rect x={110} y={SHEAR} width={430} height={78} fill="var(--ink-3)" />
        <line x1={110} y1={SHEAR} x2={540} y2={SHEAR} stroke="var(--line)" strokeDasharray="2 5" />
        <rect x={110} y={150} width={420} height={18} fill="var(--ink)" />

        {ORDER.map((k, i) => (
          <Pin key={k} x={PIN_X[i]} state={state.pins[k]} chain={k === "chain"} />
        ))}

        {/* key: real progress, driven by the attempt's stages */}
        <motion.g
          initial={false}
          animate={{ x: state.keyIn * 430 - 430 }}
          transition={{ type: "spring", stiffness: 90, damping: 16 }}
        >
          <path
            d="M-30 128 h22 v-30 h20 v30 h10 l0 0 h392 l14 -14 v30 l-14 12 h-432 z"
            fill="none"
          />
          <path
            d="M0 153 h440 l16 7 l-16 7 h-440 z"
            fill="var(--hazard)"
          />
          {[176, 276, 376].map((x) => (
            <path key={x} d={`M${x - 14} 153 l14 -11 l14 11 z`} fill="var(--hazard)" />
          ))}
        </motion.g>

        {/* bolt */}
        <motion.g
          initial={false}
          animate={{ x: boltX, scale: state.bolt === "slammed" ? [1, 1.03, 1] : 1 }}
          style={{ transformOrigin: "630px 115px" }}
          transition={spring}
        >
          <rect
            x={540}
            y={72}
            width={170}
            height={86}
            fill={state.bolt === "open" ? "var(--loss)" : state.bolt === "slammed" ? "var(--hazard)" : "var(--bone)"}
          />
        </motion.g>
        <rect x={676} y={40} width={36} height={150} fill="var(--ink-2)" stroke="var(--line)" strokeWidth={2} />
      </svg>
      <figcaption className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-dim sm:grid-cols-4">
        {ORDER.map((k) => (
          <span key={k} className={state.pins[k] === "absent" ? "line-through opacity-60" : "text-bone"}>
            {PIN_LABELS[k]}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export const initialLock = (d: { inputFilter: boolean; outputReview: boolean; policy: boolean }): LockState => ({
  pins: {
    filter: d.inputFilter ? "idle" : "absent",
    model: "idle",
    review: d.outputReview ? "idle" : "absent",
    chain: d.policy ? "idle" : "absent",
  },
  keyIn: 0.08,
  bolt: "shut",
});
