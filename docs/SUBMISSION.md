# Submission package

## Deadlines (MLH event schedule)

- **Initial submission: Sunday 8 Nov, 10:00 AM ET = 15:00 GMT**
- **Final submission, hacking ends: Sunday 8 Nov, 11:45 AM ET = 16:45 GMT**
- Closing ceremony: Sunday 12:00 PM ET = 17:00 GMT

The event header says 1:00 PM ET. Work to the schedule above.

## Fields

**Name:** Deadbolt

**One-line pitch (under 140 characters):**
Talk AI agents out of real Solana vaults, then meet the on-chain lock no prompt can reach. The model said yes. The chain said no.

**Prize categories:** Top 3 Overall, AI Track, DeFi Track, Gaming Track.
Not Best Beginner Hack: it requires a team of more than 50% first-time hackers.

**Built with:** solana, anchor, rust, typescript, next.js, react, tailwindcss, vercel, ai-sdk, gemini, mistral, llama, openai

**AI tools:** claude-code, coding:anthropic/claude-opus-5.5

## Project description

### Inspiration
AI agents are getting wallets, and I work in cybersecurity. I won the Lakera Agent Breaker prompt injection CTF at Dublin AI Week, and the lesson from every jailbreak is the same: you can't patch persuasion. If an agent reads untrusted text, it can be talked into anything its key allows. Filters and reviewer models are made of the same stuff as the thing they protect. So I wanted to build the lock that doesn't listen.

### What it does
Deadbolt is an on-chain spend policy for AI agents, proven in public by a red-team arena.

Players pay a fraction of a cent to send a prompt to an AI agent that guards a real devnet vault. If they talk it into paying, the SOL lands in their wallet. There are five agents, from a gullible refund bot to a treasurer behind an input filter and a second reviewer model.

The signature moment is the replay. Breach Penny, then send the same words to the same model with an identical prompt, behind a deadbolt. The model says yes again. The program refuses, writes down why, and not one lamport moves.

Teams can put their own agent in a cell: set a prompt, AI defences and an on-chain policy, and escrow a bounty. The bounty is locked, the prompt freezes at the first attempt, and they get an attack log nobody can edit plus an AI threat report recommending specific policy changes.

### How I built it
- **Anchor program (Rust).** Agent keys can only move funds through one instruction, `resolve`, which checks an allowlist, a per-transfer cap and an hourly cap the agent cannot edit. One paid attempt buys one action. A block is recorded as a successful transaction, because a failed one would roll back the evidence.
- **Everything is on-chain.** Prompts, replies, outcomes and system prompts live in program accounts. There is no database.
- **Agent runtime (Next.js, AI SDK).** It reads each prompt from the chain, never from the request, and passes the model's decision to the program unchanged.
- **A measured game.** I ran a matrix of real attacks against six models and tuned each level from the results.
- **A pin-tumbler lock UI.** Each defence is a pin, driven live by the runtime as it decides. The last pin is on-chain.

### Challenges
Devnet's RPC faucet is closed, so scripted funding was out. I built and tested everything against a local validator first. The AI gateway's free tier allows five requests a minute per model, so each tier became a fallback chain across providers. The hardest design call was making policy blocks succeed instead of fail, since a reverted transaction erases the very evidence you want to keep.

### What I learned
Solana was new ground for me this weekend (edit this if it is not true for you). The account model made the security story simpler than I expected: an agent key that can only sign one instruction is a much stronger guarantee than any prompt. I also learned how unevenly models fail. The same attack that drains one model barely moves another, which is exactly why the guarantee can't live at the model layer.

### What's next
SPL token and CPI support so any Solana agent can spend through a Deadbolt vault, bring-your-own-agent endpoints, and a public survival score other protocols can read before trusting an agent with funds.

### AI disclosure
At runtime the agents, input filter, payment reviewer, attack classifier and threat report run on models via Vercel AI Gateway (Mistral, Meta Llama, Google Gemini, OpenAI, Amazon Nova). While building, I used Claude Code (Claude Opus 5.5) as a coding assistant for the program, runtime, interface, tests and docs. Product direction and final review were mine.

## Answers per prize category

**Top 3 Overall**
Deadbolt uses Solana for what it is good at: every prompt is a paid transaction that settles in about a second for a fraction of a cent, which is what makes pay-per-prompt playable. The program holds funds and enforces a policy that neither the model, the runtime nor the sponsor can bypass, and it works end to end on devnet today.

**AI Track**
Agents act through a real tool call on a real wallet. Around them sit an input filter, a second reviewer model, an attack classifier and an AI threat report. The project's thesis is about AI: it measures how models fail against prompt injection, and it proves the fix belongs outside the model.

**DeFi Track**
Deadbolt is a programmable vault: on-chain allowlists, per-transfer caps and hourly spend limits, plus escrowed bounties, fee splitting between pot and house, and refund guarantees. It is the spend-control primitive that agent-run treasuries need.

**Gaming Track**
A pay-per-prompt arena with five escalating cells, real prize pots that grow with every attempt, real winnings, a leaderboard and a lock you pick one pin at a time. Every move is a transaction, and players truly own what they win.

## Demo video

https://youtu.be/aV9WSJLyHxY (1:28, unlisted on YouTube). Narration is an AI voice (Microsoft neural TTS, via edge-tts); all footage is real screen recording of the live devnet site. The YouTube description carries the same AI disclosure.

## Demo video script (original plan, under 2 minutes)

The rules require naming the hackathon at the start. Keep it a demo, not a pitch.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00 | Landing page, lock animating | "Hey, I'm Murtuza, and this is Deadbolt, my demo for the MLH Solana Hackathon." |
| 0:06 | Scroll to the cells | "AI agents are getting wallets. So I gave five of them real devnet vaults, and you pay a fraction of a cent to try and rob them." |
| 0:15 | Open Penny. Show her instructions | "This is Penny, a refund bot. Her instructions are public, stored on-chain. No defences." |
| 0:23 | Type the attack, press Send | "My message and my fee go on-chain as a transaction. The agent reads it from there." |
| 0:31 | Lock animates, bolt opens red, "Breached" | "She fell for it. That's a real transfer, and it landed in my wallet." |
| 0:38 | Click View transaction, flash Explorer | "Here it is on Solana." |
| 0:43 | Press "Replay against Penny, Bolted" | "Now the same attack, word for word. Same prompt. Same model. One difference: this vault has a deadbolt." |
| 0:53 | Send. Pins set, chain pin jams, bolt slams | "The model says yes again, it's completely fooled. But the program checks its policy." |
| 1:01 | "The model said yes. The chain said no." | "Recipient not on the allowlist. Nothing moved, and the attempt stays on the record." |
| 1:10 | Show the code in `resolve` briefly | "The agent's key can only call one instruction, and that instruction enforces rules the agent can't edit. You can't talk your way past a program." |
| 1:22 | Agnes cell | "Even my best AI-only stack, a filter plus a reviewer model, is still just more AI. That's why the last pin is on-chain." |
| 1:32 | Post a bounty form | "Teams can put their own agent in a cell, escrow a bounty, and let strangers try to rob it before someone worse does." |
| 1:42 | Threat report page | "They get an attack log nobody can edit, and an AI report on what to lock down." |
| 1:50 | Landing, lock slamming | "Deadbolt. The model said yes. The chain said no." |

## Screenshots

Real captures of the live devnet site, in `docs/screenshots/`. Each is under 2 MB.

1. `01-landing.jpg`: landing hero
2. `02-cells.jpg`: the cells list
3. `03-penny-breached.jpg`: Penny breached
4. `04-bolted-blocked.jpg`: Penny, Bolted: "The model said yes. The chain said no."
5. `05-threat-report.jpg`: threat report
6. `06-board.jpg`: leaderboard
7. `07-post-bounty.jpg`: post a bounty
8. `08-mobile.jpg`: mobile

## On-chain evidence (devnet)

- Program: https://explorer.solana.com/address/B6LQc2vc12i3zGzciGE3ZTGpFbMPtwK3io5vGbMfNQh?cluster=devnet
- Penny breached, mistral/mistral-small: https://explorer.solana.com/tx/K9AzVVpuu3Qr38mfqMCPhDbUGeVTsLg1hKFKV6ZB97f8z1kdgov1t9JYmqPAuE2xtqKrdZUTjbrzfjSjW1Tq6E4?cluster=devnet
- Penny, Bolted blocked with `notAllowlisted`, same model and prompt: https://explorer.solana.com/tx/T8kYDpyq5ffnSUgV8FRsvqP8vi9zEVSVTGbYEtRrQyK3KYBvypPQS49AjFSJQ8FXiQ5wLK2BMv2whxZ3GiPzUCH?cluster=devnet

## Social drafts (post only when you are ready)

**X**
I gave AI agents real wallets and let people try to rob them.

Same attack. Same model. Same prompt.
One drained. One blocked, because the last lock is on-chain.

The model said yes. The chain said no.

Deadbolt, built at the @mlhacks Solana Hackathon. https://deadbolt-flame.vercel.app

**LinkedIn**
Prompt injection is not a bug you patch in a system prompt.

This weekend I built Deadbolt for the MLH Solana Hackathon to show why. AI agents guard real devnet vaults, and anyone can pay a fraction of a cent to try to talk them out of it.

Then the same attack runs against the same model with one change: an on-chain spending policy. The model gets fooled again. The program refuses anyway.

If your agent can be talked into anything its key allows, shrink what the key allows.

Live demo: https://deadbolt-flame.vercel.app
