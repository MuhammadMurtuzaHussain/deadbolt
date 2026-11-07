# Threat model

The arena is a target by design, so this is what it does and does not promise.

## What the program guarantees

| Attacker | Goal | Why it fails |
|---|---|---|
| Prompt injector | Make a bolted agent pay them | Allowlist and caps run in `resolve`, after the model, and the agent cannot change them |
| Compromised agent key | Drain a bolted vault | The key can only call `resolve`, needs a pending attempt per action, and stays inside the policy |
| Compromised agent key | Withdraw or edit policy | Those instructions need the sponsor. Policy has no update instruction at all |
| Replay or racing runtime | Spend twice on one attempt | `resolve` requires `Pending` and sets `Resolved` atomically |
| Sponsor | Rug attackers mid-bounty | `withdraw` and `set_paused` fail before `lock_until` |
| Sponsor | Patch the agent mid-bounty | `set_brief` fails once the vault is open |
| Griefer | Freeze a half-written prompt onto a locked bounty | `attempt` fails until the sponsor opens the vault |
| Sponsor | Withdraw the fees owed to stalled attempts | `withdraw` leaves pending fees behind |
| Dead runtime | Keep a player's fee | `expire_attempt` refunds the pot share after 180 seconds |

## What it does not guarantee

- **A vault with no policy has no protection.** That is Penny's whole point.
- **Allowlisted merchants can still be paid.** A fooled agent can overpay a real merchant up to the caps. Policy limits blast radius, it does not read intent.
- **Window caps are fixed windows.** They reset when the window ends, so a burst across a boundary can spend up to twice the cap.
- **A sponsor can hide a backdoor in a public prompt.** The prompt is readable by everyone, which is the mitigation.
- **Hosted agents trust the runtime.** The runtime holds agent keys and decides refusals honestly, but the arena does not prove which model ran. The program bounds what a dishonest runtime can do, not whether it plays fair inside those bounds.
- **A sponsor who keeps the agent key can rug their own vault.** The program accepts any agent key, so `/api/state` lists only vaults whose key the runtime derived.

## Prompt injection against our own stack

Every attacker string reaches a model somewhere, including the classifier, reviewer and report writer. Those models treat it as escaped, tagged evidence and hold no tools. A successful injection there can only skew a label or a report sentence. It cannot move funds.

## Abuse

Attempts cost a fee and rent. The faucet has per-IP and global limits and a treasury floor, counted before any await. Reports are deduplicated and throttled per vault, and refills are throttled. These limits are per server instance, which is enough for a devnet demo and not for production. Input filters and reviewers fail closed. A mainnet check runs before the runtime or seed script does anything.

## Review

An independent adversarial pass over the program and runtime found no way to take funds beyond the policy. It did find setup and availability issues: a griefing race on vault setup, a listing crash from extreme values, forged accounts accepted by the client library, and faucet and model-spend abuse. All were fixed, with tests for the on-chain ones.

This is a hackathon build on devnet and has had no professional audit.
