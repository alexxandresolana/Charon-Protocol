const snarkjs = require("snarkjs");
const fs = require("fs");

async function run() {
    const preimage = "12345";
    // Poseidon(12345)
    // We can get this from the circuit run or snarkjs

    console.log("Generating proof for preimage:", preimage);

    // Create input.json
    // In our circuit, we need knowledge of preimage such that Poseidon(preimage) == commitment
    // We'll let snarkjs calculate the witness and commitment

    // But wait, fullProve needs the commitment as a public signal input IF the circuit defines it as such.
    // In our circuit: signal input commitment; commitment === hasher.out;
    // So we need to calculate the hash first.

    const { buildPoseidon } = require("circomlibjs");
    const poseidon = await buildPoseidon();
    const hash = poseidon([BigInt(preimage)]);
    const commitment = poseidon.F.toObject(hash).toString();

    console.log("Commitment (Poseidon hash):", commitment);

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        { preimage: preimage, commitment: commitment },
        "circuits/build/heir_verifier_js/heir_verifier.wasm",
        "circuits/build/heir_verifier_final.zkey"
    );

    fs.writeFileSync("tests/proof.json", JSON.stringify(proof, null, 2));
    fs.writeFileSync("tests/public.json", JSON.stringify(publicSignals, null, 2));
    console.log("Proof and public signals written to tests/");
    process.exit(0);
}

run().catch(console.error);
