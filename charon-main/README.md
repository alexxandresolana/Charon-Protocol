# Charon Protocol

A decentralized, trustless Dead Man's Switch on Solana using Zero-Knowledge Proofs and True Time-Lock Encryption.

## How It Works

The Charon Protocol allows you to secure sensitive data (like seed phrases or private keys) that can only be accessed by a designated recipient (the heir) if you fail to "check-in" for a specified period.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CHARON PROTOCOL                               │
│                      Dead Man's Switch Flow                             │
└─────────────────────────────────────────────────────────────────────────┘

  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
  │   TESTATOR   │         │   SOLANA     │         │    HEIR      │
  │   (Owner)    │         │   CHAIN      │         │  (Recipient) │
  └──────┬───────┘         └──────┬───────┘         └──────┬───────┘
         │                        │                        │
    1. SETUP PHASE                │                        │
    ─────────────                 │                        │
         │                        │                        │
         │  Enter Secret Data     │                        │
         │  + Claim Password      │                        │
         │  + Heir Wallet Address │                        │
         │         │              │                        │
         │    ┌────▼────┐         │                        │
         │    │ AES-GCM │         │                        │
         │    │ Encrypt │         │                        │
         │    └────┬────┘         │                        │
         │         │              │                        │
         │    ┌────▼────┐         │                        │
         │    │NaCl Box │         │                        │
         │    │(AES Key)│         │                        │
         │    └────┬────┘         │                        │
         │         │              │                        │
         │  ZK Commitment ───────►│ Store:                 │
         │  + Encrypted AES Key   │ • commitment           │
         │  + Heir Pubkey         │ • encrypted_key        │
         │                        │ • heir_pubkey          │
         │                        │                        │
    2. HEARTBEAT PHASE            │                        │
    ──────────────────            │                        │
         │                        │                        │
         │  ♥ Ping (Check-in) ───►│ Reset Timer            │
         │      every X days      │                        │
         │                        │                        │
         │  ♥ Ping ──────────────►│ Reset Timer            │
         │                        │                        │
         │  ❌ No Ping for X days │                        │
         │                        │ Timer Expires!         │
         │                        │         │              │
    3. CLAIM PHASE                │         ▼              │
    ──────────────                │   ┌───────────┐        │
         │                        │   │  SWITCH   │        │
         │                        │   │ TRIGGERED │        │
         │                        │   └─────┬─────┘        │
         │                        │         │              │
         │                        │         │◄─────────────│ Enter Password
         │                        │         │              │
         │                        │    ┌────▼────┐         │
         │                        │    │SnarkJS  │◄────────│ Generate
         │                        │    │ Proof   │         │ ZK Proof
         │                        │    └────┬────┘         │
         │                        │         │              │
         │                        │    ┌────▼────┐         │
         │                        │    │Groth16  │         │
         │                        │    │ Verify  │         │
         │                        │    └────┬────┘         │
         │                        │         │              │
         │                        │    ✅ Proof Valid      │
         │                        │         │              │
         │                        │   Vault Claimed ──────►│ 1. Decrypt AES Key
         │                        │                        │ 2. Decrypt Secret
```

### 1. Setup Phase (Testator)

1.  **Encrypt Your Secret**: Your sensitive data is encrypted using AES-GCM with a random ephemeral key.
2.  **True Time-Lock Encryption**: The AES key is itself encrypted using the heir's Solana public key via **NaCl box** (X25519-XSalsa20-Poly1305). This ensures only the heir can ever decrypt the key.
3.  **Generate ZK Commitment**: A Poseidon hash of your claim password is stored on-chain. This ensures only someone who knows the password can trigger the claim.
4.  **Initialize Vault**: A Solana account (PDA) is created storing the commitment, the encrypted AES key, the heir's public key, and the heartbeat interval.

### 2. Heartbeat Phase (Testator)

-   Regularly call the `ping` instruction to reset your `last_heartbeat` timestamp.
-   As long as you check in before the interval expires, the switch remains inactive and the encrypted key remains locked on-chain.

### 3. Claim Phase (Heir)

If the heartbeat interval expires:

1.  **Generate Proof**: The heir enters the claim password and generates a Groth16 ZK proof using SnarkJS.
2.  **On-Chain Verification**: The Solana program verifies the ZK proof and the timeout condition.
3.  **Key Revelation**: Upon successful verification, the vault is marked as claimed. The heir then uses their private key (via wallet) to decrypt the AES key stored in the vault, which in turn decrypts the secret.

## Tech Stack

| Layer        | Technology                     |
| ------------ | ------------------------------ |
| Blockchain   | Solana (Anchor Framework)      |
| ZK Proofs    | Circom 2.0 + SnarkJS (Groth16) |
| On-Chain ZK  | `groth16-solana` library       |
| Asymmetric Cryptography | **NaCl Box (tweetnacl)** |
| Frontend     | Next.js + Tailwind CSS         |
| Wallet       | Solana Wallet Adapter          |
| Symmetric Encryption | AES-GCM (Web Crypto API) |

## Security Guarantees

-   **Trustless**: No third party can access your data or trigger the switch.
-   **Privacy**: The heir's identity and password are never revealed on-chain.
-   **True Time-Lock**: Even the heir cannot access the data until the switch conditions (timeout + ZK proof) are met.
-   **Verifiable**: All ZK verification happens on-chain using native Solana syscalls.
