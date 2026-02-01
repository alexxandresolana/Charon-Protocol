pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";

template HeirVerifier() {
    // Private input: the password (preimage)
    signal input preimage;
    
    // Public input: the stored hash (commitment)
    signal input commitment;

    // Instance of Poseidon hash with 1 input
    component hasher = Poseidon(1);
    hasher.inputs[0] <== preimage;

    // Constraint: Poseidon(preimage) must equal the commitment
    commitment === hasher.out;
}

component main {public [commitment]} = HeirVerifier();
