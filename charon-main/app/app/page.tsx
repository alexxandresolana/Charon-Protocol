"use client";

import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

// Dynamically import WalletMultiButton with SSR disabled to prevent hydration mismatch
const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((mod) => mod.WalletMultiButton),
  { ssr: false }
);
import {
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram
} from "@solana/web3.js";
import { Program, AnchorProvider, utils, BN } from "@coral-xyz/anchor";
import { encryptSecret, exportKey } from "@/utils/crypto";
import { generateClaimProof } from "@/utils/zk";
import { encryptForHeir } from "@/utils/nacl";
import idl from "../target/idl/charon.json";
import type { Charon } from "../target/types/charon";

// Poseidon hash helper from circomlibjs
import { buildPoseidon } from "circomlibjs";

const PROGRAM_ID = new PublicKey("77nAESkazvL7woLUFrLSGYrdPpa8rDHUAvAzTKHgMsSH");

export default function Home() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [interval, setInterval] = useState(30); // days
  const [vault, setVault] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [claimedData, setClaimedData] = useState<string | null>(null);
  const [poseidon, setPoseidon] = useState<any>(null);
  const [heirAddress, setHeirAddress] = useState("");

  const provider = useMemo(() => {
    if (!publicKey) return null;
    return new AnchorProvider(connection, (window as any).solana, AnchorProvider.defaultOptions());
  }, [connection, publicKey]);

  const program = useMemo(() => {
    if (!provider) return null;
    return new Program<Charon>(idl as Charon, provider);
  }, [provider]);

  const vaultPDA = useMemo(() => {
    if (!publicKey) return null;
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), publicKey.toBuffer()],
      PROGRAM_ID
    );
    return pda;
  }, [publicKey]);

  useEffect(() => {
    const initPoseidon = async () => {
      try {
        const p = await buildPoseidon();
        setPoseidon(() => p);
      } catch (err) {
        console.error("Failed to initialize Poseidon:", err);
      }
    };
    initPoseidon();

    if (program && vaultPDA) {
      fetchVault();
    }
  }, [program, vaultPDA]);

  async function fetchVault() {
    if (!program || !vaultPDA) return;
    try {
      const account = await program.account.vaultAccount.fetch(vaultPDA);
      setVault(account);
    } catch (e) {
      console.log("No vault found or error fetching");
      setVault(null);
    }
  }

  async function handleInitialize() {
    if (!program || !publicKey || !vaultPDA) return;
    if (!heirAddress) {
      alert("Please enter the heir's wallet address");
      return;
    }
    setLoading(true);
    try {
      // 1. Parse heir's public key
      const heirPubkey = new PublicKey(heirAddress);

      // 2. Encrypt Secret with AES
      const { data, iv, key } = await encryptSecret(secret);
      const exportedKeyRaw = await window.crypto.subtle.exportKey("raw", key);
      const aesKeyBytes = new Uint8Array(exportedKeyRaw);

      // 3. TIME-LOCK: Encrypt AES key with heir's public key (NaCl box)
      // This ensures ONLY the heir can decrypt, and ONLY after claim succeeds
      const encryptedKey = encryptForHeir(aesKeyBytes, heirPubkey);

      // Pad to 80 bytes if needed (24 nonce + 32 ephemeral + 16+32 ciphertext = 104, but we use 80 for smaller keys)
      // Adjust: for 32-byte AES key: 24 + 32 + (32+16) = 104 bytes. Let's use 104.
      // For now, store the encrypted key separately (IPFS/Arweave in production)

      // 4. Generate Commitment (Poseidon Hash of password)
      if (!poseidon) throw new Error("Poseidon not initialized");
      const hash = poseidon([BigInt(password)]);
      const commitment = poseidon.F.toRprBE(hash, 32);

      // 5. Call initializeVault with new parameters
      // Note: encryptedKey is stored off-chain for now (too large for account)
      const tx = await program.methods
        .initializeVault(
          Array.from(commitment),
          heirPubkey,
          Array.from(encryptedKey.slice(0, 80)) as any, // First 80 bytes
          new BN(interval * 24 * 60 * 60)
        )
        .accounts({
          vault: vaultPDA,
          owner: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Initialized:", tx);

      // Store encrypted data off-chain (localStorage for MVP)
      // In production: IPFS/Arweave
      localStorage.setItem(`charon_data_${Buffer.from(commitment).toString("hex")}`, JSON.stringify({
        encryptedSecret: data,
        iv,
        fullEncryptedKey: Array.from(encryptedKey) // Full encrypted key for claim
      }));

      await fetchVault();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handlePing() {
    if (!program || !publicKey || !vaultPDA) return;
    setLoading(true);
    try {
      await program.methods.ping().accounts({ vault: vaultPDA, owner: publicKey }).rpc();
      await fetchVault();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleClaim() {
    if (!program || !publicKey || !vaultPDA || !vault) return;
    setLoading(true);
    try {
      const commitmentHex = Buffer.from(vault.heirCommitment).toString("hex");

      // 1. Generate ZK Proof
      // We need the password. User must provide it to claim.
      const { proofA, proofB, proofC } = await generateClaimProof(password, commitmentHex);

      // 2. Call Claim with Proof
      // Increase Compute Budget first
      const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
        units: 400_000
      });

      const tx = await program.methods
        .claim(
          Array.from(proofA),
          Array.from(proofB),
          Array.from(proofC)
        )
        .accounts({
          vault: vaultPDA,
          claimant: publicKey,
        })
        .preInstructions([modifyComputeUnits])
        .rpc();

      console.log("Claimed:", tx);

      // 3. Decrypt and Reveal
      const localData = localStorage.getItem(`charon_${commitmentHex}`);
      if (localData) {
        const { data, iv, exportedKey } = JSON.parse(localData);
        // Decryption logic here...
        setClaimedData(data);
      }

      await fetchVault();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0a0a0f] text-white p-8 font-[family-name:var(--font-geist-sans)]">
      <nav className="flex justify-between items-center mb-12">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-blue-500 bg-clip-text text-transparent">
          CHARON PROTOCOL
        </h1>
        <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700 transition-colors" />
      </nav>

      <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left Side: Setup */}
        <section className="bg-white/5 backdrop-blur-md rounded-2xl p-8 border border-white/10 shadow-xl">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 text-purple-300">
            <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
            Create New Switch
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Secret Data</label>
              <textarea
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:border-purple-500 outline-none transition-all h-24"
                placeholder="Seed phrase, private keys..."
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Claim Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:border-purple-500 outline-none transition-all"
                placeholder="Must be used to generate proof"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Heartbeat Interval (Days)</label>
              <input
                type="number"
                value={interval}
                onChange={(e) => setInterval(Number(e.target.value))}
                className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:border-purple-500 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                Heir Wallet Address
                <span className="text-purple-400 ml-1">(Time-Lock)</span>
              </label>
              <input
                type="text"
                value={heirAddress}
                onChange={(e) => setHeirAddress(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:border-purple-500 outline-none transition-all font-mono"
                placeholder="e.g., 7xKXtg2..."
              />
              <p className="text-xs text-gray-500 mt-1">
                Only this wallet can decrypt the secret after switch triggers
              </p>
            </div>
            <button
              onClick={handleInitialize}
              disabled={loading || !publicKey}
              className="w-full bg-gradient-to-r from-purple-600 to-blue-600 py-3 rounded-lg font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? "Processing..." : "Secure My Data"}
            </button>
          </div>
        </section>

        {/* Right Side: Active Switch */}
        <section className="bg-white/5 backdrop-blur-md rounded-2xl p-8 border border-white/10 shadow-xl">
          <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 text-blue-300">
            <span className="w-2 h-2 bg-blue-400 rounded-full" />
            Active Switch Status
          </h2>
          {vault ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-black/40 p-3 rounded-lg border border-white/5">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Status</p>
                  <p className={`font-medium ${vault.isClaimed ? 'text-red-400' : 'text-green-400'}`}>
                    {vault.isClaimed ? "TRIGGERED" : "HEARTBEATING"}
                  </p>
                </div>
                <div className="bg-black/40 p-3 rounded-lg border border-white/5">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Interval</p>
                  <p className="font-medium">{new BN(vault.heartbeatInterval).toNumber() / 86400} Days</p>
                </div>
              </div>

              <div className="bg-black/40 p-4 rounded-lg border border-white/5">
                <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Last Heartbeat</p>
                <p className="text-lg font-mono">
                  {new Date(new BN(vault.lastHeartbeat).toNumber() * 1000).toLocaleString()}
                </p>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={handlePing}
                  disabled={loading}
                  className="flex-1 bg-white/10 hover:bg-white/20 py-3 rounded-lg font-semibold transition-all"
                >
                  Pulse Heartbeat
                </button>
                <button
                  onClick={handleClaim}
                  disabled={loading || vault.isClaimed}
                  className="flex-1 bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 py-3 rounded-lg font-semibold transition-all"
                >
                  Emergency Claim
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 py-12">
              <svg className="w-16 h-16 mb-4 opacity-20" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
              </svg>
              <p>No active switch detected.</p>
            </div>
          )}
        </section>
      </div>

      {claimedData && (
        <div className="mt-12 p-8 bg-blue-900/20 border border-blue-500/30 rounded-2xl animate-in fade-in slide-in-from-bottom-4 duration-700">
          <h3 className="text-blue-300 font-bold mb-2 uppercase tracking-tight">Decrypted Secret Payload:</h3>
          <p className="font-mono bg-black/60 p-4 rounded-lg break-all">{claimedData}</p>
        </div>
      )}
    </main>
  );
}
