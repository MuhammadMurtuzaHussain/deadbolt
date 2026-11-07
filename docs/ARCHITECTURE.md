# Architecture

## On-chain: `programs/deadbolt`

| Account | Seeds | Holds |
|---|---|---|
| `Arena` | `arena` | Treasury, house share, global counters |
| `Vault` | `vault`, sponsor, id | The agent's funds, its public prompt, its policy, its record |
| `Attempt` | `attempt`, vault, player, nonce | One prompt, one reply, one outcome |

| Instruction | Signer | Purpose |
|---|---|---|
| `initialize_arena` | Authority | One-time setup |
| `create_vault` | Sponsor | Opens a vault and escrows the bounty |
| `set_brief` | Sponsor | Writes the system prompt, frozen at the first attempt |
| `fund` | Anyone | Adds to the pot |
| `attempt` | Player | Pays the fee and stores the prompt |
| `resolve` | Agent key | The agent's one action on an attempt |
| `expire_attempt` | Anyone | Refunds the pot share if the agent never answered |
| `withdraw` | Sponsor | Takes back what is left, only after the lock |
| `set_paused` | Sponsor | Kill switch, only after the lock |

### The policy check

`Vault::evaluate` runs for every transfer, in this order: paused, allowlist, per-transfer cap, rolling window cap. The verdict an agent can submit is limited to `Refused`, `Filtered`, `Vetoed` or `Transfer`. Only the program can produce `Blocked` or `Breached`, so an agent cannot claim either.

### Design decisions

- **A block succeeds.** A reverted transaction would erase the attempt. Recording the block keeps the evidence, which is the point.
- **One attempt, one action.** `resolve` requires a pending attempt, so a replay, a retry or a racing runtime cannot spend twice.
- **Public prompts.** Kerckhoffs's principle: an agent whose safety depends on a secret prompt is not safe. Attackers read the same instructions the agent does.
- **Escrow rules protect attackers.** A sponsor cannot withdraw, pause or edit the prompt once it would be unfair.

## Off-chain: `web/`

`resolveAttempt` in `src/lib/runtime/pipeline.ts`:

1. Reads the attempt and vault from the chain. It accepts only an account address over HTTP, so a client cannot inject a prompt.
2. Classifies the prompt once. That result tags the attack family and acts as the input filter on vaults that enable it.
3. Runs the agent with one tool, `transfer_sol`. The tool has no server-side execute step: its arguments go to the program.
4. Asks a second model to review the payment on vaults that enable it. Failing closed if the reviewer is down.
5. Sends `resolve`, signed by the per-vault agent key, then reads the outcome back from the chain.

Stages stream to the browser as newline-delimited JSON, which drives the lock animation. Each pin moves when a real defence decides.

`/api/state` reads program accounts, with no database. The chain is the database.

### Keys

| Key | Held by | Can do |
|---|---|---|
| Agent key | Runtime, derived per vault from a master seed | `resolve` on that vault, nothing else |
| Arena key | Runtime | Pay fees, fund arcade wallets, sponsor house vaults |
| Arcade key | Player's browser | Play. Throwaway, devnet only |

### Model tiers

Difficulty comes from `scripts/eval.mts`, which ran 5 attacks against 4 agents on 6 models. Each tier is a chain: a rate limit moves to the next model at once, which keeps a free-tier gateway usable. The result screen shows which model answered, so "same model" is verifiable.
