# Introduction to Secondary State Machines

We will look to extend on the definition of our [Generic State Machine](../generic/) by expanding the kinds of computations it can perform. To this end, we will define a secondary state machine that will perform a series of binary operations (`ADD`, `SUB`, `LT`, `SLT`, `EQ`, `AND`, `OR`, `XOR`, and `NOT`) over 256-bit numbers. This extended generic state machine will also receive instructions in the form of programs written in [zkASM](https://github.com/0xPolygonHermez/zkasmcom), and carry out state transitions at every clock cycle according to these instructions.

Instead of executing these operations on its own, the Main SM will delegate the verification of the binary operations to the secondary binary state machine. The two input values will be the ones stored inthe $A$ and $B$ registries. This architecture is similar to that one found in the [Polygon zkEVM](https://github.com/0xpolygonhermez), where the Binary SM is one of the six secondary state machines receiving instructions from the Main SM. 

For any secondary state machine we distinguish between two parts: an executor, tasked with filling the values of the execution trace, and an internal Binary SM PIL program, which establishes a set of verification rules.

## The Binary State Machine

The binary operations supported are `ADD`, `SUB`, `LT`, `SLT`, `EQ`, `AND`, `OR`, `XOR`, and `NOT`. These are all 256-bit operations, which are internally processed using 8 registries with 32-bit input/output capacity each. We use an opcode to select which of the binary operations is being selected.

Note how all these binary operations are natively supported by the [zkASM](https://github.com/0xPolygonHermez/zkasmcom) language. The 256-bit numbers are split into 8 different registries according to:

$$
\textbf{a} = a_{31}\cdot(2^8)^{31} \,+\, a_{30}\cdot(2^8)^{30} \,+\,...\,+\,a_{1}\cdot2^8= \sum_{i=31}^{0} a_i \cdot (2^8) ^i
$$

Where $a_i$ is a byte that can take values between $0$ and $2^8 - 1$. We will be dealing with **unsigned integers** when doing these binary operations. The only exception is the `SLT` operation, where numbers are considered to be represented in [two's complement notation](https://en.wikipedia.org/wiki/Two's_complement), with the most significant bit representing the sign. 

Operations are verified differently depending on the opcode being used, which is all covered inside the [`binary.pil`](./pil/binary.pil) file. The general scheme is as follows:

- Build and commit to a table that contains **all the possible 8-bit operations supported**: every possible combination of our 8-bit inputs with their corresponding outputs. Since this table is constant, its computation is performed as part of the setup step for our full state machine.
- Decompose the full 256-bit operation being carried out into bytes, and verify each byte separately: two per execution trace row for a total of 16 rows per cycle.
- Select the final result of the binary operation, making it available to the Main SM. 

The general process behind each of these steps is covered in the sections below.

## Building the Plookup Table — Setup Phase

Each 8-bit operation works differently, as some of them make use of additional variables, like a $carry$ value. Here we cover how each of the corresponding 8-bit computations are calculated and get precommitted to as part of the table.

#### Binary Operations

These correspond to the 
- `AND`, a bit-wise $AND$ of two numbers, 
- `OR`, a bit-wise $OR$ of two numbers,
- `XOR`, a bit-wise $XOR$ of two numbers, and 
- `NOT`, a bit-wise $NOT$ of a binary number
operations, which are carried out on a bit-by-bit basis: no use of a carry value is needed.

The byte-wise plookup table for these operations, which contains all possible results for each combination of two bytes, takes the shape:

|     OP    |   `BYTE_A`   |   `BYTE_B`   |   `BYTE_C`   |
|-----------|--------------|--------------|--------------|
| 5 (`AND`) | `0b00000000` | `0b00000000` | `0b00000000` |
|    ...    |      ...     |      ...     |      ...     |
| 5 (`AND`) | `0b11111111` | `0b10101010` | `0b10101010` |
|    ...    |      ...     |      ...     |      ...     |
|  6 (`OR`) | `0b01010101` | `0b10101010` | `0b11111111` |
|    ...    |      ...     |      ...     |      ...     |
| 7 (`XOR`) | `0b01010101` | `0b00110011` | `0b01100110` |

We use this plookup table for each of our 8-bit chunks, joining byte output values together to form each of our 32-bit registry output values. Note that the `NOT` operation is not directly supported, and can instead be implemented by applying the `XOR` operation on a given 256-bit value and `0xFF...FF`.

#### Addition Operation (`AND`)

This operation adds two 256-bit numbers. To verify an addition, we need to make use of a `carry` value that will _carry_ information from one 8-bit chunk to the next. This is done to avoid integer overflow between operations. As an example:

$$
    a = 0xFF, b = 0x01 \Rightarrow  c = a + b = 0xFF + 0x01 = 0x100 \Rightarrow c = 0x00, \textrm{carry} = 0x01
$$

Note therefore that we will have to use **two carry values**: one for the carry that we _receive_ from the previous byte, and one for the carry that we _send_ to the next byte. The byte-wise plookup table for the addition operation therefore includes both `carry` values, and takes the shape:

|   row  | `CARRY_IN` | `BYTE_A` | `BYTE_B` | `BYTE_C` | `CARRY_OUT` |
|--------|------------|----------|----------|----------|-------------|
|    1   |   `0x00`   |  `0x00`  |  `0x00`  |  `0x00`  |   `0x00`    |
|    2   |   `0x00`   |  `0x00`  |  `0x01`  |  `0x01`  |   `0x00`    |
|    3   |   `0x00`   |  `0x00`  |  `0x02`  |  `0x02`  |   `0x00`    |
|   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |
|   256  |   `0x00`   |  `0x00`  |  `0xFF`  |  `0xFF`  |   `0x00`    |
|   257  |   `0x00`   |  `0x01`  |  `0x00`  |  `0x01`  |   `0x00`    |
|   258  |   `0x00`   |  `0x01`  |  `0x01`  |  `0x02`  |   `0x00`    |
|   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |
|  65535 |   `0x00`   |  `0xFF`  |  `0xFE`  |  `0xFD`  |   `0x01`    |
|  65536 |   `0x00`   |  `0xFF`  |  `0xFF`  |  `0xFE`  |   `0x01`    |
|  65537 |   `0x01`   |  `0x00`  |  `0x00`  |  `0x01`  |   `0x00`    |
|  65538 |   `0x01`   |  `0x00`  |  `0x01`  |  `0x02`  |   `0x00`    |
|  65539 |   `0x01`   |  `0x00`  |  `0x02`  |  `0x03`  |   `0x00`    |
|   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |
|  65792 |   `0x01`   |  `0x00`  |  `0xFF`  |  `0x00`  |   `0x01`    |
|  65793 |   `0x01`   |  `0x01`  |  `0x00`  |  `0x02`  |   `0x00`    |
|  65794 |   `0x01`   |  `0x01`  |  `0x01`  |  `0x03`  |   `0x00`    |
|   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |
| 131071 |   `0x01`   |  `0xFF`  |  `0xFE`  |  `0xFE`  |   `0x01`    |
| 131072 |   `0x01`   |  `0xFF`  |  `0xFF`  |  `0xFF`  |   `0x01`    |

Note that, since we use [two's complement notation](https://en.wikipedia.org/wiki/Two's_complement), so this binary sum can be used for both signed and unsigned integers.

We use these _carry_ values to chain together outputs to form each of our 32-bit registry output values. To see how this works in practice, consider the example of adding together two 2-byte numbers, $\textbf{a} = (a_1, a_0)$ and $\textbf{b} = (b_1, b_0)$. This process can later be extended to our 32-byte case: we iterate byte by byte, starting on the least significant and ending at the most significant.

We will first add the least significant byte, $a_1 + b_1$, and then the most significant byte, $a_2 + b_2$. We now distinguish several possible cases:

* If $a_1 + b_1 < 2^8$ and $a_2 + b_2 < 2^8$ then the result of our sum is simply:
    $$
        \textbf{a} + \textbf{b} = (a_2 + b_2, a_1 + b_1)
    $$

* If $a_1 + b_1 < 2^8$ but $a_2 + b_2 \geq 2^8$ then we will need an extra byte to represent our result, and so we have:
    $$
        a_2 + b_2 = 1 \cdot 2^8 + c_2 \, \rightarrow \, \textbf{a} + \textbf{b} = (1, c_2, a_1 + b_1)
    $$
  which will be reflected in the `CARRY_OUT`.

* If $a_1 + b_1 \geq 2^8$ then we have that:
    $$
        a_1 + b_1 = 1 \cdot 2^8 + c_1 \, \rightarrow \, \textbf{a} + \textbf{b} = (a_2 + b_2 + 1) \cdot 2^8 + c_1
    $$
    for which we will consider the following two scenarios:

    - If $c_2 = a_2 + b_2 + 1 < 2^8$ then we simply have that:
        $$
            \textbf{a} + \textbf{b} = (c_2, c_1)
        $$
    - If $a_2 + b_2 + 1 \geq 2^8$ then we define the sum as:
        $$
            a_2 + b_2 + 1 = 1 \cdot 2^8 + c_2
        $$
        and the byte decomposition will finally be:
        $$
            \textbf{a} + \textbf{b} = (1, c_2, c_1)
        $$

#### Subtraction Operation (`SUB`)

This operation computes the difference between two 256-bit numbers. The subtraction operation is first refactored so that it has a similar structure to the one from the addition operation, and can be carried out in a similar way. 

Given $a_i$ and $b_i$, the byte representations of $\textbf{a}$ and $\textbf{b}$, for our byte-by-byte iteration, we are checking if $a_i - b_i - \textrm{carry} \geq 0$. We have two possible cases:

- If $a_i - \textrm{carry} \geq b_i$, then $a_i - b_i - \textrm{carry}$ gives us the $i$-th byte of $a - b$.
- If $a_i - \textrm{carry} < b_i$, then we compute the $i$-th byte as:
    $$
        2^8 - b_i + a_i - \textrm{carry} = 255 - b_i + a_i - \textrm{carry} + 1
    $$
  and set the `CARRY_OUT` value to be one.

Note therefore that we will have to use **two carry values**: one for the carry that we _receive_ from the previous byte, and one for the carry that we _send_ to the next byte. Here we again commit to a plookup table containing all possible 8-bit subtraction operations using the logic described above. As we use two _carry_ values, this table will have the same size as the one from the addition operation. We finally use these _carry_ values to chain together outputs to form each of our 32-bit registry output values.

#### Equality Operation (`EQ`)

This operation checks if two 256-bit numbers are equal. The result of the equality between two values, $a$ and $b$, is $c = 1$, in the case that $a = b$, and $c = 0$ otherwise.

Given $a_i$ and $b_i$, the byte representations of $\textbf{a}$ and $\textbf{b}$, we iterate from the least significant to the most significant byte. The process is as follows:
- If $a_i = b_i$, we keep the carry value from the previous step, where a $carry = 0$ means that all bits checked have matched.
- If $a_i \neq b_i$, we set $carry = 1$. 
- For the most significant byte, we set $c = 1$ (meaning $a = b$) if and only if $a_{n-1} = b_{n-1}$ and the input $carry = 0$.
The byte-wise plookup table then takes the shape:

|   row  | `LAST` | `CARRY_IN` | `BYTE_A` | `BYTE_B` | `BYTE_C` | `CARRY_OUT` | `USE_CARRY` |
|--------|--------|------------|----------|----------|----------|-------------|-------------|
|    1   | `0x00` |   `0x00`   |  `0x00`  |  `0x00`  |  `0x00`  |   `0x00`    |   `0x00`    |
|    2   | `0x00` |   `0x00`   |  `0x00`  |  `0x01`  |  `0x00`  |   `0x01`    |   `0x00`    |
|   ...  |   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |     ...     |
|   256  | `0x00` |   `0x00`   |  `0x00`  |  `0xFF`  |  `0x00`  |   `0x01`    |   `0x00`    |
|   257  | `0x00` |   `0x00`   |  `0x01`  |  `0x00`  |  `0x00`  |   `0x01`    |   `0x00`    |
|   ...  |   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |     ...     |
|  65536 | `0x00` |   `0x00`   |  `0xFF`  |  `0xFF`  |  `0x00`  |   `0x00`    |   `0x00`    |
|  65537 | `0x00` |   `0x01`   |  `0x00`  |  `0x00`  |  `0x00`  |   `0x01`    |   `0x00`    |
|   ...  |   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |     ...     |
| 131072 | `0x00` |   `0x01`   |  `0xFF`  |  `0xFF`  |  `0x00`  |   `0x01`    |   `0x00`    |
| 131073 | `0x01` |   `0x00`   |  `0x00`  |  `0x00`  |  `0x01`  |   `0x01`    |   `0x01`    |
|   ...  |   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |     ...     |
| 131328 | `0x01` |   `0x00`   |  `0x00`  |  `0xFF`  |  `0x00`  |   `0x00`    |   `0x01`    |
| 131329 | `0x01` |   `0x00`   |  `0x01`  |  `0x00`  |  `0x00`  |   `0x00`    |   `0x01`    |
|   ...  |   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |     ...     |
| 196608 | `0x01` |   `0x00`   |  `0xFF`  |  `0xFF`  |  `0x01`  |   `0x01`    |   `0x01`    |
| 196609 | `0x01` |   `0x01`   |  `0x00`  |  `0x00`  |  `0x00`  |   `0x00`    |   `0x01`    |
|   ...  |   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |     ...     |
| 262144 | `0x01` |   `0x01`   |  `0xFF`  |  `0xFF`  |  `0x00`  |   `0x00`    |   `0x01`    |

Using this byte-wise decomposition we can chain together byte operations to form each of our 32-bit registry output values: we will have that $c = 1$ if and only if $a = b$.

#### Inequality Operation (`LT`)

This operation checks if a 256-bit number is smaller than another 256-bit number. The result of the inequality between two values, $a$ and $b$, is $c = 1$, in the case that $a < b$, and $c = 0$ otherwise.

Given $a_i$ and $b_i$, the byte representations of $\textbf{a}$ and $\textbf{b}$, we iterate from the least significant to the most significant byte. The process is as follows:
- If $a_i < b_i$, we set $carry = 1$. If we are on the final iteration (most significant byte), we set $c = 1$.
- If $a_i = b_i$, we keep the carry value from the previous step. If we are on the final iteration (most significant byte), we set $c = carry$, where a $carry = 1$ will mean that $a < b$.
- If $a_i > b_i$, we set $carry = 0$. If we are on the final iteration (most significant byte), we set $c = 0$. 
The byte-wise plookup table then takes the shape:

|   row  | `LAST` | `CARRY_IN` | `BYTE_A` | `BYTE_B` | `BYTE_C` | `CARRY_OUT` | `USE_CARRY` |
|--------|--------|------------|----------|----------|----------|-------------|-------------|
|    1   | `0x00` |   `0x00`   |  `0x00`  |  `0x00`  |  `0x00`  |   `0x00`    |   `0x00`    |
|    2   | `0x00` |   `0x00`   |  `0x00`  |  `0x01`  |  `0x00`  |   `0x01`    |   `0x00`    |
|   ...  |   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |     ...     |
|   256  | `0x00` |   `0x00`   |  `0x00`  |  `0xFF`  |  `0x00`  |   `0x01`    |   `0x00`    |
|   257  | `0x00` |   `0x00`   |  `0x01`  |  `0x00`  |  `0x00`  |   `0x00`    |   `0x00`    |
|   ...  |   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |     ...     |
|  65536 | `0x00` |   `0x00`   |  `0xFF`  |  `0xFF`  |  `0x00`  |   `0x00`    |   `0x00`    |
|  65537 | `0x00` |   `0x01`   |  `0x00`  |  `0x00`  |  `0x00`  |   `0x01`    |   `0x00`    |
|   ...  |   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |     ...     |
| 131072 | `0x00` |   `0x01`   |  `0xFF`  |  `0xFF`  |  `0x00`  |   `0x01`    |   `0x00`    |
| 131073 | `0x01` |   `0x00`   |  `0x00`  |  `0x00`  |  `0x00`  |   `0x00`    |   `0x01`    |
|   ...  |   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |     ...     |
| 131328 | `0x01` |   `0x00`   |  `0x00`  |  `0xFF`  |  `0x01`  |   `0x01`    |   `0x01`    |
| 131329 | `0x01` |   `0x00`   |  `0x01`  |  `0x00`  |  `0x00`  |   `0x00`    |   `0x01`    |
|   ...  |   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |     ...     |
| 196608 | `0x01` |   `0x00`   |  `0xFF`  |  `0xFF`  |  `0x00`  |   `0x00`    |   `0x01`    |
| 196609 | `0x01` |   `0x01`   |  `0x00`  |  `0x00`  |  `0x01`  |   `0x01`    |   `0x01`    |
|   ...  |   ...  |    ...     |    ...   |    ...   |    ...   |     ...     |     ...     |
| 262144 | `0x01` |   `0x01`   |  `0xFF`  |  `0xFF`  |  `0x01`  |   `0x01`    |   `0x01`    |

Using this byte-wise decomposition we can chain together byte operations to form each of our 32-bit registry output values: we will have that $c = 1$ if and only if $a < b$.

#### Signed Inequality Operation (`SLT`)

This operation checks if a 256-bit number is smaller than another 256-bit number, but takes into consideration the respective signs of the numbers. As such, we must take into account the most significant bit, which acts as the sign. The result of the signed inequality between two values, $a$ and $b$, is $c = 1$, in the case that $a < b$, and $c = 0$ otherwise. Note that both $a$ and/or $b$ can be either positive or negative values. We use [two's complement notation](https://en.wikipedia.org/wiki/Two's_complement) to define negative numbers as follows: 

| Binary | Integer |
|--------|---------|
|   011  |    3    |
|   010  |    2    |
|   001  |    1    |
|   000  |    0    |
|   111  |   -1    |
|   110  |   -2    |
|   101  |   -3    |

Note how values in this table get increasingly smaller as we move down in rows, for example: $-2 < -1$.

This operation is also carried out in a byte-wise manner. Given $a_i$ and $b_i$, the byte representations of $\textbf{a}$ and $\textbf{b}$, we iterate from the least significant to the most significant byte. We follow the same strategy as for the inequality operation (`LT`), except on the most significant (last) byte, where we follow:
- If $sgn(a) = 1$ and $sgn(b) = 0$, then we have that $a < b$ and thus we set $c = 1$.
- If $sgn(a) = 0$ and $sgn(b) = 1$, then we have that $a > b$ and thus we set $c = 0$.
- If $sgn(a) = sgn(b)$, then we will have the result of the final iteration of the inequality operation, `LT`. Note how the result is valid when dealing with both positive and negative numbers, as can be seen in the two's complement notation table above.

## Constraint Design for the Binary State Machine

Each operation verified by our Binary State Machine has an opcode associated with it, as shown in the table below:

| Operation | Opcode |
|-----------|--------|
|   `ADD`   |    0   |
|   `SUB`   |    1   |
|    `LT`   |    2   |
|   `SLT`   |    3   |
|    `EQ`   |    4   |
|   `AND`   |    5   |
|    `OR`   |    6   |
|   `XOR`   |    7   |
|   `NOP`   |    *   |

When no binary operation is being carried out, the Binary SM operation is considered to be under `NOP` — No Operation. Any opcode not covered in the table above can be used to represent this.

As we have seen from the descriptions of all the opcodes, the Binary State Machine internally uses plookups of bytes for all the possible input and output byte combinations for all of the binary operations:

$$
    \textrm{byte}_{in0} \, \star \, \textrm{byte}_{in1} = \textrm{byte}_{out}
$$

where $\star$ is one of the possible operations. Internally, these 256-bit values are represented using a total of 8 registries, each 32-bits in capacity, as was covered earlier. The operations are carried out in cycles of 16 steps, with each step verifying two bytes. The final result of the operation is finally reflected on every 17th row, that is, the start of the next operation. The Main SM will check on the result of the computation of the Binary SM via a Plookup that is only performed when the cycles of the Binary SM are completed.

The verification cycle works its way from the least significant byte towards the most significant. As an 8-bit chunk of the operation gets verified, its _contribution_ towards the final values ($a$, $b$, and $c$) gets added up. After the cycle is completed, we will have on the $a$, $b$ and $c$ registers the resulting verified operation: this is the row that is _injected_ into the Main SM via a plookup.

## The Main State Machine

The Main State Machine delegates any binary instructions to the Binary State Machine. These are operations between two input values, always taken from the $A$ and $B$ registries (which, as covered, are made up of 8 different 32-bit registries each, for a total of 256-bits per registry). The Binary SM executes and verifies the operation, and later _injects_ the result to the $OP$ registry. If the result exceeds the allocated 256-bit value, it also updates the $\textrm{carry}$ registry, setting it to $1$.

---
> ⚠️ &nbsp; **NOTE**
>
> The Main SM uses the results of the binary operation directly, and simply delegates its verification to the Binary SM.
---

### Extending the Program Counter — $JMP$, $JMPN$, $JMPC$, and $JPMZ$ 

With this example, we will also look into extending the functionality of the program counter by introducing two new jump instructions, adding up to a total of four:

- `JMP(addr)`, a jump to a given line of the zkASM program, specified by the `addr` argument.
- `JMPN(addr)`, a jump to a given line of the zkASM program, specified by the `addr` argument, if a specified register contains a negative number.
- `JMPC(addr)`, a jump to a given line of the zkASM program, specified by the `addr` argument, if a specified condition is evaluated as true. It is used along the comparative binary instructions `EQ`, `LT`, and `SLT`.
- `JPMZ(addr)`, a conditional jump to a given line of the zkASM program, specified by the `addr` argument, if a specified register contains a $0$.

Additionally, the last three of these instructions will also incorporate an `elseAddr` argument, where the execution will jump to if the given condition is not met. We will need to define a way to keep track of the correct line of the assembly program to be executed next, represented by the $zkPC$ register in the Main State Machine. This way we ensure only valid jumps are being performed within the zkASM program, while via the [ROM Plookup argument](../generic/README.md#rom-plookup) we ensure only valid lines of the zkASM program are being executed.

#### Constraining $JMP$

We will use the following identity to keep track of the correct line of the assembly program to be executed next:

$$
    zkPC' = (zkPC + 1) + JMP \cdot (addr - (zkPC + 1))
$$

#### Constraining $JMPN$

The `JMPC(addr)` instruction will be executed only on condition that $op$ is negative, and so we will introduce the committed polynomial $isNeg$, which gets defined during execution. We will need to further constrain this value to only be equal to $1$ if the value on $op$ is negative, and be $0$ otherwise. If the value on $op$ is negative then we can define:

$$
    jmpnCondValue = op + 2^{32} > 0
$$

---
> ⚠️ &nbsp; **NOTE**
>
> The Binary SM operates with 256-bit unsigned integers (except for the `SLT` operation), broken down into 8 different 32-bit registries. The values of registries are defined over the [Goldilock's field](https://eprint.iacr.org/2015/625.pdf), of size $p = 2^{64} - 2^{31} + 1$. Since in practice we operate with unsigned 32-bit registries, we consider negative values to be the result of arithmetic underflow. As such, the first negative value ($-1$) would be represented as $\textrm{0xFFFFFFFF00000000}$ 
---

And we can check if it is indeed a positive number via bit decomposition, by verifying there exists some $\textbf{b} = [b_0, b_1, ..., b_{31}]$ such that:

$$
    jmpnCondValue = \sum_{i=0}^{31} b_i \cdot 2^i
$$

Such range-like checks are often done using a lookup table: we would check that $jmpnCondValue$ does indeed exist in some precommitted table with all values from $0$ to $2^{32} - 1$. Note however that such construction would require an execution trace of size at least $2^{32}$ rows. In practice, we can combine both methods to reduce the number of committed polynomials: we only use bits to decompose numbers that are greater than the size of our executiont trace, and use a plookup argument to our $STEP$ column otherwise.

We will use the following identity to keep track of the correct line of the assembly program to be executed next:

$$
    zkPC' = (zkPC + 1) + (JMPN \cdot isNeg) \cdot (addr - (zkPC + 1))
$$


#### Constraining $JMPC$

The `JMPC(addr)` instruction will be executed only on condition that the $carry$ value is $1$:

$$
    zkPC' = (zkPC + 1) + (JMPC \cdot carry) \cdot (addr - (zkPC + 1))
$$

#### Constraining $JMPZ$

The `JMPZ(addr)` instruction will be executed only on condition that $op$ is zero, and so we will introduce the flag $isZero$:

$$
    isZero := (1 - op \cdot invOp),
$$

$$
    isZero \cdot op = 0,
$$

Where we define $invOp$ to represent $op^{-1}$, which is set to either the inverse of $op$, or, if $op = 0$, a random field element $\alpha$. We will use the following identity to keep track of the correct line of the assembly program to be executed next:

$$
    zkPC' = (zkPC + 1) + (JMPZ \cdot isZero) \cdot (addr - (zkPC + 1))
$$

#### Constraining the Program Counter 

To support the functionality for the program counter that we described above, we will need to jointly constrain $JMP$, $JMPN$, $JMPC$, and $JMPZ$, as well as supporting an additional `elseAddr` argument. Note that, since we are using 8 registries to represent 256-bit numbers, we use the value in the least significant register, $op0$, when defining these conditions.

Since the polynomials $JMP$, $JMPN$, $JMPC$, and $JMPZ$ cannot all be true at the same time, as constrained by the ROM Plookup, we can define a polynomial to encode whether or not to do a conditional jump, $doJMP$, as:

$$
    doJMP = JMP + JMPN \cdot isNeg + JMPC \cdot carry + JMPZ \cdot op0IsZero
$$

Similarly, for cases when the given condition is _not_ met, we can define a polynomial to encode whether or not to do a jump when the given condition is _not_ met, $elseJMP$, as:

$$
    elseJMP = JMPN \cdot (1 - isNeg) + JMPC \cdot (1 - carry) + JMPZ \cdot (1 - op0IsZero)
$$

We will also need to specify:

- Whether we do the jump if the condition is met, $useJmpAddr$, and where is this jump made to, $jmpAddr$.
- Whether we do the jump if the condition is _not_ met, $useElseAddr$, and where is this jump made to, $useElseAddr$.

These polynomials get verified as part of the ROM Plookup. 

So, to recap, we have defined a polynomial that tells us if the given condition is met, $doJMP$, or not met, $elseJMP$. We have also specified if the line of our ROM defines a jump (via $useJmpAddr$ when the condition is met, $useElseAddr$ otherwise) and to where (via $jmpAddr$ if the condition is met, $useElseAddr$ otherwise). We can now join all these together to arrive at a final expression that constains our program counter:

$$
    zkPC' = doJMP * (useJmpAddr * jmpAddr - (zkPC + 1)) + elseJMP * (useElseAddr * elseAddr - (zkPC + 1)) + zkPC + 1;
$$

Where $zkPC'$ represents the line that will be executed on the next row of the execution trace. We will verify, via the ROM Plookup, that the line of the ROM being executed, $zkPC$, does indeed exists within our ROM. Note that in our PIL program we will have to _decompose_ this expression, as the language does not support polynomials of degree $> 2$. 

We will also constrain that this program counter, $zkPC$, starts at the first line of our ROM by enforcing that:

$$
    zkPC \cdot \textrm{GLOBAL.L1} = 0
$$

Given that $\textrm{GLOBAL.L1} = [1, 0, 0, ..., 0]$.

# Running the State Machine

Running the setup phase: compiling the ROM and generating the constant polynomials:

```
    node src/main_buildconstants.js -p pil/main.pil -r rom/rom-a.zkasm -o build/binary.const
```

Running the executor: filling up the executiont trace:

```
    node src/main_executor.js rom/free-a.json -p pil/main.pil -r rom/rom-a.zkasm -o build/binary.commit
```

Verifying the PIL execution trace:

```
    node ../node_modules/pilcom/src/main_pilverifier.js build/binary.commit -p pil/main.pil -c build/binary.const
```

Generating the proof:

```
    node ../node_modules/pilstark/main_prover.js -m build/binary.commit -c build/binary.const 
```

Verifying the proof:

```

```
