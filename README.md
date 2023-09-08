# zkSM

Simple state machines designed using the [PIL](https://github.com/0xPolygonHermez/pilcom) and [zkASM](https://github.com/0xPolygonHermez/zkasmcom) languages from the [Polygon zkEVM](https://github.com/0xPolygonHermez)

## Setup 

Install the necessary packages by doing:

```
npm install
```

We describe the computations of any state machine inside `.pil` files. We use [PILCOM](https://github.com/0xPolygonHermez/pilcom) to compile them into a parsed version (in `.json` format) that can be interpreted by other software components. You can install PILCOM by cloning the repo directly inside this one:

```
git clone https://github.com/0xPolygonHermez/pilcom
```

And then installing the module and building the parser:

```
cd pilcom
npm install
npm run build
```

## Examples

This repository contains examples of different zk-State Machines:
- [mFibonacci](./mfibonacci/): The Multiplicative Fibonacci SM serves as a "Hello World" example for a zkSM design.

## Overview
Within the [Polygon zkEVM](https://github.com/0xPolygonHermez), transactions are verified by the [zkProver](https://github.com/0xPolygonHermez/zkevm-prover) component, which enforces all rules for a transaction to be valid: constraints that a transaction must follow to be able to modify the state tree or the exit tree.

The zkProver is just a series of State Machines, where the Main State Machine delegates tasks to other specialist State Machines: Keccak Function SM, Arithmetic SM, Memory SM... This is achieved by using two new programming languages:

- [Zero-Knowledge Assembly](https://github.com/0xPolygonHermez/zkasmcom): Specifically designed to map instructions from the Main State Machine to other State Machines, specifying how they must carry out calculations. 

- [Polynomial Identity Language](https://github.com/0xPolygonHermez/zkevm-prover): Used to verify that state transitions in State Machines satisfy computation-specific polynomial identities, transforming calculations into some polynomial language.

Each specialist SM consists of its own executor and PIL program, so the correct execution of instructions coming from the Main SM can be verified. 

## Design Approach
We use State Machines as they are best suited for **iterative deterministic computations**. Arithmetic circuits can enforce the same transaction validity logic, but need loops to be unrolled and inevitably result in larger circuits. We design this State Machine as follows:
- Turn the deterministic computation into a SM computation.
- Describe the state transitions as algebraic constraints: rules that every state transition must satisfy.
- Interpolate between state values to build the polynomials that describe the state machine.
- Define polynomial identities that all state values must satisfy.
Which are called the arithmetization steps.

## State Machine Basics
A State Machine is composed of **registries** that carry numerical values, called **registry values**, which at any given point constitute the **state** of the State Machine.

A state transition in a SM occurs at every tick of the clock. The SM is defined by the rules that determine how oone state transitions to the next one. We can use a SM to execute a deterministic computation, and in turn produce verifiable proofs of its correctness. 

The **execution trace** is the record of all its registry valeus, and is represented as a table, where each row represents a state, and each column represents a variable (that is later encoded into a polynomial). Often we deal with a total of $T + 1$ states, where $T + 1$ is a power of $2$.
