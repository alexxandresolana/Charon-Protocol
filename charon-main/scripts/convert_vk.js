const fs = require('fs');

const vk = JSON.parse(fs.readFileSync('circuits/build/verifying_key.json'));

const toByteArray = (hex, length) => {
    // hex can be a string starting with 0x or just decimal string
    let bigint = BigInt(hex);
    let hexStr = bigint.toString(16).padStart(length * 2, '0');
    const bytes = [];
    for (let i = 0; i < hexStr.length; i += 2) {
        bytes.push('0x' + hexStr.substr(i, 2));
    }
    return `[${bytes.join(', ')}]`;
};

const g1ToRust = (g1) => {
    // g1 is [x, y] in snarkjs
    // We concatenate them into a 64-byte array
    const x = BigInt(g1[0]).toString(16).padStart(64, '0');
    const y = BigInt(g1[1]).toString(16).padStart(64, '0');

    const bytes = [];
    for (let i = 0; i < x.length; i += 2) bytes.push('0x' + x.substr(i, 2));
    for (let i = 0; i < y.length; i += 2) bytes.push('0x' + y.substr(i, 2));

    return `[${bytes.join(', ')}]`;
};

const g2ToRust = (g2) => {
    // g2 is [[re, im], [re, im]] in snarkjs
    // Lib expects 128 bytes: [x_re, x_im, y_re, y_im] order usually?
    // Actually groth16-solana docs/examples usually show [x1, x0, y1, y0] which is [im, re, im, re] per element.
    // Let's follow the standard: [X, Y] where each is G2.
    // The previous successful research indicated: [g2[0][1], g2[0][0], g2[1][1], g2[1][0]]
    const parts = [g2[0][1], g2[0][0], g2[1][1], g2[1][0]];
    const bytes = [];
    parts.forEach(p => {
        const hex = BigInt(p).toString(16).padStart(64, '0');
        for (let i = 0; i < hex.length; i += 2) bytes.push('0x' + hex.substr(i, 2));
    });
    return `[${bytes.join(', ')}]`;
};

const rustContent = `
use groth16_solana::groth16::Groth16Verifyingkey;

pub const VERIFYING_KEY_IC: [[u8; 64]; ${vk.IC.length}] = [
    ${vk.IC.map(ic => g1ToRust(ic)).join(',\n    ')}
];

pub const VERIFYING_KEY: Groth16Verifyingkey = Groth16Verifyingkey {
    nr_pubinputs: ${vk.IC.length - 1},
    vk_alpha_g1: ${g1ToRust(vk.vk_alpha_1)},
    vk_beta_g2: ${g2ToRust(vk.vk_beta_2)},
    vk_gamme_g2: ${g2ToRust(vk.vk_gamma_2)},
    vk_delta_g2: ${g2ToRust(vk.vk_delta_2)},
    vk_ic: &VERIFYING_KEY_IC,
};
`;

console.log("Generating verifying_key.rs...");
fs.writeFileSync('programs/charon/src/verifying_key.rs', rustContent);
console.log("Done!");
