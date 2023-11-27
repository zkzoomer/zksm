const { hashContractBytecode, string2fea, fea2scalar } = require('@0xpolygonhermez/zkevm-commonjs/src/smt-utils');
const { byteArray2HexString } = require('@0xpolygonhermez/zkevm-commonjs/src/utils');
const { Scalar } = require('ffjavascript');
var fs = require('fs');
const buildPoseidon = require("@0xpolygonhermez/zkevm-commonjs").getPoseidon;

function hex2scalarString(Fr, hex) {
    return fea2scalar(Fr, string2fea(Fr, hex)).toString();
};

function scalar2bytes(Fr, scalar) {
    scalar = Scalar.e(scalar);
    let bytes = []

    for (let i = 31; i >= 0; i--) {
        bytes.push(
            Fr.e(Scalar.band(Scalar.shr(scalar, 8 * i), Scalar.e('0xFF')))
        );
    };

    return bytes;
};

async function pairwiseHash(a, b) {
    const poseidon = await buildPoseidon();
    const Fr = poseidon.F;

    let data = scalar2bytes(Fr, a);
    data = [...data, ...scalar2bytes(Fr, b)];

    const digest = await hashContractBytecode(byteArray2HexString(data));

    return digest;
};

// Generates a Merkle proof given the height of the tree and its leaves, outputs a file to be used as input
// Uses a sparse Merkle tree model
async function getMerkleProof (
    merkleTreeHeight,
    emptyLeafPreimage,
    filledLeavesPreimages,
    leafIndex,
    arity = 2
) {
    const poseidon = await buildPoseidon();
    const Fr = poseidon.F;

    const emptyLeaf = await hashContractBytecode(byteArray2HexString(scalar2bytes(Fr, emptyLeafPreimage)));

    let hashedLeaves = new Array(1 << merkleTreeHeight).fill(emptyLeaf);

    for (let i = 0; i < filledLeavesPreimages.length; i++) {
        const leaf = await hashContractBytecode(byteArray2HexString(scalar2bytes(Fr, filledLeavesPreimages[i])));
        hashedLeaves[i] = leaf;
    };

    let nodes = [[...hashedLeaves]];
    let pathValues = [];
    let pathIndices = [];

    for (let level = 0; level < merkleTreeHeight; level++) {
        const nextLevelNodes = [];

        for (let i = 0; i < nodes[level].length; i = i + 2) {
            const node = await pairwiseHash(nodes[level][i], nodes[level][i + 1]);
            nextLevelNodes.push(node);
        };

        nodes.push(nextLevelNodes);

        const position = leafIndex % arity;
        const levelStartIndex = leafIndex - position;
        const levelEndIndex = levelStartIndex + arity;

        pathIndices[level] = position;

        for (let i = levelStartIndex; i < levelEndIndex; i += 1) {
            if (i !== leafIndex) {
                if (i < nodes[level].length) {
                    pathValues[level] = hex2scalarString(Fr, nodes[level][i]);
                } else {
                    pathValues[level] = hex2scalarString(Fr, zeroes[level]);
                };
            };
        };

        leafIndex = Math.floor(leafIndex / arity);
    };

    const returnJson = { 
        merkleTreeHeight, 
        merkleTreeRoot: hex2scalarString(Fr, nodes[merkleTreeHeight][0]), 
        leafValue: hex2scalarString(Fr, nodes[0][leafIndex]), 
        pathIndices, 
        pathValues 
    };
    
    return returnJson
};

const merkleTreeHeight = 10;
const emptyLeaf = 0;
const filledLeaves = [350,250];
const leafIndex = 0;

getMerkleProof(
    merkleTreeHeight,
    emptyLeaf,
    filledLeaves,
    leafIndex
).then( (merkleProof) => {
    fs.writeFileSync("./rom/input.json", JSON.stringify(merkleProof));
});
