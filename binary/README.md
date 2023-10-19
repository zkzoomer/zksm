# Introduction to Secondary State Machines

We will look to extend on the definition of our [Generic State Machine](../generic/) by expanding the kinds of computations it can perform. To this end, we will define a secondary state machine that will perform a series of binary operations (`ADD`, `SUB`, `LT`, `SLT`, `EQ`, `AND`, `OR`, `XOR`) over 256-bit numbers. 

This extended generic state machine will also receive instructions in the form of programs written in [zkASM](https://github.com/0xPolygonHermez/zkasmcom), and carry out state transitions at every clock cycle according to these instructions.

Instead of executing these operations on its own, the Main SM will delegate the verification of the binary operations to the secondary binary state machine.

## The Binary State Machine


