const anchor = require("@coral-xyz/anchor");
const { expect } = require("chai");
const fs = require("fs");

describe("charon", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Charon;
  const owner = provider.wallet;

  const [vaultPDA] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.publicKey.toBuffer()],
    program.programId
  );

  it("Is initialized!", async () => {
    const publicSignals = JSON.parse(fs.readFileSync("tests/public.json"));
    const commitment = Array.from(Buffer.from(BigInt(publicSignals[0]).toString(16).padStart(64, '0'), "hex"));

    const tx = await program.methods
      .initializeVault(commitment, new anchor.BN(1)) // 1 second interval
      .accounts({
        vault: vaultPDA,
        owner: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const vaultState = await program.account.vaultAccount.fetch(vaultPDA);
    expect(vaultState.owner.toString()).to.equal(owner.publicKey.toString());
    expect(vaultState.isClaimed).to.be.false;
  });

  it("Can ping", async () => {
    await program.methods
      .ping()
      .accounts({
        vault: vaultPDA,
        owner: owner.publicKey,
      })
      .rpc();

    const vaultState = await program.account.vaultAccount.fetch(vaultPDA);
    // last_heartbeat should be updated
  });

  it("Can claim with proof", async () => {
    // Wait for interval to expire
    await new Promise(resolve => setTimeout(resolve, 3000));

    const proof = JSON.parse(fs.readFileSync("tests/proof.json"));
    const publicSignals = JSON.parse(fs.readFileSync("tests/public.json"));

    // Helper to format proof points
    const formatG1 = (p) => Array.from(Buffer.concat([
      Buffer.from(BigInt(p[0]).toString(16).padStart(64, '0'), "hex"),
      Buffer.from(BigInt(p[1]).toString(16).padStart(64, '0'), "hex")
    ]));

    const formatG1Neg = (p) => {
      const P = BigInt("21888242871839275222246405745257275088696311157297823662689037894645226208583");
      const yNeg = P - BigInt(p[1]);
      return Array.from(Buffer.concat([
        Buffer.from(BigInt(p[0]).toString(16).padStart(64, '0'), "hex"),
        Buffer.from(yNeg.toString(16).padStart(64, '0'), "hex")
      ]));
    };

    const formatG2 = (p) => Array.from(Buffer.concat([
      Buffer.from(BigInt(p[0][1]).toString(16).padStart(64, '0'), "hex"),
      Buffer.from(BigInt(p[0][0]).toString(16).padStart(64, '0'), "hex"),
      Buffer.from(BigInt(p[1][1]).toString(16).padStart(64, '0'), "hex"),
      Buffer.from(BigInt(p[1][0]).toString(16).padStart(64, '0'), "hex")
    ]));

    const pA = formatG1Neg(proof.pi_a);
    const pB = formatG2(proof.pi_b);
    const pC = formatG1(proof.pi_c);

    const modifyComputeUnits = anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000
    });

    const tx = await program.methods
      .claim(pA, pB, pC)
      .accounts({
        vault: vaultPDA,
        claimant: owner.publicKey,
      })
      .preInstructions([modifyComputeUnits])
      .rpc();

    const vaultState = await program.account.vaultAccount.fetch(vaultPDA);
    expect(vaultState.isClaimed).to.be.true;
  });
});
