# Multiplicative Fibonacci State Machine

The multiplicative Fibonacci series (or *mFibonacci*) has the property that the product of every two consecutive members, $a_{i-1}$ and $a_i$, gives the value of the next member, $a_{i+1}$. Our goal will be to prove the set of initial values, $a_0$ and $a_1$, that result in a given $a_n$, the $n$th member of the mFibonacci series.

## Defining a State Machine

> This section summarizes the basic concepts for our state machine, which are covered in more technical detail inside the original [mFibonacci State Machine Example](https://wiki.polygon.technology/docs/category/mfibonacci-sm/)

We define the registries $A = [A_0, A_1, ..., A_T]$ and $B = [B_0, B_1, ..., B_T]$ such that the $i$-th state is the pair $(A_i, B_i)$. These registry values must additionally conform to the format of the *mFibonacci* series, so the state transition from $S = (A_i, B_i)$ to $S' = (A_{i+1}, B_{i+1})$  satisfies that:

$$
A_{i+1} = B_i
$$
$$
B_{i+1} = A_i \cdot B_i
$$

We can express the evolution of this execution trace in terms of polynomials, which we can later use to construct a ZK proving scheme to verify the correct execution of our SM.

We will additionally append an extra registry, $C = [C_0, C_1, ..., C_T]$, and set it to $C = [0, 0, ..., 0, 1]$ in order to [introduce cyclicity](https://wiki.polygon.technology/docs/zkevm/zkProver/mfibonacci-example/#introducing-cyclicity). The full execution trace will take a shape as follows:

<p align="center">
    <img src="https://wiki.polygon.technology/assets/images/fib7-mfibon-sm-3-regs-3403300aad4f06109f0d5a5899df3599.png" />
</p>

>*Source: [Polygon zkEVM Pre-Specs, mFibonacci SM](https://wiki.polygon.technology/docs/zkevm/zkProver/mfibonacci-example/#introducing-cyclicity)*

In addition to these transition constraints between states, we also have **boundary constraints**, which enforce that a polynomial has a certain value at a particular root of unity. In this case, this is used to enforce that the prover did compute the $n$-th term of the *mFibonacci* series.

## PIL-STARK Process Description

There are three phases for the PIL-STARK process: setup, proving and verification.

### PIL-STARK Setup Phase

There are three distinct components: the [PILCOM step](#compilation-with-pilcom), the [Setup Executor step](#the-setup-executor), and the final [PIL-STARK Setup step](#pil-stark-setup). 

#### Compilation with PILCOM 

We use [PILCOM](https://github.com/0xPolygonHermez/pilcom) to compile the [`mfibonacci.pil`](./mfibonacci.pil) file, which describes the computations of our *mFibonacci* state machine. After compilation, we obtain a [parsed version in `.json` format](./mfibonacci.pil.json), which can then be interpreted by other software components.

After [installing PILCOM](../README.md#setup), we can compile the [`mfibonacci.pil`](./mfibonacci.pil) file from this directory by running:

```
node ../pilcom/src/pil.js mfibonacci.pil -o mfibonacci.pil.json
```

The output on the terminal provides information on the number of constant and committed polynomials used, the number of polynomial identities to be checked, as well as other information which will become relevant in later examples. The resulting file contains different keys describing the polynomials and the relations between them, which are useful for debugging purposes.

#### The Setup Executor

This component computes the evaluation of the State Machine's constant polynomials. This execution process is therefore only carried once.

In our case, we only have one constant polynomial, `ISLAST`, and this setup executor will correspond to the `buildConstants` function inside the file [`executor_mfibonacci.js`](./executor_mfibonacci.js).

#### PIL-STARK Setup

This process takes as input the PIL `.json` file result of the [compilation step](#compilation-with-pilcom), the evaluations of the constant polynomials from the [setup executor](#the-setup-executor), and the STARK configuration information in the form of a `starkstruct.json` file. 

In our case, the STARK configuration can be found in the file [`mfibonacci.starkstruct.json`](./mfibonacci.starkstruct.json).

This setup step will output the `constTree`, which is a Merkle tree of evaluations of the constant polynomials; the `starkInfo`, which is STARK-specific information; and the `constRoot`, which is the root of the `constTree`.

### PIL-STARK Proving Phase

It consists of two main components: the [SM-Prover Executor](#the-sm-provers-executor), which assigns values to the remaining polynomials; and the [PIL-STARK proof generator](#pil-stark-proof-generator).

#### The SM-Prover's Executor

This process will build the values of the polynomials that are to be committed to. To this end, it will take in as inputs the `.json` file result of the [compilation step](#compilation-with-pilcom), plus an additional `input.json` file including the initial values of all the polynomials involved. These inputs can be changed without altering the underlying SM logic: the compiled `.pil` file stays the same. At the same time, each new set of inputs determines a new STARK proof.

In our case, this input file can be found under [`mfibonacci.input.json`](./mfibonacci.input.json), which includes the initial values for the registries `A` and `B`; and the prover executor will correspond to the `execute` function inside the file [`executor_mfibonacci.js`](./executor_mfibonacci.js).

> We can therefore think of the **Executor** as a single program generating the evaluations of both the constant and committed polynomials.


#### PIL-STARK Proof Generator

The proof generation step requires as inputs the evaluations of both the constant polynomials (from the [setup executor step](#the-setup-executor)) and the committed polynomials (from the previous [executor step](#the-sm-provers-executor)); together with the `constTree` and the `starkInfo`.

In this step, the evaluations of the committed polynomials get *Merkle-lized*. All remaining elements of the STARK proof also get generated: the witness and the required openings of the committed polynomials. 

The output of the STARK proof generator is a STARK proof alongside the public inputs that are linked to the proof.

### PIL-STARK Verification Phase

The verifier will take as inputs the STARK proof and public inputs from the [prover](#pil-stark-proof-generator), as well as the `starkInfo` and `constRoot` from the [setup phase](#pil-stark-setup). 

The verifier will then either **Accept** or **Reject** the proof.

In our case, both proof generation and verification are carried out in the same file: [`mfibonacci_gen_and_prove.js`](./mfibonacci_gen_and_prove.js), which reports on all the checks made and afterwards verifies the proof. 

You can verify the whole process from this directory by running:

```
node mfibonacci_gen_and_prove.js
```

Which should print `VALID proof!` to the console.
