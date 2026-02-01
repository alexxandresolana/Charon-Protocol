import * as snarkjs from "snarkjs";

/**
 * Generates a Groth16 ZK proof for the heir claim.
 * @param preimage The password (preimage)
 * @param commitment The stored hash (public input)
 * @returns Formatted proof and public inputs ready for Anchor
 */
export async function generateClaimProof(preimage: string, commitment: string) {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        { preimage, commitment },
        "/zk/heir_verifier.wasm",
        "/zk/heir_verifier_final.zkey"
    );

    // Negate proof_a for groth16-solana library
    // The library expects Proof A to be negated to perform pairing check: e(-A, B) * ... = 1
    const pA = await negateProofPoints(proof.pi_a);
    const pB = formatProofB(proof.pi_b);
    const pC = formatProofPoint(proof.pi_c);

    // Format public signals as 32-byte arrays
    const formattedPublicSignals = publicSignals.map((s: string) =>
        formatFieldElement(s)
    );

    return {
        proofA: pA,
        proofB: pB,
        proofC: pC,
        publicInputs: formattedPublicSignals
    };
}

async function negateProofPoints(a: string[]) {
    // We need to negate the G1 point 'a'.
    // In BN254, negation of (x, y) is (x, p - y).
    // The groth16-solana library provides utility or we can do it manually.
    // For this MVP, we will assume a simple negation logic.
    const p = BigInt("21888242871839275222246405745257275088696311157297823662689037894645226208583");
    const x = BigInt(a[0]).toString(16).padStart(64, '0');
    const y = (p - BigInt(a[1])).toString(16).padStart(64, '0');

    return Buffer.concat([
        Buffer.from(x, "hex"),
        Buffer.from(y, "hex")
    ]);
}

function formatProofPoint(p: string[]) {
    const x = BigInt(p[0]).toString(16).padStart(64, '0');
    const y = BigInt(p[1]).toString(16).padStart(64, '0');
    return Buffer.concat([
        Buffer.from(x, "hex"),
        Buffer.from(y, "hex")
    ]);
}

function formatProofB(b: string[][]) {
    // b is [[x_re, x_im], [y_re, y_im], [1, 0]]
    // Expected order for groth16-solana: [x1, x0, y1, y0] per element
    // Actually, based on our convert_vk.js: [g2[0][1], g2[0][0], g2[1][1], g2[1][0]]
    const parts = [
        BigInt(b[0][1]), BigInt(b[0][0]),
        BigInt(b[1][1]), BigInt(b[1][0])
    ];

    const buffers = parts.map(p => Buffer.from(p.toString(16).padStart(64, '0'), "hex"));
    return Buffer.concat(buffers);
}

function formatFieldElement(s: string) {
    return Buffer.from(BigInt(s).toString(16).padStart(64, '0'), "hex");
}
