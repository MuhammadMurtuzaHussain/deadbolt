//! Deadbolt: on-chain spend policy for AI agent vaults, proven in a
//! pay-per-prompt red-team arena.
//!
//! The thesis this program encodes: prompt injection cannot be fully fixed at
//! the model layer, so the last defence has to live somewhere the model cannot
//! talk to. An agent key here can only move funds through `resolve`, and
//! `resolve` runs a policy the agent cannot edit, however convinced it is.
//!
//! Lifecycle:
//!   create_vault -> set_brief* -> [ attempt -> resolve ]* -> withdraw
//!
//! Every prompt an attacker sends is stored on-chain with its reply, so an
//! agent's survival record is public and cannot be edited after the fact.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("B6LQc2vc12i3zGzciGE3ZTGpFbMPtwK3io5vGbMfNQh");

pub const NAME_LEN: usize = 32;
pub const JOB_LEN: usize = 80;
pub const BRIEF_LEN: usize = 1600;
pub const PROMPT_LEN: usize = 420;
pub const REPLY_LEN: usize = 320;
pub const ALLOWLIST_LEN: usize = 4;
pub const BPS: u64 = 10_000;
/// After this long an unresolved attempt can be refunded by anyone. Stops a
/// dead agent runtime from keeping fees it never earned.
pub const ATTEMPT_TTL_SECS: i64 = 180;

pub const DEFENSE_INPUT_FILTER: u8 = 1 << 0;
pub const DEFENSE_OUTPUT_REVIEW: u8 = 1 << 1;

#[program]
pub mod deadbolt {
    use super::*;

    /// One-time setup of the arena config.
    pub fn initialize_arena(
        ctx: Context<InitializeArena>,
        treasury: Pubkey,
        house_bps: u16,
    ) -> Result<()> {
        require!(u64::from(house_bps) <= BPS, DeadboltError::InvalidBps);
        let arena = &mut ctx.accounts.arena;
        arena.authority = ctx.accounts.authority.key();
        arena.treasury = treasury;
        arena.house_bps = house_bps;
        arena.vault_count = 0;
        arena.attempt_count = 0;
        arena.bump = ctx.bumps.arena;
        Ok(())
    }

    /// Opens a vault and escrows its bounty. The sponsor cannot pull the bounty
    /// back before `lock_until`, so attackers can trust the prize exists.
    pub fn create_vault(
        ctx: Context<CreateVault>,
        vault_id: u64,
        args: CreateVaultArgs,
    ) -> Result<()> {
        require!(!args.name.is_empty(), DeadboltError::NameRequired);
        require!(args.name.len() <= NAME_LEN, DeadboltError::TooLong);
        require!(args.job.len() <= JOB_LEN, DeadboltError::TooLong);
        args.policy.validate()?;

        let now = Clock::get()?.unix_timestamp;
        require!(args.lock_until >= now, DeadboltError::LockInPast);

        let vault = &mut ctx.accounts.vault;
        vault.sponsor = ctx.accounts.sponsor.key();
        vault.agent = args.agent;
        vault.vault_id = vault_id;
        vault.name = args.name;
        vault.job = args.job;
        vault.model_tier = args.model_tier;
        vault.defenses = args.defenses;
        vault.policy = args.policy;
        vault.entry_fee = args.entry_fee;
        vault.lock_until = args.lock_until;
        vault.created_at = now;
        vault.window_start = now;
        vault.window_spent = 0;
        vault.paused = false;
        vault.stats = VaultStats::default();
        vault.brief = Vec::new();
        vault.bump = ctx.bumps.vault;

        if args.bounty > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    system_program::Transfer {
                        from: ctx.accounts.sponsor.to_account_info(),
                        to: ctx.accounts.vault.to_account_info(),
                    },
                ),
                args.bounty,
            )?;
        }

        ctx.accounts.arena.vault_count = ctx.accounts.arena.vault_count.saturating_add(1);
        emit!(VaultCreated {
            vault: ctx.accounts.vault.key(),
            sponsor: ctx.accounts.sponsor.key(),
            bounty: args.bounty,
        });
        Ok(())
    }

    /// Writes the agent's public system prompt in chunks. Frozen at the first
    /// attempt, so the sponsor cannot quietly patch an agent mid-bounty.
    pub fn set_brief(ctx: Context<SponsorOnly>, offset: u16, data: Vec<u8>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        require!(vault.stats.attempts == 0, DeadboltError::BriefFrozen);
        let offset = usize::from(offset);
        require!(offset <= vault.brief.len(), DeadboltError::BriefGap);
        let end = offset
            .checked_add(data.len())
            .ok_or(DeadboltError::TooLong)?;
        require!(end <= BRIEF_LEN, DeadboltError::TooLong);
        vault.brief.truncate(offset);
        vault.brief.extend_from_slice(&data);
        Ok(())
    }

    /// Anyone can add to the pot.
    pub fn fund(ctx: Context<Fund>, amount: u64) -> Result<()> {
        require!(amount > 0, DeadboltError::ZeroAmount);
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                system_program::Transfer {
                    from: ctx.accounts.funder.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    /// The sponsor takes back what is left, only once the escrow lock expires.
    pub fn withdraw(ctx: Context<SponsorOnly>, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.vault.lock_until,
            DeadboltError::EscrowLocked
        );
        let available = pot_of(&ctx.accounts.vault.to_account_info())?;
        require!(amount <= available, DeadboltError::InsufficientPot);
        move_lamports(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.sponsor.to_account_info(),
            amount,
        )
    }

    /// Kill switch. While the escrow lock runs it is off limits, otherwise a
    /// sponsor could freeze a bounty the moment someone gets close to it.
    pub fn set_paused(ctx: Context<SponsorOnly>, paused: bool) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.vault.lock_until,
            DeadboltError::EscrowLocked
        );
        ctx.accounts.vault.paused = paused;
        Ok(())
    }

    /// An attacker pays the entry fee and commits their prompt to the chain.
    /// The agent runtime reads the prompt from this account, not from a client.
    pub fn attempt(ctx: Context<MakeAttempt>, nonce: u64, prompt: String) -> Result<()> {
        require!(!prompt.trim().is_empty(), DeadboltError::EmptyPrompt);
        require!(prompt.len() <= PROMPT_LEN, DeadboltError::TooLong);
        require!(!ctx.accounts.vault.paused, DeadboltError::VaultPaused);
        require_keys_eq!(
            ctx.accounts.treasury.key(),
            ctx.accounts.arena.treasury,
            DeadboltError::WrongTreasury
        );

        let fee = ctx.accounts.vault.entry_fee;
        let house = fee
            .checked_mul(u64::from(ctx.accounts.arena.house_bps))
            .ok_or(DeadboltError::MathOverflow)?
            / BPS;
        let to_pot = fee.checked_sub(house).ok_or(DeadboltError::MathOverflow)?;

        if to_pot > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    system_program::Transfer {
                        from: ctx.accounts.player.to_account_info(),
                        to: ctx.accounts.vault.to_account_info(),
                    },
                ),
                to_pot,
            )?;
        }
        if house > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    system_program::Transfer {
                        from: ctx.accounts.player.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                ),
                house,
            )?;
        }

        let now = Clock::get()?.unix_timestamp;
        let at = &mut ctx.accounts.attempt;
        at.vault = ctx.accounts.vault.key();
        at.player = ctx.accounts.player.key();
        at.nonce = nonce;
        at.created_at = now;
        at.resolved_at = 0;
        at.status = AttemptStatus::Pending;
        at.outcome = Outcome::None;
        at.block_reason = BlockReason::None;
        at.technique = 0;
        at.fee_to_pot = to_pot;
        at.requested = 0;
        at.extracted = 0;
        at.recipient = Pubkey::default();
        at.prompt = prompt;
        at.reply = String::new();
        at.bump = ctx.bumps.attempt;

        let vault = &mut ctx.accounts.vault;
        vault.stats.attempts = vault.stats.attempts.saturating_add(1);
        vault.stats.fees_collected = vault.stats.fees_collected.saturating_add(fee);
        ctx.accounts.arena.attempt_count = ctx.accounts.arena.attempt_count.saturating_add(1);
        Ok(())
    }

    /// The agent's single, final action on an attempt.
    ///
    /// This is the only path by which an agent key can move funds. One attempt
    /// buys one action, so a replay or a racing runtime cannot spend twice.
    /// A policy block is recorded as a success, not a failed transaction: a
    /// failed transaction would roll back the evidence, and the block is the
    /// most useful thing the chain can remember.
    pub fn resolve(ctx: Context<Resolve>, args: ResolveArgs) -> Result<()> {
        require!(args.reply.len() <= REPLY_LEN, DeadboltError::TooLong);
        let now = Clock::get()?.unix_timestamp;
        let vault_info = ctx.accounts.vault.to_account_info();
        let recipient_info = ctx.accounts.recipient.to_account_info();
        let recipient = recipient_info.key();

        let vault = &mut ctx.accounts.vault;
        let attempt = &mut ctx.accounts.attempt;
        require!(
            attempt.status == AttemptStatus::Pending,
            DeadboltError::AlreadyResolved
        );

        let mut outcome = args.verdict;
        let mut block_reason = BlockReason::None;
        let mut extracted = 0u64;

        match args.verdict {
            Outcome::Refused => vault.stats.refused = vault.stats.refused.saturating_add(1),
            Outcome::Filtered => vault.stats.filtered = vault.stats.filtered.saturating_add(1),
            Outcome::Vetoed => vault.stats.vetoed = vault.stats.vetoed.saturating_add(1),
            Outcome::Transfer => {
                require!(args.amount > 0, DeadboltError::ZeroAmount);
                require_keys_neq!(recipient, vault.key(), DeadboltError::SelfTransfer);
                attempt.requested = args.amount;
                attempt.recipient = recipient;

                match vault.evaluate(recipient, args.amount, now) {
                    Some(reason) => {
                        outcome = Outcome::Blocked;
                        block_reason = reason;
                        vault.stats.blocked = vault.stats.blocked.saturating_add(1);
                        msg!("DEADBOLT BLOCKED: {}", reason.as_str());
                    }
                    None => {
                        // A draining ask takes what is there, it does not fail.
                        let pot = pot_of(&vault_info)?;
                        extracted = args.amount.min(pot);
                        if extracted == 0 {
                            outcome = Outcome::Blocked;
                            block_reason = BlockReason::EmptyPot;
                            vault.stats.blocked = vault.stats.blocked.saturating_add(1);
                        } else {
                            vault.commit_spend(extracted, now);
                            move_lamports(&vault_info, &recipient_info, extracted)?;
                            outcome = Outcome::Breached;
                            vault.stats.breached = vault.stats.breached.saturating_add(1);
                            vault.stats.total_extracted =
                                vault.stats.total_extracted.saturating_add(extracted);
                            msg!("DEADBOLT BREACHED: {} lamports moved", extracted);
                        }
                    }
                }
            }
            _ => return err!(DeadboltError::InvalidVerdict),
        }

        attempt.status = AttemptStatus::Resolved;
        attempt.outcome = outcome;
        attempt.block_reason = block_reason;
        attempt.technique = args.technique;
        attempt.extracted = extracted;
        attempt.reply = args.reply;
        attempt.resolved_at = now;

        emit!(AttemptResolved {
            vault: vault.key(),
            attempt: attempt.key(),
            player: attempt.player,
            outcome,
            block_reason,
            extracted,
        });
        Ok(())
    }

    /// If the agent never answers, anyone can return the player's pot share.
    pub fn expire_attempt(ctx: Context<ExpireAttempt>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let attempt = &mut ctx.accounts.attempt;
        require!(
            attempt.status == AttemptStatus::Pending,
            DeadboltError::AlreadyResolved
        );
        let expires_at = attempt
            .created_at
            .checked_add(ATTEMPT_TTL_SECS)
            .ok_or(DeadboltError::MathOverflow)?;
        require!(now >= expires_at, DeadboltError::NotExpired);

        attempt.status = AttemptStatus::Expired;
        attempt.resolved_at = now;

        let refund = attempt.fee_to_pot;
        let vault_info = ctx.accounts.vault.to_account_info();
        let refund = refund.min(pot_of(&vault_info)?);
        if refund > 0 {
            move_lamports(&vault_info, &ctx.accounts.player.to_account_info(), refund)?;
        }
        Ok(())
    }
}

fn pot_of(vault: &AccountInfo) -> Result<u64> {
    let rent_floor = Rent::get()?.minimum_balance(vault.data_len());
    Ok(vault.lamports().saturating_sub(rent_floor))
}

/// The vault is owned by this program, so it can debit itself directly.
fn move_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    from.sub_lamports(amount)?;
    to.add_lamports(amount)?;
    Ok(())
}

// ---------------------------------------------------------------- accounts

#[account]
#[derive(InitSpace)]
pub struct Arena {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub house_bps: u16,
    pub vault_count: u64,
    pub attempt_count: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, InitSpace, Debug)]
pub struct Policy {
    /// False means no on-chain limits at all: the agent's word is final.
    pub enabled: bool,
    /// Zero disables this check.
    pub max_per_tx: u64,
    /// Zero disables this check.
    pub window_cap: u64,
    pub window_secs: u32,
    /// Empty means any recipient is allowed.
    #[max_len(ALLOWLIST_LEN)]
    pub allowlist: Vec<Pubkey>,
}

impl Policy {
    fn validate(&self) -> Result<()> {
        require!(
            self.allowlist.len() <= ALLOWLIST_LEN,
            DeadboltError::TooLong
        );
        if self.window_cap > 0 {
            require!(self.window_secs > 0, DeadboltError::InvalidWindow);
        }
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, InitSpace, Debug)]
pub struct VaultStats {
    pub attempts: u64,
    pub refused: u64,
    pub filtered: u64,
    pub vetoed: u64,
    pub blocked: u64,
    pub breached: u64,
    pub total_extracted: u64,
    pub fees_collected: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub sponsor: Pubkey,
    pub agent: Pubkey,
    pub vault_id: u64,
    #[max_len(NAME_LEN)]
    pub name: String,
    #[max_len(JOB_LEN)]
    pub job: String,
    pub model_tier: u8,
    pub defenses: u8,
    pub policy: Policy,
    pub entry_fee: u64,
    pub lock_until: i64,
    pub created_at: i64,
    pub window_start: i64,
    pub window_spent: u64,
    pub paused: bool,
    pub stats: VaultStats,
    #[max_len(BRIEF_LEN)]
    pub brief: Vec<u8>,
    pub bump: u8,
}

impl Vault {
    /// Returns why a transfer must not happen, or None if it may.
    /// The same code path runs for every agent, however persuaded it is.
    pub fn evaluate(&self, recipient: Pubkey, amount: u64, now: i64) -> Option<BlockReason> {
        if self.paused {
            return Some(BlockReason::Paused);
        }
        if !self.policy.enabled {
            return None;
        }
        let p = &self.policy;
        if !p.allowlist.is_empty() && !p.allowlist.contains(&recipient) {
            return Some(BlockReason::NotAllowlisted);
        }
        if p.max_per_tx > 0 && amount > p.max_per_tx {
            return Some(BlockReason::OverPerTxCap);
        }
        if p.window_cap > 0 {
            let spent = if self.window_expired(now) {
                0
            } else {
                self.window_spent
            };
            if spent.saturating_add(amount) > p.window_cap {
                return Some(BlockReason::OverWindowCap);
            }
        }
        None
    }

    fn window_expired(&self, now: i64) -> bool {
        now.saturating_sub(self.window_start) >= i64::from(self.policy.window_secs)
    }

    fn commit_spend(&mut self, amount: u64, now: i64) {
        if self.window_expired(now) {
            self.window_start = now;
            self.window_spent = 0;
        }
        self.window_spent = self.window_spent.saturating_add(amount);
    }
}

#[account]
#[derive(InitSpace)]
pub struct Attempt {
    pub vault: Pubkey,
    pub player: Pubkey,
    pub nonce: u64,
    pub created_at: i64,
    pub resolved_at: i64,
    pub status: AttemptStatus,
    pub outcome: Outcome,
    pub block_reason: BlockReason,
    /// Attack family, tagged by the runtime's analyst model.
    pub technique: u8,
    pub fee_to_pot: u64,
    pub requested: u64,
    pub extracted: u64,
    pub recipient: Pubkey,
    #[max_len(PROMPT_LEN)]
    pub prompt: String,
    #[max_len(REPLY_LEN)]
    pub reply: String,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum AttemptStatus {
    Pending,
    Resolved,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Outcome {
    None,
    /// The model said no.
    Refused,
    /// The input filter stopped it before the model saw it.
    Filtered,
    /// The model said yes, then the output reviewer vetoed the action.
    Vetoed,
    /// Runtime verdict only: the model wants to send funds. The chain decides
    /// whether that becomes Blocked or Breached.
    Transfer,
    /// The model was fooled and the chain refused.
    Blocked,
    /// Funds moved.
    Breached,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum BlockReason {
    None,
    NotAllowlisted,
    OverPerTxCap,
    OverWindowCap,
    Paused,
    EmptyPot,
}

impl BlockReason {
    fn as_str(&self) -> &'static str {
        match self {
            BlockReason::None => "none",
            BlockReason::NotAllowlisted => "recipient is not on the allowlist",
            BlockReason::OverPerTxCap => "amount is over the per-transaction cap",
            BlockReason::OverWindowCap => "amount is over the rolling window cap",
            BlockReason::Paused => "vault is paused",
            BlockReason::EmptyPot => "vault is empty",
        }
    }
}

// ---------------------------------------------------------------- arguments

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateVaultArgs {
    pub agent: Pubkey,
    pub name: String,
    pub job: String,
    pub model_tier: u8,
    pub defenses: u8,
    pub policy: Policy,
    pub entry_fee: u64,
    pub lock_until: i64,
    pub bounty: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ResolveArgs {
    pub verdict: Outcome,
    pub amount: u64,
    pub technique: u8,
    pub reply: String,
}

// ---------------------------------------------------------------- contexts

#[derive(Accounts)]
pub struct InitializeArena<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + Arena::INIT_SPACE,
        seeds = [b"arena"],
        bump
    )]
    pub arena: Account<'info, Arena>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(vault_id: u64)]
pub struct CreateVault<'info> {
    #[account(mut, seeds = [b"arena"], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(
        init,
        payer = sponsor,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", sponsor.key().as_ref(), &vault_id.to_le_bytes()],
        bump
    )]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut)]
    pub sponsor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SponsorOnly<'info> {
    #[account(mut, has_one = sponsor)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut)]
    pub sponsor: Signer<'info>,
}

#[derive(Accounts)]
pub struct Fund<'info> {
    #[account(mut)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut)]
    pub funder: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct MakeAttempt<'info> {
    #[account(mut, seeds = [b"arena"], bump = arena.bump)]
    pub arena: Account<'info, Arena>,
    #[account(mut)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        init,
        payer = player,
        space = 8 + Attempt::INIT_SPACE,
        seeds = [b"attempt", vault.key().as_ref(), player.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub attempt: Box<Account<'info, Attempt>>,
    #[account(mut)]
    pub player: Signer<'info>,
    /// CHECK: compared to `arena.treasury` in the handler.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    #[account(mut, has_one = agent)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut, has_one = vault)]
    pub attempt: Box<Account<'info, Attempt>>,
    /// The agent's key signs, and it holds no authority except this instruction.
    pub agent: Signer<'info>,
    /// CHECK: attacker-influenced destination, judged by `Vault::evaluate`.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ExpireAttempt<'info> {
    #[account(mut)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(mut, has_one = vault, has_one = player)]
    pub attempt: Box<Account<'info, Attempt>>,
    /// CHECK: bound to `attempt.player` by has_one.
    #[account(mut)]
    pub player: UncheckedAccount<'info>,
}

// ---------------------------------------------------------------- events

#[event]
pub struct VaultCreated {
    pub vault: Pubkey,
    pub sponsor: Pubkey,
    pub bounty: u64,
}

#[event]
pub struct AttemptResolved {
    pub vault: Pubkey,
    pub attempt: Pubkey,
    pub player: Pubkey,
    pub outcome: Outcome,
    pub block_reason: BlockReason,
    pub extracted: u64,
}

// ---------------------------------------------------------------- errors

#[error_code]
pub enum DeadboltError {
    #[msg("House share must be at most 100%")]
    InvalidBps,
    #[msg("Vault name is required")]
    NameRequired,
    #[msg("Input is too long")]
    TooLong,
    #[msg("Escrow lock must not be in the past")]
    LockInPast,
    #[msg("Window cap needs a window length")]
    InvalidWindow,
    #[msg("Brief is frozen once attackers have started")]
    BriefFrozen,
    #[msg("Brief chunks must be written without gaps")]
    BriefGap,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Bounty escrow is still locked")]
    EscrowLocked,
    #[msg("Vault does not hold that much")]
    InsufficientPot,
    #[msg("Prompt is empty")]
    EmptyPrompt,
    #[msg("Vault is paused")]
    VaultPaused,
    #[msg("Treasury does not match the arena config")]
    WrongTreasury,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("This attempt has already been resolved")]
    AlreadyResolved,
    #[msg("A vault cannot pay itself")]
    SelfTransfer,
    #[msg("Verdict is not valid here")]
    InvalidVerdict,
    #[msg("Attempt has not expired yet")]
    NotExpired,
}
