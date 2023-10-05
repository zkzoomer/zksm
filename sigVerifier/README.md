# Signature Verifier State Machine

This state machine will take as inputs an arbitrary number of signatures, and verify them all inside the same proof. The proving process will fail if any of the signatures is not valid. 

To this end, we find multiple components divided into folders:
- [`pil`](./pil/): Defines the state transitions that must be enforced by this state machine.
- [`rom`](./rom/): Defines the ROM for this state machine.
