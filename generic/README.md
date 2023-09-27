# Introduction to Generic State Machines

We will look to extend on the definition of the [mFibonacci State Machine](../mfibonacci/) and now describe a generic SM that can be instantiated with various computations of the user's choice.

This new SM will receive instructions in the form of programs written in [zkASM](https://github.com/0xPolygonHermez/zkasmcom), and carry out state transitions at every clock cycle according to these instructions.

In the figure below, we see such state machine, with registries $A$ and $B$, and a state ($A^i$, $B^i$), that changes to another state ($A^{i+1}$, $B^{i+1}$) in accordance with two instructions $Instruction_i$, and $Instruction_{i+1}$.

<p align="center">
    <img src="https://wiki.polygon.technology/assets/images/gen1-typical-gen-sm-bec05492bb86d81a202e8de5ff6b2dec.png" />
</p>

>*Source: [Polygon zkEVM Pre-Specs, Generic SM](https://wiki.polygon.technology/docs/zkevm/zkProver/intro-generic-sm/)*

Our SM is composed of two parts, each fulfilling a different task:
- **Generating the execution trace**, which is achieved by using the Zero-Knowledge Assembly language, [zkASM](https://github.com/0xPolygonHermez/zkasmcom).
- **Verifying execution correctness**, by enforcing a set of arithmetic constraints that every correctly generated execution trace must satisfy. These arithmetic constraints are described with the Polynomial Identity Language, [PIL](https://github.com/0xPolygonHermez/pilcom).

## Generic SM Executor

Instead of programming the SM executor to carry out a specific set of instructions (as we did for the [mFibonacci SM](../mfibonacci/)), a generic SM reads arbitrary instructions encapsulated in some program written in zkASM.

The executor produces the execution trace for the program given, where each state transition is captured in full for each instruction (that is, for each row of the execution trace). 

For our example, we will design a generic SM that can interpret four kinds of instructions. An example of these in action is:

|       Instructions          | $FREE$ | $CONST$ | $A$ | $A'$ | $B$ | $B'$ |
|-----------------------------|--------|---------|-----|------|-----|------|
| ${$getFreeInput()$} => $A$  |    7   |    0    |  0  |   7  |  0  |   0  |
|           3 => B            |    0   |    3    |  7  |   7  |  0  |   3  |
|           : ADD             |    0   |    0    |  7  |  10  |  3  |   3  |
|           : END             |    0   |    0    |  10 |   0  |  3  |   0  |

We will call this table **Example A**. Another possible such table, **Example B** is:

|       Instructions          | $FREE$ | $CONST$ | $A$ | $A'$ | $B$ | $B'$ |
|-----------------------------|--------|---------|-----|------|-----|------|
|           5 => B            |    0   |    5    |  0  |   0  |  0  |   5  |
| ${$getFreeInput()$} => $A$  |    2   |    0    |  0  |   2  |  5  |   5  |
|           : ADD             |    0   |    0    |  2  |   7  |  5  |   5  |
|           : END             |    0   |    0    |  7  |   0  |  5  |   0  |

## Ensuring Execution Trace Correctness

We will need to define a set of arithmetic constraints that only hold true when the execution trace is correct. These are equations between registry values in any two consecutive rows: representing the next state, ($A'$, $B'$), in terms of the current state, ($A$, $B$).

To this end, we will need auxiliary columns for **selectors**, that will have a value $1$ (ON) or $0$ (OFF), depending on the instruction being executed.

For our four-instruction State Machine, these selectors will be $inFREE$, $inA$, $inB$, $setA$, and $setB$:

- If the instruction being executed involves the column $A$, then the selector $inA$ must have the value $1$, otherwise it should be $0$. The same applies for column $B$ and selector $inB$; and for column $FREE$ and selector $inFREE$.
- If the instruction being executed moves the result of the computation into column $A'$, then the selector $setA$ must have the value $1$, otherwise it should be $0$. The same applies for column $B'$ and selector $setB$.

Notice that $CONST$ does not require a selector: if a computation constant is not needed for an instruction, the value for $CONST$ is simply set to $0$.

We can now define the arithmetic constraints for our four-instruction State Machine as:

$$
    A' = A + setA \cdot (inA \cdot A + inB \cdot B + inFREE \cdot FREE + CONST - A)
$$

$$
    B' = B + setB \cdot (inA \cdot A + inB \cdot B + inFREE \cdot FREE + CONST - B)
$$

Which get expressed as polynomial identities:

$$
    A(\textrm{x}\omega) - (A(\textrm{x}) + setA(\textrm{x}) \cdot (op(\textrm{x}) - A(\textrm{x}))) = 0
$$

$$
    B(\textrm{x}\omega) - (B(\textrm{x}) + setB(\textrm{x}) \cdot (op(\textrm{x}) - B(\textrm{x}))) = 0
$$

where $ op(\textrm{x}) = inA(\textrm{x}) + inB(\textrm{x}) \cdot B(\textrm{x}) + inFREE(\textrm{x}) \cdot FREE(\textrm{x}) + CONST (\textrm{x}) $

Testing that these arithmetic constraints do indeed represent the four instructions of our program is left as an exercise to the reader (or you can check the [Polygon documentation](https://wiki.polygon.technology/docs/zkevm/zkProver/exec-trace-correct/#testing-arithmetic-constraints) for more details).

For our example, we designed a generic SM that can interpret four kinds of instructions. Adding these selector polynomials for our **Example A** will look like:

|       Instructions          | $FREE$ | $CONST$ | $setA$ | $setB$ | $inFREE$ | $inA$ | $inB$ | $A$ | $A'$ | $B$ | $B'$ |
|-----------------------------|--------|---------|--------|--------|----------|-------|-------|-----|------|-----|------|
| ${$getFreeInput()$} => $A$  |    7   |    0    |    1   |    0   |     1    |   0   |   0   |  0  |   7  |  0  |   0  |
|           3 => B            |    0   |    3    |    0   |    1   |     0    |   0   |   0   |  7  |   7  |  0  |   3  |
|           : ADD             |    0   |    0    |    1   |    0   |     0    |   1   |   1   |  7  |  10  |  3  |   3  |
|           : END             |    0   |    0    |    1   |    1   |     0    |   0   |   0   |  10 |   0  |  3  |   0  |

While for our **Example B** we will have:

|       Instructions          | $FREE$ | $CONST$ | $setA$ | $setB$ | $inFREE$ | $inA$ | $inB$ | $A$ | $A'$ | $B$ | $B'$ |
|-----------------------------|--------|---------|--------|--------|----------|-------|-------|-----|------|-----|------|
|           5 => B            |    0   |    5    |    0   |    1   |     0    |   0   |   0   |  0  |   0  |  0  |   5  |
| ${$getFreeInput()$} => $A$  |    2   |    0    |    1   |    0   |     1    |   0   |   0   |  0  |   2  |  5  |   5  |
|           : ADD             |    0   |    0    |    1   |    0   |     0    |   1   |   1   |  2  |   7  |  5  |   5  |
|           : END             |    0   |    0    |    1   |    1   |     0    |   0   |   0   |  7  |   0  |  5  |   0  |

Regarding **boundary constraints**, for this example we will make both the free input ($input$) and the last registry value of $A$ ($output$) public by setting:

$$
\textrm{L1}(\textrm{x}) \cdot (FREE(\omega^0) - input) = 0
$$

$$
\textrm{L4}(\textrm{x}) \cdot (A(\omega^3) - input) = 0
$$

where $\textrm{L1} = [1, 0, 0, 0]$ and $\textrm{L4} = [0, 0, 0, 1]$ are the first and fourth Lagrange polynomials, which are precomputed constant polynomials.

All the operations in the constraints are carried out $modulo$ the order $p$ of the prime field. The **Goldilocks-like Field**, with $p = 2^{64} - 2^{32} + 1$, is mainly used when dealing with 64-bit numbers. Otherwise we make use of the [BN128 field](https://iden3-docs.readthedocs.io/en/latest/iden3_repos/research/publications/zkproof-standards-workshop-2/baby-jubjub/baby-jubjub.html).

<!-- ## Running the Generic State Machine

The file [`generic.pil`](./generic.pil) describes the SM executor for our example


Note that we do not specify an input file as the registry values are hardcoded for this example -->

## Dealing With Negative Numbers

Since all values of the execution trace belong to the field $\mathbb{F}_p$, where $p = 2^{64} - 2^{32} + 1$, we will represent a given negative value $-a$ instead as $p - a$.

## State Machines With Jumps

The Fast Fourier Transforms that we will use over these registry polynomials are most efficient for those with degree $T + 1 = 2^N$ (meaning the number of rows of our execution trace is a power of $2$). In this section we will cover the question: how do we end the program when the trace has size *lower* the size of our polynomials? The resulting execution trace should still preserve the cyclicity properties.

State Machines with jumps introduce additional dynamics to the executor's output, as the instructions are not sequentially executed. More checks need to be added so that the state machine can properly prove correct behaviour:

- Every operation being executed needs to be checked to see if it is the correct one, and not a different operation.
- The operation execution sequence must be in accordance with the instructions in the zkASM program, which is not necessarily the usual chronological sequence of the lines of code.
- Program ending needs to also be managed, as the length of the execution trace is no longer constant.
- All public values must be in the expected positions, and thus placed at known steps. Usually this is either at the first or last positions of the polynomial.
- Due to the dynamic execution trace, we need to check if the instruction being executed belongs to the program in the first place, for which we use [Plookup](https://eprint.iacr.org/2020/315.pdf).

## Tracking the Program Counter

We will define a new registry, the Program Counter $zkPC$, to keep track of which line of the program is currently being executed. It contains at each clock cycle the line in the zkASM program of the instruction being executed.

In the figure below, we see the resulting state machine, with registries $A$, $B$, and $zkPC$, and a state ($A^i$, $B^i$, $zkPC^i$), that changes to another state ($A^{i+1}$, $B^{i+1}$, $zkPC^{i+1}$) in accordance with two instructions $Instruction_i$, and $Instruction_{i+1}$.

<p align="center">
    <img src="https://wiki.polygon.technology/assets/images/gen7-state-machine-w-zkpc-f87159ef51a68ce13321876a226c80d0.png" />
</p>

>*Source: [Polygon zkEVM Pre-Specs, Generic SM](https://wiki.polygon.technology/docs/zkevm/zkProver/program-counter/#checking-sequence-of-instructions)*

We will also allow two new instructions in zkASM:
- $JPMZ(addr)$, a conditional jump to the given line.
- $JMP(addr)$, a jump to the given line.

#### Constraining the Program Counter -- $JMP$

We will use the following identity to keep track of the correct line of the assembly program to be executed next:

$$
    zkPC' = (zkPC + 1) + JMP \cdot (addr - (zkPC + 1))
$$

#### Constraining the Program Counter -- $JMPZ$

The $JMPZ(addr)$ instruction will be executed only on condition that $op$ is zero, and so we will introduce the flag $isZero$:

$$
    isZero = 1 \textrm{ if } op = 0\textrm{, else }isZero = 0\textrm{; and so we have: }isZero \cdot op = 0
$$

We will use the following identity to keep track of the correct line of the assembly program to be executed next:

$$
    zkPC' = (zkPC + 1) + (JMPZ \cdot isZero) \cdot (addr - (zkPC + 1))
$$

#### Constraining the Program Counter -- $JMP$ and $JPMZ$

We can merge these constraints as follow:

$$
    isZero := (1 - op \cdot op^{-1}),
$$

$$
    isZero \cdot op = 0,
$$

$$
    doJMP := JMPZ \cdot isZero + JMP,
$$

$$
    zkPC' = (zkPC + 1) + doJMP \cdot (addr - (zkPC + 1))
$$

Where $addr$ is defined as an intermediate polynomial, $addr := offset$, where $offset$ is provided as part of the jump instruction.

We will therefore have the following different columns in the execution trace: $zkPC$, $JMP$, $JMPZ$, $invOp$, and $offset$.

## Ending the Program

To properly end our programs, we need to ensure that the execution trace being generated from the assembly is cyclic.

To ensure cyclicity, we use a loop while the current line is less than $T$, that is, a step before the last step of the execution trace, which has $T + 1$ rows. On the final row we will jump back to the start via $JMP(start)$. A program with this loop can take the following shape:

```
start:  ; main entry point of our machine
    ${getFreeInput()} => A
    -3 => B
    $ => A              :ADD
    A                   :JMPZ(finalWait)  ; jumps on condition that A is 0
    $ => A              :ADD

finalWait:  ; final loop for the cycle
    ${beforeLast()}     :JMPZ(finalWait)
    0 => A, B           :JMP(start)
```

So until we are on the second to last line in the execution trace, the program will keep looping, and jump back to the start in the final line. By using these jumps, we create a loop in our execution, so values are retained until the exeuction trace is in the second-to-last row, achieving cyclicity. The result of the computation is reflected in the last position of the registries.

## Plookup

Within the zkEVM, the Main SM executor sends various instructions to secondary state machines within the [zkProver](https://github.com/0xPolygonHermez/zkevm-prover). These secondary SM specialize in specific computations, and frequently use [Plookup](https://eprint.iacr.org/2020/315.pdf) to complete tasks mandated by the Main SM executor.

Plookup instructions appear in the PIL codes of SMs in the zkEVM, and they are used to ensure that certain output values are included in a given lookup table: verifying set inclusion.

As we have covered, we use some polynomials to define instructions: $CONST$, $inA$, $inB$, $inFREE$, $setA$, $setB$, $JMP$, $JMPZ$, $offset$, $line$, ... while others are used only during execution, and thus do not form part of the instructions: $A$, $B$, $FREE$, $invOp$, ...

When verifying correct execution, we can use Plookup to check if the combination of commited polynomials, 

$$
    { CONST, inA, inB, inFREE, setA, setB, JMP, JMPZ, offset, zkPC }
$$

is one of the valid combinations of ROM instructions,

$$
    { Rom.CONST, Rom.inA, Rom.inB, Rom.inFree, Rom.setA, Rom.setB, Rom.JMP, Rom.JMPZ, Rom.offset, Rom.line }
$$

Where we recall that the equivalent for the $zkPC$ in the ROM is the $line$. This check is performed row-wise, meaning by use of the following snippet of `zkasm` code:

```
    {CONST, inA, inB, inFREE, setA, setB, JMPZ, offset, zkPC} in 
        {Rom.CONST, Rom.inA, Rom.inB, Rom.inFREE, Rom.setA, Rom.setB, Rom.JMPZ, Rom.jmpAddr, Rom.line};
```

Where we are ensuring that, for each row of our execution trace, the tuple $(CONST, inA, inB, inFREE, setA, setB, JMP, JMPZ, offset, zkPC)$ is contained in the ROM table. Enforcing constraints between the ROM polynomials is not needed, as they are constant and publicly known.

# Running the State Machine

Compiling of the `zkasm` and `pil` files, as well as generating and verifying the STARK proof is all done from the [`executor.js`](./executor.js) file. To run the whole process run the command:

```
node executor.js [freeInput] [romFile]
```

Where `freeInput` is the free input value that is given to the state machine, and `romFile` is a valid ROM that uses the instruction set supported by our `pil` file.
