om# WIP

We'll verify a Merkle proof with our rom

inputs: [leaf1, leaf2, node, node, node..., expectedRoot]

The verification by the Main SM of the digest of a Poseidon hash is done in two steps: first, we verify the _computation_ of the hash inside the Poseidon SM; second, we verify that the digest of this hash is a 256-bit number by use of the Binary SM. To make such a range check we only need to use a single opcode (either `ADD` or `SUB`).

To minimize the proving time, we will only precommit to the `AND` lookup tables in this example. This in turn reduces the Binary SM requirements in minimum execution trace size, to $2^{17}$ rows. We will take advantage of this smaller proving time to also introduce the concepts of **proof recursion and aggregation**.

Within the Polygon zkEVM, the [Poseidon](https://www.poseidon-hash.info/) hash is used for constructing the storage tree. Note however, that the Merkle tree implementation covered here does not match that of the [Storage SM](https://hackmd.io/bbknowuiQxm3xrgWOt890g), and simply serves as a demonstration of what it looks like.

Unlike the Binary SM, where the corresponding counter, `cntBinary`, increases by $1$ every time a binary lookup is performed, the corresponding counters for the Poseidon SM, `cntPoseidonG` and `cntPaddingPG`, increase by $1$ for every chunk of $32$ bytes that gets hashed.

# Running the State Machine

Running the setup phase: compiling the ROM and generating the constant polynomials:

```
    node src/main_buildconstants.js -p pil/main.pil -r rom/merkle-proof.zkasm -o build/hashp.const
```

Running the executor: filling up the executiont trace:

```
    node src/main_executor.js rom/input.json -p pil/main.pil -r rom/merkle-proof.zkasm -o build/hashp.commit
```

Verifying the PIL execution trace:

```
    node ../node_modules/pilcom/src/main_pilverifier.js build/hashp.commit -p pil/main.pil -c build/hashp.const
```

Getting STARK info: 

```
    node ../node_modules/pil-stark/src/main_genstarkinfo.js -p pil/main.pil -s hashp.starkstruct.json -i build/hashp.starkinfo.json
```

Building the constant tree:

```
    node ../node_modules/pil-stark/src/main_buildconsttree -c build/hashp.const -p pil/main.pil -s hashp.starkstruct.json -t build/hashp.consttree -v build/hashp.verkey.json
```

Generating the proof:

```
    node ../node_modules/pil-stark/src/main_prover.js -m build/hashp.commit  -c build/hashp.const -t build/hashp.consttree -p pil/main.pil -s build/hashp.starkinfo.json -o build/hashp.proof.json -z build/hashp.zkin.proof.json -b build/hashp.public.json
```

Verifying the proof: 

```
    node ../node_modules/pil-stark/src/main_verifier.js -p pil/main.pil -s build/hashp.starkinfo.json -o build/hashp.proof.json -b build/hashp.public.json -v build/hashp.verkey.json
```