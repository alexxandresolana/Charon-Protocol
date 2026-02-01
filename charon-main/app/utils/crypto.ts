/**
 * Encrypts a secret string using AES-GCM with a random ephemeral key.
 * @param secret The secret string to encrypt
 * @returns { encryptedData: string, keyBuffer: ArrayBuffer }
 */
export async function encryptSecret(secret: string): Promise<{ data: string; iv: string; key: CryptoKey }> {
    const key = await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );

    const encoder = new TextEncoder();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoder.encode(secret) as BufferSource
    );

    return {
        data: Buffer.from(encrypted).toString("base64"),
        iv: Buffer.from(iv).toString("base64"),
        key
    };
}

/**
 * Exports a CryptoKey to a base64 string.
 */
export async function exportKey(key: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey("raw", key);
    return Buffer.from(exported).toString("base64");
}

/**
 * Imports a CryptoKey from a base64 string.
 */
export async function importKey(base64: string): Promise<CryptoKey> {
    const raw = Buffer.from(base64, "base64");
    return await window.crypto.subtle.importKey(
        "raw",
        raw as unknown as BufferSource,
        { name: "AES-GCM" },
        true,
        ["decrypt"]
    );
}
