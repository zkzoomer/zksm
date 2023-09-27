const { compile: compileZkasm } = require("@0xpolygonhermez/zkasmcom");
const { FGL, starkSetup, starkGen, starkVerify } = require("pil-stark");
const { newConstantPolsArray, newCommitPolsArray, compile: compilePil, verifyPil } = require("pilcom");
const path = require("path");

async function execute() {
    const freeInput = BigInt(process.argv[2])
    const rom = await compileZkasm(process.argv[3] ?? "roms/rom-a.zkasm")

    const pil = await compilePil(FGL, path.join(__dirname, "generic.pil"));

    const constPols = newConstantPolsArray(pil);
    const cmPols = newCommitPolsArray(pil);

    N = cmPols.Main.zkPC.length;

    await initPolynomials(cmPols, constPols, N);
    await buildConstantPolynomials(constPols, N);
    await buildROM(constPols.Rom, rom.program);
    await buildExecutionTrace(cmPols, N, rom, freeInput);

    const res = await verifyPil(FGL, pil, cmPols, constPols);

    if (res.length != 0) {
        console.log("ERROR: The execution trace does not satisfy the PIL restrictions");
        for (let i = 0; i < res.length; i++) {
            return;
        }
    }

    console.log("The execution trace does satisfy the PIL restrictions")

    const starkStruct = require("./generic.starkstruct.json");
    const setup = await starkSetup(constPols, pil, starkStruct);
    const resProof = await starkGen(cmPols, constPols, setup.constTree, setup.starkInfo);
    const resVerify = await starkVerify(resProof.proof, resProof.publics, setup.constRoot, setup.starkInfo);

    if (resVerify === true) {
        console.log("\nVALID PROOF. These are the public values:");
        console.log(`Free input: ${resProof.publics[0]}\nFinal value for A registry: ${resProof.publics[1]}`);
    } else {
        console.log("\nINVALID PROOF");
    }
}

// Initializes all polynomials to zero
async function initPolynomials(cmPols, constPols, polsSize) {
    for (let i = 0; i < polsSize; i++) {
        constPols.Rom.jmpAddr[i] = 0n;
        constPols.Rom.line[i] = 0n;
        constPols.Rom.CONST[i] = 0n;
        constPols.Rom.inA[i] = 0n;
        constPols.Rom.inB[i] = 0n;
        constPols.Rom.inFREE[i] = 0n;
        constPols.Rom.JMPZ[i] = 0n;
        constPols.Rom.JMP[i] = 0n;
        constPols.Rom.setA[i] = 0n;
        constPols.Rom.setB[i] = 0n;

        cmPols.Main.A[i] = 0n;
        cmPols.Main.offset[i] = 0n;
        cmPols.Main.B[i] = 0n;
        cmPols.Main.CONST[i] = 0n;
        cmPols.Main.FREE[i] = 0n;
        cmPols.Main.inA[i] = 0n;
        cmPols.Main.inB[i] = 0n;
        cmPols.Main.inFREE[i] = 0n;
        cmPols.Main.invOp[i] = 0n;
        cmPols.Main.JMPZ[i] = 0n;
        cmPols.Main.JMP[i] = 0n;
        cmPols.Main.setA[i] = 0n;
        cmPols.Main.setB[i] = 0n;
        cmPols.Main.zkPC[i] = 0n;
    }
}

// Builds the Lagrange polynomials L1 and L16
async function buildConstantPolynomials(constPols, polDeg) {
    for (let i = 0; i < polDeg; i++) {
        constPols.Global.L1[i] = i == 0 ? 1n : 0n;
        constPols.Main.L16[i] = i == polDeg - 1 ? 1n : 0n;
    }
}

// Builds the constant polinomials that are defined in the ROM and later used in the Plookup
async function buildROM(pols, romProgram) {
    for (let i = 0; i < romProgram.length; i++) {
        pols.line[i] = BigInt(i);

        if (romProgram[i]?.freeInTag) {
            if (romProgram[i].freeInTag.op === "functionCall") {
                if (romProgram[i].freeInTag.funcName === "getAFreeInput") {
                    pols.inFREE[i] = 1n;
                }

                if (romProgram[i].freeInTag.funcName == "getAnotherFreeInput") {
                    pols.inFREE[i] = 1n;
                }

                if (romProgram[i].freeInTag.funcName == "beforeLast") {
                    pols.inFREE[i] = 1n;
                }
            }
        }

        if (romProgram[i]?.CONST) {
            let integer = BigInt(romProgram[i].CONST);

            if( integer < 0n ) {
                integer = FGL.p + integer;
            }

            pols.CONST[i] = integer;
        }

        if (romProgram[i]?.inA) {
            pols.inA[i] = 1n;
        }

        if (romProgram[i]?.inB) {
            pols.inB[i] = 1n;
        }

        if (romProgram[i]?.bin) {
            if (romProgram[i]?.binOpcode === 0) {
                pols.inA[i] = 1n;
                pols.inB[i] = 1n;
                pols.setA[i] = 1n;
            }
        }

        if (romProgram[i]?.setA) {
            pols.setA[i] = 1n;
        } 

        if (romProgram[i]?.setB) {
            pols.setB[i] = 1n;
        } 

        if (romProgram[i]?.JMPZ) {
            pols.JMPZ[i] = 1n;
            pols.jmpAddr[i] = BigInt(romProgram[i].jmpAddr);
        } else if (romProgram[i]?.JMP) {
            pols.JMP[i] = 1n;
            pols.jmpAddr[i] = BigInt(romProgram[i].jmpAddr);
        }
    }
}

// Builds the execution trace
async function buildExecutionTrace(cmPols, polDeg, rom, freeInput) {
    let line = 0;

    for (let i = 0; i < polDeg; i++) {
        line = cmPols.Main.zkPC[i];
        let nexti = (i + 1) % polDeg;

        let op = 0n;

        if (rom.program[line]?.freeInTag) {
            if (rom.program[line].freeInTag.op === "functionCall") {
                if (rom.program[line].freeInTag.funcName == "getAFreeInput") {
                    cmPols.Main.inFREE[line] = 1n;
                    cmPols.Main.FREE[line] = freeInput;
                }

                if (rom.program[line].freeInTag.funcName == "getAnotherFreeInput") {
                    cmPols.Main.inFREE[line] = 1n;
                    cmPols.Main.FREE[line] = 7n;
                }

                if (rom.program[line].freeInTag.funcName == "beforeLast") {
                    cmPols.Main.inFREE[i] = 1n;
                    i == N - 2 ? cmPols.Main.FREE[i] = 1n : cmPols.Main.FREE[i] = 0n;
                }
            }
        }

        //

        if (rom.program[line]?.CONST) {
            let integer = BigInt(rom.program[line].CONST);
            if( integer < 0n ) integer = FGL.p + integer;
            cmPols.Main.CONST[i] = integer;
        }

        //

        if (rom.program[line]?.inA) {
            cmPols.Main.inA[i] = 1n;
        }

        //

        if (rom.program[line]?.inB) {
            cmPols.Main.inB[i] = 1n;
        }

        //

        if (rom.program[line]?.bin) {
            if (rom.program[i]?.binOpcode === 0) {
                cmPols.Main.inA[i] = 1n;
                cmPols.Main.inB[i] = 1n;
                cmPols.Main.setA[i] = 1n;
            }
        }

        if (rom.program[line]?.setA) {
            cmPols.Main.setA[i] = 1n;
        } 

        if (rom.program[line]?.setB) {
            cmPols.Main.setB[i] = 1n;
        } 

        op =  cmPols.Main.inA[i] * cmPols.Main.A[i] 
        + cmPols.Main.inB[i] * cmPols.Main.B[i] 
        + cmPols.Main.inFREE[i] * cmPols.Main.FREE[i] 
        + cmPols.Main.CONST[i];

        cmPols.Main.A[nexti] = FGL.add(cmPols.Main.setA[i] * (op - cmPols.Main.A[i]), cmPols.Main.A[i]);
        cmPols.Main.B[nexti] = FGL.add(cmPols.Main.setB[i] * (op - cmPols.Main.B[i]), cmPols.Main.B[i]);

        //

        if (!FGL.isZero(op)) {
            cmPols.Main.invOp[i] = FGL.inv(op);
        }

        //

        addr = BigInt(rom.program[line].jmpAddr || 0n);

        if (rom.program[line]?.JMPZ) {
            
            cmPols.Main.JMPZ[i] = 1n;
            cmPols.Main.offset[i] = BigInt(rom.program[line].jmpAddr);

            if (FGL.isZero(op)) {
                cmPols.Main.zkPC[nexti] = addr;
            }

            else {
                cmPols.Main.zkPC[nexti] = cmPols.Main.zkPC[i] + 1n;
            }
        
        } else if (rom.program[line]?.JMP) {

            cmPols.Main.JMP[i] = 1n;
            cmPols.Main.offset[i] = BigInt(rom.program[line].jmpAddr);
            cmPols.Main.zkPC[nexti] = addr;
            
        } else {

            cmPols.Main.zkPC[nexti] = cmPols.Main.zkPC[i] + 1n;
        }
    }
}

execute()
