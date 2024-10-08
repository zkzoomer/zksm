# zkSM

Simple state machines designed using the [PIL](https://github.com/0xPolygonHermez/pilcom) and [zkASM](https://github.com/0xPolygonHermez/zkasmcom) languages from the [Polygon zkEVM](https://github.com/0xPolygonHermez).

## Setup 

Install the necessary packages by doing:

```
npm install
```

These include the following language packages needed for defining a zero-knowledge state machine:

- PIL: We describe the computations of any state machine inside `.pil` files. We use [PILCOM](https://github.com/0xPolygonHermez/pilcom) to compile them into a parsed version (in `.json` format) that can be interpreted by other software components.

- zkASM: We use the ZK Assembly Language to describe the ROM of our processor, which tells the executor how to interpret the different kinds of transactions that it could possibly receive as an input. We use the [zkASM Compiler](https://github.com/0xPolygonHermez/zkasmcom) to compile these descriptions in the form of a `.zkasm` into a parsed version (in `.json` format) ready for the executor to interpret.

## Overview
Within the [Polygon zkEVM](https://github.com/0xPolygonHermez), transactions are verified by the [zkProver](https://github.com/0xPolygonHermez/zkevm-prover) component, which enforces all rules for a transaction to be valid: constraints that a transaction must follow to be able to modify the state tree or the exit tree.

The zkProver is just a series of State Machines, where the Main State Machine delegates tasks to other specialist State Machines: Keccak Function SM, Arithmetic SM, Memory SM... This is achieved by using two new programming languages:

- [Zero-Knowledge Assembly](https://github.com/0xPolygonHermez/zkasmcom): Specifically designed to map instructions from the Main State Machine to other State Machines, specifying how they must carry out calculations. 

- [Polynomial Identity Language](https://github.com/0xPolygonHermez/pilcom): Used to verify that state transitions in State Machines satisfy computation-specific polynomial identities, transforming calculations into some polynomial language.

Each specialist SM consists of its own executor and PIL program, so the correct execution of instructions coming from the Main SM can be verified. 

## Design Approach
We use State Machines as they are best suited for **iterative deterministic computations**. Arithmetic circuits can enforce the same transaction validity logic, but need loops to be unrolled and inevitably result in larger circuits. We design this State Machine as follows:
- Turn the deterministic computation into a SM computation.
- Describe the state transitions as algebraic constraints: rules that every state transition must satisfy.
- Interpolate between state values to build the polynomials that describe the state machine.
- Define polynomial identities that all state values must satisfy.

## State Machine Basics
A State Machine is composed of **registries** that carry numerical values, called **registry values**, which at any given point constitute the **state** of the State Machine.

A state transition in a SM occurs at every tick of the clock. The SM is defined by the rules that determine how one state transitions to the next one. We can use a SM to execute a deterministic computation, and in turn produce verifiable proofs of its correctness. 

The **execution trace** is the record of all its registry values, and is represented as a table: where each row represents a state, and each column represents a variable (that is later encoded into a polynomial). Often we deal with a total of $T + 1$ states, where $T + 1$ is a power of $2$.

## How to Use this Repository

This repository serves as a **crash course on designing ZK State Machines** using the Polygon zkEVM tech stack. It contains examples of different ZK State Machines, each introducing and explaining new concepts or design patterns in detail. The recommended order to follow when checking out these examples is:

- [mFibonacci](./mfibonacci/): The Multiplicative Fibonacci SM serves as a "Hello World" example for a zkSM design.
- [generic](./generic/): We expand on the previous example and introduce the basic components of a generic state machine, which can be instantiated with various computations.
- [binary](./binary/): We introduce the concept of secondary state machines and how to link them to our main state machine via plookups. We define a secondary state machine to perform binary operations, improving the functionality of our previous generic state machine and also extending on its conditional execution capabilities.
- [hashing](./hashing): We design a state machine that can encode all inputs that are sent to it into a single value using a hash function. We also take the opportunity to introduce recursive verification of state machine proofs, compressing and aggregating several of these proofs to arrive at a single final proof.
- [sigVerifier](./sigVerifier/): After establishing how we can define conditional statements, loops, and secondary state machines, we design a state machine that can verify an arbitrary number of ECDSA signatures. Note how this is a fundamental building block when constructing a layer 2. 
- [storage](./storage): Another fundamental building block when constructing a layer 2, we design and implement a Merkle-tree based storage model which handles all storage-related computations: Create, Read, Update, and Delete.
