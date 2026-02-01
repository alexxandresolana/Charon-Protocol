use anchor_lang::prelude::*;
use groth16_solana::groth16::Groth16Verifier;

pub mod verifying_key;
use crate::verifying_key::*;

declare_id!("77nAESkazvL7woLUFrLSGYrdPpa8rDHUAvAzTKHgMsSH");

#[program]
pub mod charon {
    use super::*;

    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        heir_commitment: [u8; 32],
        heir_pubkey: Pubkey,
        encrypted_key: [u8; 80], // AES key encrypted with heir's public key (nacl box)
        heartbeat_interval: i64,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.heir_commitment = heir_commitment;
        vault.heir_pubkey = heir_pubkey;
        vault.encrypted_key = encrypted_key;
        vault.heartbeat_interval = heartbeat_interval;
        vault.last_heartbeat = Clock::get()?.unix_timestamp;
        vault.is_claimed = false;

        msg!("Vault initialized for owner: {}", vault.owner);
        Ok(())
    }

    pub fn ping(ctx: Context<Ping>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.last_heartbeat = Clock::get()?.unix_timestamp;
        msg!("Heartbeat updated: {}", vault.last_heartbeat);
        Ok(())
    }

    pub fn claim(
        ctx: Context<Claim>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;

        // 1. Verify Time Constraint
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp > vault.last_heartbeat + vault.heartbeat_interval,
            CharonError::HeartbeatNotExpired
        );
        require!(!vault.is_claimed, CharonError::AlreadyClaimed);

        // 2. Prepare Public Inputs: [heir_commitment]
        // Note: Field elements must be 32 bytes (Big Endian)
        let public_inputs = [vault.heir_commitment];

        // 3. Verify Groth16 Proof
        // We use the constants from verifying_key.rs
        let mut verifier =
            Groth16Verifier::<1>::new(&proof_a, &proof_b, &proof_c, &public_inputs, &VERIFYING_KEY)
                .map_err(|_| CharonError::InvalidProof)?;

        verifier
            .verify()
            .map_err(|_| CharonError::ProofVerificationFailed)?;

        // 4. Mark as claimed
        vault.is_claimed = true;
        msg!("Vault successfully claimed!");

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 32 + 32 + 80 + 8 + 8 + 1, // +32 heir_pubkey +80 encrypted_key
        seeds = [b"vault", owner.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, VaultAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Ping<'info> {
    #[account(mut, has_one = owner)]
    pub vault: Account<'info, VaultAccount>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub vault: Account<'info, VaultAccount>,
    pub claimant: Signer<'info>, // Anyone can call if time is up and they have the proof
}

#[account]
pub struct VaultAccount {
    pub owner: Pubkey,
    pub heir_commitment: [u8; 32],
    pub heir_pubkey: Pubkey,
    pub encrypted_key: [u8; 80], // NaCl box encrypted AES key
    pub heartbeat_interval: i64,
    pub last_heartbeat: i64,
    pub is_claimed: bool,
}

#[error_code]
pub enum CharonError {
    #[msg("The heartbeat interval has not expired yet.")]
    HeartbeatNotExpired,
    #[msg("The vault has already been claimed.")]
    AlreadyClaimed,
    #[msg("The provided ZK proof is invalid.")]
    InvalidProof,
    #[msg("Proof verification failed during execution.")]
    ProofVerificationFailed,
}
