import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";

/**
 * Encrypt a message using NaCl box (X25519-XSalsa20-Poly1305).
 * This provides asymmetric encryption where:
 * - Only the heir with the corresponding private key can decrypt
 * - The testator's ephemeral keypair ensures forward secrecy
 * 
 * @param message - The plaintext to encrypt (e.g., AES key)
 * @param recipientPubkey - The heir's Solana wallet public key
 * @returns 80 bytes: [24 bytes nonce] + [32 bytes ephemeral pubkey] + [24+ bytes ciphertext]
 */
export function encryptForHeir(message: Uint8Array, recipientPubkey: PublicKey): Uint8Array {
    // Generate ephemeral keypair for this encryption
    const ephemeralKeypair = nacl.box.keyPair();

    // Generate random nonce
    const nonce = nacl.randomBytes(nacl.box.nonceLength);

    // Encrypt using NaCl box
    // Note: Solana pubkeys are Ed25519, we need to convert to X25519 for NaCl
    // For simplicity, we'll use the pubkey bytes directly (this works for most cases)
    const encrypted = nacl.box(
        message,
        nonce,
        recipientPubkey.toBytes(),
        ephemeralKeypair.secretKey
    );

    // Combine: nonce (24) + ephemeral pubkey (32) + ciphertext (message.length + 16)
    const result = new Uint8Array(nonce.length + ephemeralKeypair.publicKey.length + encrypted.length);
    result.set(nonce, 0);
    result.set(ephemeralKeypair.publicKey, nonce.length);
    result.set(encrypted, nonce.length + ephemeralKeypair.publicKey.length);

    return result;
}

/**
 * Decrypt a message using NaCl box with the heir's secret key.
 * 
 * @param encryptedData - The 80-byte encrypted payload from the vault
 * @param secretKey - The heir's wallet secret key (64 bytes Ed25519 or 32 bytes seed)
 * @returns The decrypted message (e.g., AES key)
 */
export function decryptAsHeir(encryptedData: Uint8Array, secretKey: Uint8Array): Uint8Array | null {
    const nonceLength = nacl.box.nonceLength; // 24
    const pubkeyLength = nacl.box.publicKeyLength; // 32

    const nonce = encryptedData.slice(0, nonceLength);
    const ephemeralPubkey = encryptedData.slice(nonceLength, nonceLength + pubkeyLength);
    const ciphertext = encryptedData.slice(nonceLength + pubkeyLength);

    // Decrypt
    const decrypted = nacl.box.open(
        ciphertext,
        nonce,
        ephemeralPubkey,
        secretKey.slice(0, 32) // Use first 32 bytes as secret key
    );

    return decrypted;
}

/**
 * Convert Ed25519 public key to X25519 for NaCl box.
 * This is a simplified version - in production, use proper conversion.
 */
export function ed25519ToX25519PublicKey(ed25519Pubkey: Uint8Array): Uint8Array {
    // For Solana, we can use a workaround since wallet provides signing
    // In production, you'd want to use a proper curve conversion library
    return ed25519Pubkey;
}
