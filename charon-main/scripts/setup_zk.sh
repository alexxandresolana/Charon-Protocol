#!/bin/bash

# Exit on error
set -e

# Directory for circuits (relative to project root)
CIRCUIT_DIR="circuits"
BUILD_DIR="circuits/build"
PTAU_FILE="$BUILD_DIR/powersOfTau28_hez_final_10.ptau"

# Create build directory if it doesn't exist
mkdir -p $BUILD_DIR

echo "--- Compiling Circuit ---"
circom $CIRCUIT_DIR/heir_verifier.circom --r1cs --wasm --sym --c -o $BUILD_DIR

echo "--- Checking for PTAU File ---"
if [ ! -f "$PTAU_FILE" ]; then
    echo "Downloading Powers of Tau file..."
    curl -L https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_10.ptau -o $PTAU_FILE
fi

echo "--- Generating Proving Key (Groth16) ---"
npx snarkjs groth16 setup $BUILD_DIR/heir_verifier.r1cs $PTAU_FILE $BUILD_DIR/heir_verifier_0000.zkey

echo "--- Phase 2: Contribution ---"
echo "test" | npx snarkjs zkey contribute $BUILD_DIR/heir_verifier_0000.zkey $BUILD_DIR/heir_verifier_final.zkey --name="First Contribution" -v

echo "--- Exporting Verifying Key ---"
npx snarkjs zkey export verificationkey $BUILD_DIR/heir_verifier_final.zkey $BUILD_DIR/verifying_key.json

echo "--- Done! Circuit compiled and keys generated in $BUILD_DIR ---"
