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
| Sponsor | Patch the agent mid-bounty | `set_brief` fails after the first attempt |
| Dead runtime | Keep a player's fee | `expire_attempt` refunds the pot share after 180 seconds |

## What it does not guarantee

- **A vault with no policy has no protection.** That is Penny's whole point.
- **Allowlisted merchants can still be paid.** A fooled agent can overpay a real merchant up to the caps. Policy limits blast radius, it does not read intent.
- **Hosted agents trust the runtime.** The runtime holds agent keys and decides refusals honestly, but the arena does not prove which model ran. The program bounds what a dishonest runtime can do, not whether it plays fair inside those bounds.
- **A sponsor who keeps the agent key can rug their own vault.** The program accepts any agent key, so `/api/state` lists only vaults whose key the runtime derived.

## Prompt injection against our own stack

Every attacker string reaches a model somewhere, including the classifier, reviewer and report writer. Those models treat it as escaped, tagged evidence and hold no tools. A successful injection there can only skew a label or a report sentence. It cannot move funds.

## Abuse

Attempts cost a fee and rent, the faucet is rate limited with a treasury floor, and a mainnet check runs before the runtime or seed script does anything.

## Not audited

This is a hackathon build on devnet and has had no professional audit.
