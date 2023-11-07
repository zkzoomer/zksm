const { Scalar, F1Field } = require("ffjavascript");

const {
    scalar2fea,
    fea2scalar,
    fe2n,
} = require("@0xpolygonhermez/zkevm-commonjs").smtUtils;
const buildPoseidon = require("@0xpolygonhermez/zkevm-commonjs").getPoseidon;
const { encodedStringToArray, decodeCustomRawTxProverMethod} = require("@0xpolygonhermez/zkevm-commonjs").processorUtils;

const twoTo255 = Scalar.shl(Scalar.one, 255);
const twoTo256 = Scalar.shl(Scalar.one, 256);

const Mask256 = Scalar.sub(Scalar.shl(Scalar.e(1), 256), 1);

const WarningCheck = 1;
const ErrorCheck = 2;

let sourceRef;
let nameRomErrors = [];

module.exports.execute = async function execute(pols, input, rom, config = {}, metadata = {}) {
    const required = {
        Binary: []
    };

    const verboseOptions = typeof config.verboseOptions === 'undefined' ? {} : config.verboseOptions;
    const N = pols.zkPC.length;
    const stepsN = config.stepsN ? config.stepsN : N;
    const skipAddrRelControl = (config && config.skipAddrRelControl) || false;

    if (config && config.unsigned){
        if (typeof input.from === 'undefined'){
            throw new Error('Unsigned flag requires a `from` in the input');
        };
    };

    const poseidon = await buildPoseidon();
    const Fr = poseidon.F;
    const Fec = new F1Field(0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn);
    const Fnec = new F1Field(0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n);

    const FrFirst32Negative = 0xFFFFFFFF00000001n - 0xFFFFFFFFn;
    const FrLast32Positive = 0xFFFFFFFFn;

    let op7, op6, op5, op4, op3, op2, op1, op0;

    const ctx = {
        pols: pols,
        input: input,
        vars:[],
        Fr: Fr,
        Fec: Fec,
        Fnec: Fnec,
        sto: input.keys,
        rom: rom,
        outLogs: {},
        N,
        stepsN
    };

    if (config.stats) {
        metadata.stats = {
            trace:[],
            lineTimes:[]
        };
    };

    initState(Fr, pols, ctx);

    let pendingCmds = false;

    if (verboseOptions.batchL2Data) {
        await printBatchL2Data(ctx.input.batchL2Data, verboseOptions.getNameSelector);
    };

    const checkJmpZero = config.checkJmpZero ? (config.checkJmpZero === "warning" ? WarningCheck:ErrorCheck) : false;

    try {
    for (let step = 0; step < stepsN; step++) {
        const i = step % N;
        ctx.ln = Fr.toObject(pols.zkPC[i]);
        ctx.step = step;
        ctx.A = [pols.A0[i], pols.A1[i], pols.A2[i], pols.A3[i], pols.A4[i], pols.A5[i], pols.A6[i], pols.A7[i]];
        ctx.B = [pols.B0[i], pols.B1[i], pols.B2[i], pols.B3[i], pols.B4[i], pols.B5[i], pols.B6[i], pols.B7[i]];
        ctx.C = [pols.C0[i], pols.C1[i], pols.C2[i], pols.C3[i], pols.C4[i], pols.C5[i], pols.C6[i], pols.C7[i]];
        ctx.D = [pols.D0[i], pols.D1[i], pols.D2[i], pols.D3[i], pols.D4[i], pols.D5[i], pols.D6[i], pols.D7[i]];
        ctx.zkPC = pols.zkPC[i];

        // evaluate commands "after" before start new line, but when new values of registers are ready.
        if (pendingCmds) {
            evalCommands(ctx, pendingCmds);
            pendingCmds = false;
        };

        const l = rom.program[ ctx.zkPC ];
        if (config.stats) {
            metadata.stats.trace.push(ctx.zkPC);
            metadata.stats.lineTimes[ctx.zkPC] = (metadata.stats.lineTimes[ctx.zkPC] || 0) + 1;
        };

        ctx.fileName = l.fileName;
        ctx.line = l.line;
        sourceRef = `[w:${step} zkPC:${ctx.ln} ${ctx.fileName}:${ctx.line}]`;
        ctx.sourceRef = sourceRef;

        if (verboseOptions.zkPC) {
            console.log(sourceRef);
        };

        if (typeof verboseOptions.step === 'number') {
            if (step % verboseOptions.step == 0){
                console.log(`Step: ${step}`);
            };
        };

        if (l.cmdBefore) {
            for (let j=0; j< l.cmdBefore.length; j++) {
                evalCommand(ctx, l.cmdBefore[j]);
            };
        };

        //////////
        // LOAD INPUTS
        //////////
        [op0, op1, op2, op3, op4, op5, op6, op7] = [Fr.zero, Fr.zero, Fr.zero, Fr.zero, Fr.zero, Fr.zero, Fr.zero, Fr.zero];

        if (l.inA) {
            [op0, op1, op2, op3, op4, op5, op6, op7] = [
                Fr.add(op0, Fr.mul( Fr.e(l.inA), ctx.A[0])),
                Fr.add(op1, Fr.mul( Fr.e(l.inA), ctx.A[1])),
                Fr.add(op2, Fr.mul( Fr.e(l.inA), ctx.A[2])),
                Fr.add(op3, Fr.mul( Fr.e(l.inA), ctx.A[3])),
                Fr.add(op4, Fr.mul( Fr.e(l.inA), ctx.A[4])),
                Fr.add(op5, Fr.mul( Fr.e(l.inA), ctx.A[5])),
                Fr.add(op6, Fr.mul( Fr.e(l.inA), ctx.A[6])),
                Fr.add(op7, Fr.mul( Fr.e(l.inA), ctx.A[7]))
            ];
            pols.inA[i] = Fr.e(l.inA);
        } else {
            pols.inA[i] = Fr.zero;
        };

        if (l.inB) {
            [op0, op1, op2, op3, op4, op5, op6, op7] = [
                    Fr.add(op0, Fr.mul( Fr.e(l.inB), ctx.B[0])),
                    Fr.add(op1, Fr.mul( Fr.e(l.inB), ctx.B[1])),
                    Fr.add(op2, Fr.mul( Fr.e(l.inB), ctx.B[2])),
                    Fr.add(op3, Fr.mul( Fr.e(l.inB), ctx.B[3])),
                    Fr.add(op4, Fr.mul( Fr.e(l.inB), ctx.B[4])),
                    Fr.add(op5, Fr.mul( Fr.e(l.inB), ctx.B[5])),
                    Fr.add(op6, Fr.mul( Fr.e(l.inB), ctx.B[6])),
                    Fr.add(op7, Fr.mul( Fr.e(l.inB), ctx.B[7]))
                ];
            pols.inB[i] = Fr.e(l.inB);
        } else {
            pols.inB[i] = Fr.zero;
        };

        if (l.inC) {
            [op0, op1, op2, op3, op4, op5, op6, op7] = [
                Fr.add(op0, Fr.mul( Fr.e(l.inC), ctx.C[0])),
                Fr.add(op1, Fr.mul( Fr.e(l.inC), ctx.C[1])),
                Fr.add(op2, Fr.mul( Fr.e(l.inC), ctx.C[2])),
                Fr.add(op3, Fr.mul( Fr.e(l.inC), ctx.C[3])),
                Fr.add(op4, Fr.mul( Fr.e(l.inC), ctx.C[4])),
                Fr.add(op5, Fr.mul( Fr.e(l.inC), ctx.C[5])),
                Fr.add(op6, Fr.mul( Fr.e(l.inC), ctx.C[6])),
                Fr.add(op7, Fr.mul( Fr.e(l.inC), ctx.C[7]))
            ];
            pols.inC[i] = Fr.e(l.inC);
        } else {
            pols.inC[i] = Fr.zero;
        };

        if (l.inD) {
            [op0, op1, op2, op3, op4, op5, op6, op7] = [
                Fr.add(op0, Fr.mul( Fr.e(l.inD), ctx.D[0])),
                Fr.add(op1, Fr.mul( Fr.e(l.inD), ctx.D[1])),
                Fr.add(op2, Fr.mul( Fr.e(l.inD), ctx.D[2])),
                Fr.add(op3, Fr.mul( Fr.e(l.inD), ctx.D[3])),
                Fr.add(op4, Fr.mul( Fr.e(l.inD), ctx.D[4])),
                Fr.add(op5, Fr.mul( Fr.e(l.inD), ctx.D[5])),
                Fr.add(op6, Fr.mul( Fr.e(l.inD), ctx.D[6])),
                Fr.add(op7, Fr.mul( Fr.e(l.inD), ctx.D[7]))
            ];
            pols.inD[i] = Fr.e(l.inD);
        } else {
            pols.inD[i] = Fr.zero;
        };

        if ((!isNaN(l.CONSTL)) && (l.CONSTL)) {
            [
                pols.CONST0[i],
                pols.CONST1[i],
                pols.CONST2[i],
                pols.CONST3[i],
                pols.CONST4[i],
                pols.CONST5[i],
                pols.CONST6[i],
                pols.CONST7[i]
            ] = scalar2fea(Fr, l.CONSTL);

            [op0, op1, op2, op3, op4, op5, op6, op7] = [
                Fr.add(op0, pols.CONST0[i]),
                Fr.add(op1, pols.CONST1[i]),
                Fr.add(op2, pols.CONST2[i]),
                Fr.add(op3, pols.CONST3[i]),
                Fr.add(op4, pols.CONST4[i]),
                Fr.add(op5, pols.CONST5[i]),
                Fr.add(op6, pols.CONST6[i]),
                Fr.add(op7, pols.CONST7[i])
            ];
        } else if ((!isNaN(l.CONST))&&(l.CONST)) {
            pols.CONST0[i] = Fr.e(l.CONST);
            op0 = Fr.add(op0, pols.CONST0[i] );
            pols.CONST1[i] = Fr.zero;
            pols.CONST2[i] = Fr.zero;
            pols.CONST3[i] = Fr.zero;
            pols.CONST4[i] = Fr.zero;
            pols.CONST5[i] = Fr.zero;
            pols.CONST6[i] = Fr.zero;
            pols.CONST7[i] = Fr.zero;
        } else {
            pols.CONST0[i] = Fr.zero;
            pols.CONST1[i] = Fr.zero;
            pols.CONST2[i] = Fr.zero;
            pols.CONST3[i] = Fr.zero;
            pols.CONST4[i] = Fr.zero;
            pols.CONST5[i] = Fr.zero;
            pols.CONST6[i] = Fr.zero;
            pols.CONST7[i] = Fr.zero;
        };

        ////////////
        // PREPARE AUXILIARY VARS
        ////////////
        let addrRel = 0;
        let addr = 0;
        if (l.JMP || l.JMPN || l.JMPC || l.JMPZ) {
            if (l.ind) {
                addrRel = fe2n(Fr, ctx.E[0], ctx);
            };

            if (l.indRR) {
                addrRel += fe2n(Fr, ctx.RR, ctx);
            };

            if (l.offset) addrRel += l.offset;
            if (l.isStack == 1) addrRel += Number(ctx.SP);

            if (!skipAddrRelControl) {
                if (addrRel >= 0x20000 || (!l.isMem && addrRel >= 0x10000)) throw new Error(`Address too big ${sourceRef}`);
                if (addrRel <0 ) throw new Error(`Address can not be negative ${sourceRef}`);
            };

            addr = addrRel;
        }

        //////
        // CALCULATE AND LOAD FREE INPUT
        //////
        if (l.inFREE) {
            if (!l.freeInTag) {
                throw new Error(`Instruction with freeIn without freeInTag ${sourceRef}`);
            };

            let fi;
            if (l.freeInTag.op=="") {
                let nHits = 0;
                
                if (l.bin) {
                    if (l.binOpcode == 0) { // ADD
                        const a = safeFea2scalar(Fr, ctx.A);
                        const b = safeFea2scalar(Fr, ctx.B);
                        const c = Scalar.band(Scalar.add(a, b), Mask256);
                        fi = scalar2fea(Fr, c);
                        nHits ++;
                    } else if (l.binOpcode == 1) { // SUB
                        const a = safeFea2scalar(Fr, ctx.A);
                        const b = safeFea2scalar(Fr, ctx.B);
                        const c = Scalar.band(Scalar.add(Scalar.sub(a, b), twoTo256), Mask256);
                        fi = scalar2fea(Fr, c);
                        nHits ++;
                    } else if (l.binOpcode == 2) { // LT
                        const a = safeFea2scalar(Fr, ctx.A);
                        const b = safeFea2scalar(Fr, ctx.B);
                        const c = Scalar.lt(a, b);
                        fi = scalar2fea(Fr, c);
                        nHits ++;
                    } else if (l.binOpcode == 3) { // SLT
                        let a = safeFea2scalar(Fr, ctx.A);
                        if (Scalar.geq(a, twoTo255)) a = Scalar.sub(a, twoTo256);
                        let b = safeFea2scalar(Fr, ctx.B);
                        if (Scalar.geq(b, twoTo255)) b = Scalar.sub(b, twoTo256);
                        const c = Scalar.lt(a, b);
                        fi = scalar2fea(Fr, c);
                        nHits ++;
                    } else if (l.binOpcode == 4) { // EQ
                        const a = safeFea2scalar(Fr, ctx.A);
                        const b = safeFea2scalar(Fr, ctx.B);
                        const c = Scalar.eq(a, b);
                        fi = scalar2fea(Fr, c);
                        nHits ++;
                    } else if (l.binOpcode == 5) { // AND
                        const a = safeFea2scalar(Fr, ctx.A);
                        const b = safeFea2scalar(Fr, ctx.B);
                        const c = Scalar.band(a, b);
                        fi = scalar2fea(Fr, c);
                        nHits ++;
                    } else if (l.binOpcode == 6) { // OR
                        const a = safeFea2scalar(Fr, ctx.A);
                        const b = safeFea2scalar(Fr, ctx.B);
                        const c = Scalar.bor(a, b);
                        fi = scalar2fea(Fr, c);
                        nHits ++;
                    } else if (l.binOpcode == 7) { // XOR
                        const a = safeFea2scalar(Fr, ctx.A);
                        const b = safeFea2scalar(Fr, ctx.B);
                        const c = Scalar.bxor(a, b);
                        fi = scalar2fea(Fr, c);
                        nHits ++;
                    } else {
                        throw new Error(`Invalid Binary operation ${l.binOpCode} ${sourceRef}`);
                    };
                };

                if (nHits==0) {
                    throw new Error(`Empty freeIn without a valid instruction ${sourceRef}`);
                };

                if (nHits>1) {
                    throw new Error(`Only one instruction that requires freeIn is allowed ${sourceRef}`);
                };
            } else {
                fi = evalCommand(ctx, l.freeInTag);
                if (!Array.isArray(fi)) fi = scalar2fea(Fr, fi);
            };

            [pols.FREE0[i], pols.FREE1[i], pols.FREE2[i], pols.FREE3[i], pols.FREE4[i], pols.FREE5[i], pols.FREE6[i], pols.FREE7[i]] = fi;
            [op0, op1, op2, op3, op4, op5, op6, op7] = [
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[0]), op0),
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[1]), op1),
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[2]), op2),
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[3]), op3),
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[4]), op4),
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[5]), op5),
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[6]), op6),
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[7]), op7)
            ];

            pols.inFREE[i] = Fr.e(l.inFREE);
        } else {
            [pols.FREE0[i], pols.FREE1[i], pols.FREE2[i], pols.FREE3[i], pols.FREE4[i], pols.FREE5[i], pols.FREE6[i], pols.FREE7[i]] = [Fr.zero, Fr.zero, Fr.zero, Fr.zero, Fr.zero, Fr.zero, Fr.zero, Fr.zero];
            pols.inFREE[i] = Fr.zero;
        };

        if (Fr.isZero(op0)) {
            pols.op0Inv[i] = 0n;
        } else {
            pols.op0Inv[i] = Fr.inv(op0);
        };

        //////////
        // PROCESS INSTRUCTIONS
        //////////
        if (l.bin) {
            if (l.binOpcode == 0) { // ADD
                const a = safeFea2scalar(Fr, ctx.A);
                const b = safeFea2scalar(Fr, ctx.B);
                const c = safeFea2scalar(Fr, [op0, op1, op2, op3, op4, op5, op6, op7]);
                const expectedC = Scalar.band(Scalar.add(a, b), Mask256);

                if (!Scalar.eq(c, expectedC)) {
                    throw new Error(`ADD does not match (${expectedC} != ${c}) ${sourceRef}`);
                };

                pols.binOpcode[i] = 0n;
                pols.carry[i] = (((a + b) >> 256n) > 0n) ? 1n : 0n;
                required.Binary.push({a: a, b: b, c: c, opcode: 0, type: 1});
            } else if (l.binOpcode == 1) { // SUB
                const a = safeFea2scalar(Fr, ctx.A);
                const b = safeFea2scalar(Fr, ctx.B);
                const c = safeFea2scalar(Fr, [op0, op1, op2, op3, op4, op5, op6, op7]);
                const expectedC = Scalar.band(Scalar.add(Scalar.sub(a, b), twoTo256), Mask256);

                if (!Scalar.eq(c, expectedC)) {
                    throw new Error(`SUB does not match (${expectedC} != ${c}) ${sourceRef}`);
                };
                
                pols.binOpcode[i] = 1n;
                pols.carry[i] = ((a - b) < 0n) ? 1n : 0n;
                required.Binary.push({a: a, b: b, c: c, opcode: 1, type: 1});
            } else if (l.binOpcode == 2) { // LT
                const a = safeFea2scalar(Fr, ctx.A);
                const b = safeFea2scalar(Fr, ctx.B);
                const c = safeFea2scalar(Fr, [op0, op1, op2, op3, op4, op5, op6, op7]);
                const expectedC = Scalar.lt(a, b);

                if (!Scalar.eq(c, expectedC)) {
                    throw new Error(`LT does not match (${expectedC?1n:0n} != ${c}) ${sourceRef}`);
                };

                pols.binOpcode[i] = 2n;
                pols.carry[i] = (a < b) ? 1n: 0n;
                required.Binary.push({a: a, b: b, c: c, opcode: 2, type: 1});
            } else if (l.binOpcode == 3) { // SLT
                const a = safeFea2scalar(Fr, ctx.A);
                const b = safeFea2scalar(Fr, ctx.B);
                const c = safeFea2scalar(Fr, [op0, op1, op2, op3, op4, op5, op6, op7]);

                const signedA = Scalar.geq(a, twoTo255) ? Scalar.sub(a, twoTo256): a;
                const signedB = Scalar.geq(b, twoTo255) ? Scalar.sub(b, twoTo256): b;
                const expectedC = Scalar.lt(signedA, signedB);

                if (!Scalar.eq(c, expectedC)) {
                    throw new Error(`SLT does not match (${expectedC?1n:0n} != ${c}) ${sourceRef}`);
                };

                pols.binOpcode[i] = 3n;
                pols.carry[i] = (signedA < signedB) ? 1n : 0n;
                required.Binary.push({a: a, b: b, c: c, opcode: 3, type: 1});
            } else if (l.binOpcode == 4) { // EQ
                const a = safeFea2scalar(Fr, ctx.A);
                const b = safeFea2scalar(Fr, ctx.B);
                const c = safeFea2scalar(Fr, [op0, op1, op2, op3, op4, op5, op6, op7]);
                const expectedC = Scalar.eq(a, b);

                if (!Scalar.eq(c, expectedC)) {
                    throw new Error(`EQ does not match (${expectedC?1n:0n} != ${c}) ${sourceRef}`);
                };

                pols.binOpcode[i] = 4n;
                pols.carry[i] = (a ==  b) ? 1n : 0n;
                required.Binary.push({a: a, b: b, c: c, opcode: 4, type: 1});
            } else if (l.binOpcode == 5) { // AND
                const a = safeFea2scalar(Fr, ctx.A);
                const b = safeFea2scalar(Fr, ctx.B);
                const c = safeFea2scalar(Fr, [op0, op1, op2, op3, op4, op5, op6, op7]);
                const expectedC = Scalar.band(a, b);

                if (!Scalar.eq(c, expectedC)) {
                    throw new Error(`AND does not match (${expectedC} != ${c}) ${sourceRef}`);
                };

                pols.binOpcode[i] = 5n;
                pols.carry[i] = Scalar.eq(c, Fr.zero) ? 0n:1n;
                required.Binary.push({a: a, b: b, c: c, opcode: 5, type: 1});
            } else if (l.binOpcode == 6) { // OR
                const a = safeFea2scalar(Fr, ctx.A);
                const b = safeFea2scalar(Fr, ctx.B);
                const c = safeFea2scalar(Fr, [op0, op1, op2, op3, op4, op5, op6, op7]);
                const expectedC = Scalar.bor(a, b);

                if (!Scalar.eq(c, expectedC)) {
                    throw new Error(`OR does not match (${expectedC} != ${c}) ${sourceRef}`);
                };

                pols.binOpcode[i] = 6n;
                pols.carry[i] = 0n;
                required.Binary.push({a: a, b: b, c: c, opcode: 6, type: 1});
            } else if (l.binOpcode == 7) { // XOR
                const a = safeFea2scalar(Fr, ctx.A);
                const b = safeFea2scalar(Fr, ctx.B);
                const c = safeFea2scalar(Fr, [op0, op1, op2, op3, op4, op5, op6, op7]);
                const expectedC = Scalar.bxor(a, b);

                if (!Scalar.eq(c, expectedC)) {
                    throw new Error(`XOR does not match (${expectedC} != ${c}) ${sourceRef}`);
                };

                pols.binOpcode[i] = 7n;
                pols.carry[i] = 0n;
                required.Binary.push({a: a, b: b, c: c, opcode: 7, type: 1});
            } else {
                throw new Error(`Invalid bin opcode (${l.binOpcode}) ${sourceRef}`);
            };

            pols.bin[i] = 1n;
        } else {
            pols.bin[i] = 0n;
            pols.binOpcode[i] = 0n;
            pols.carry[i] = 0n;
        };

        //////////
        // SET NEXT REGISTERS
        //////////
        const nexti = (i + 1) % N;

        if (l.setA == 1) {
            pols.setA[i]=1n;
            [
                pols.A0[nexti],
                pols.A1[nexti],
                pols.A2[nexti],
                pols.A3[nexti],
                pols.A4[nexti],
                pols.A5[nexti],
                pols.A6[nexti],
                pols.A7[nexti]
            ] = [op0, op1, op2, op3, op4, op5, op6, op7];
        } else {
            pols.setA[i]=0n;
            [
                pols.A0[nexti],
                pols.A1[nexti],
                pols.A2[nexti],
                pols.A3[nexti],
                pols.A4[nexti],
                pols.A5[nexti],
                pols.A6[nexti],
                pols.A7[nexti]
            ] = [
                pols.A0[i],
                pols.A1[i],
                pols.A2[i],
                pols.A3[i],
                pols.A4[i],
                pols.A5[i],
                pols.A6[i],
                pols.A7[i]
            ];

            // Set A register with input.from to process unsigned transactions
            if ((Number(ctx.zkPC) === rom.labels.checkAndSaveFrom) && config.unsigned){
                const feaFrom = scalar2fea(Fr, input.from);
                [
                    pols.A0[nexti],
                    pols.A1[nexti],
                    pols.A2[nexti],
                    pols.A3[nexti],
                    pols.A4[nexti],
                    pols.A5[nexti],
                    pols.A6[nexti],
                    pols.A7[nexti]
                ] = [feaFrom[0], feaFrom[1], feaFrom[2], feaFrom[3], feaFrom[4], feaFrom[5], feaFrom[6], feaFrom[7]];
            };
        };

        if (l.setB == 1) {
            pols.setB[i]=1n;
            [
                pols.B0[nexti],
                pols.B1[nexti],
                pols.B2[nexti],
                pols.B3[nexti],
                pols.B4[nexti],
                pols.B5[nexti],
                pols.B6[nexti],
                pols.B7[nexti]
            ] = [op0, op1, op2, op3, op4, op5, op6, op7];
        } else {
            pols.setB[i]=0n;
            [
                pols.B0[nexti],
                pols.B1[nexti],
                pols.B2[nexti],
                pols.B3[nexti],
                pols.B4[nexti],
                pols.B5[nexti],
                pols.B6[nexti],
                pols.B7[nexti]
            ] = [
                pols.B0[i],
                pols.B1[i],
                pols.B2[i],
                pols.B3[i],
                pols.B4[i],
                pols.B5[i],
                pols.B6[i],
                pols.B7[i]
            ];
        };

        if (l.setC == 1) {
            pols.setC[i]=1n;
            [
                pols.C0[nexti],
                pols.C1[nexti],
                pols.C2[nexti],
                pols.C3[nexti],
                pols.C4[nexti],
                pols.C5[nexti],
                pols.C6[nexti],
                pols.C7[nexti]
            ] = [op0, op1, op2, op3, op4, op5, op6, op7];
        } else {
            pols.setC[i]=0n;
            [
                pols.C0[nexti],
                pols.C1[nexti],
                pols.C2[nexti],
                pols.C3[nexti],
                pols.C4[nexti],
                pols.C5[nexti],
                pols.C6[nexti],
                pols.C7[nexti]
            ] = [
                pols.C0[i],
                pols.C1[i],
                pols.C2[i],
                pols.C3[i],
                pols.C4[i],
                pols.C5[i],
                pols.C6[i],
                pols.C7[i]
            ];
        };

        if (l.setD == 1) {
            pols.setD[i]=1n;
            [
                pols.D0[nexti],
                pols.D1[nexti],
                pols.D2[nexti],
                pols.D3[nexti],
                pols.D4[nexti],
                pols.D5[nexti],
                pols.D6[nexti],
                pols.D7[nexti]
            ] = [op0, op1, op2, op3, op4, op5, op6, op7];
        } else {
            pols.setD[i]=0n;
            [
                pols.D0[nexti],
                pols.D1[nexti],
                pols.D2[nexti],
                pols.D3[nexti],
                pols.D4[nexti],
                pols.D5[nexti],
                pols.D6[nexti],
                pols.D7[nexti]
            ] = [
                pols.D0[i],
                pols.D1[i],
                pols.D2[i],
                pols.D3[i],
                pols.D4[i],
                pols.D5[i],
                pols.D6[i],
                pols.D7[i]
            ];
        };

        pols.JMP[i] = 0n;
        pols.JMPN[i] = 0n;
        pols.JMPC[i] = 0n;
        pols.JMPZ[i] = 0n;

        pols.jmpAddr[i] = l.jmpAddr ? BigInt(l.jmpAddr) : 0n;
        pols.useJmpAddr[i] = l.useJmpAddr ? 1n: 0n;

        const finalJmpAddr = l.useJmpAddr ? l.jmpAddr : addr;
        const nextNoJmpZkPC = pols.zkPC[i] + ((l.repeat && !Fr.isZero(ctx.RCX)) ? 0n:1n);

        let elseAddr = l.useElseAddr ? BigInt(l.elseAddr) : nextNoJmpZkPC;
        // modify JMP 'elseAddr' to continue execution in case of an unsigned transaction
        if (config.unsigned && l.elseAddrLabel === 'invalidIntrinsicTxSenderCode') {
            elseAddr = BigInt(finalJmpAddr);
        };

        pols.elseAddr[i] = l.elseAddr ? BigInt(l.elseAddr) : 0n;
        pols.useElseAddr[i] = l.useElseAddr ? 1n: 0n;

        if (l.JMPN) {
            const o = Fr.toObject(op0);
            let jmpnCondValue = o;

            if (o > 0 && o >= FrFirst32Negative) {
                pols.isNeg[i]=1n;
                jmpnCondValue = Fr.toObject(Fr.e(jmpnCondValue + 2n**32n));
                pols.zkPC[nexti] = BigInt(finalJmpAddr);
            } else if (o >= 0 && o <= FrLast32Positive) {
                pols.isNeg[i]=0n;
                pols.zkPC[nexti] = elseAddr;
            } else {
                throw new Error(`On JMPN value ${o} not a valid 32bit value ${sourceRef}`);
            };

            pols.lJmpnCondValue[i] = jmpnCondValue & 0x1FFFFFn;  // 2**21 - 1, seeing that N = 2**21
            jmpnCondValue = jmpnCondValue >> 21n;

            for (let index = 0; index < 11; ++index) {
                pols.hJmpnCondValueBit[index][i] = jmpnCondValue & 0x01n;
                jmpnCondValue = jmpnCondValue >> 1n;
            };

            pols.JMPN[i] = 1n;
        } else {
            pols.isNeg[i] = 0n;
            pols.lJmpnCondValue[i] = 0n;

            for (let index = 0; index < 11; ++index) {
                pols.hJmpnCondValueBit[index][i] = 0n;
            };

            if (l.JMPC) {
                if (pols.carry[i]) {
                    pols.zkPC[nexti] = BigInt(finalJmpAddr);
                } else {
                    pols.zkPC[nexti] = elseAddr;
                };

                pols.JMPC[i] = 1n;
            } else if (l.JMPZ) {
                if (Fr.isZero(op0)) {
                    pols.zkPC[nexti] = BigInt(finalJmpAddr);
                } else {
                    pols.zkPC[nexti] = elseAddr;
                };

                pols.JMPZ[i] = 1n;
                const o = Fr.toObject(op0);
                if (o > 0 && o >= FrFirst32Negative) {
                    console.log(`WARNING: JMPZ with negative value ${sourceRef}`);
                };
            } else if (l.JMP) {
                pols.zkPC[nexti] = BigInt(finalJmpAddr);
                pols.JMP[i] = 1n;
            } else if (l.call) {
                pols.zkPC[nexti] = BigInt(finalJmpAddr);
                pols.call[i] = 1n;
            } else if (l.return) {
                pols.zkPC[nexti] = ctx.RR;
                pols.return[i] = 1n;
            } else {
                pols.zkPC[nexti] = nextNoJmpZkPC;
            };
        };

        if (pols.zkPC[nexti] == (pols.zkPC[i] + 1n)) {
            pendingCmds = l.cmdAfter;
        };

        if (checkJmpZero && pols.zkPC[nexti] === 0n && nexti !== 0) {
            if (checkJmpZero === ErrorCheck) {
                throw new Error(`ERROR: Not final JMP to 0 (N=${N}) ${sourceRef}`);
            };
            console.log(`WARNING: Not final JMP to 0 (N=${N}) ${sourceRef}`);
        };
    }
    } catch (error) {
        if (!error.message.includes(sourceRef)) {
            error.message += ' '+sourceRef;
        };

        throw error;
    };

    required.logs = ctx.outLogs;
    required.errors = nameRomErrors;

    return required;
}

/**
 * Set input parameters to initial registers
 * @param {Field} Fr - field element
 * @param {Object} pols - polynomials
 * @param {Object} ctx - context
 */
function initState(Fr, pols, ctx) {
    pols.A0[0] = Fr.zero;
    pols.A1[0] = Fr.zero;
    pols.A2[0] = Fr.zero;
    pols.A3[0] = Fr.zero;
    pols.A4[0] = Fr.zero;
    pols.A5[0] = Fr.zero;
    pols.A6[0] = Fr.zero;
    pols.A7[0] = Fr.zero;
    pols.B0[0] = Fr.zero;
    pols.B1[0] = Fr.zero;
    pols.B2[0] = Fr.zero;
    pols.B3[0] = Fr.zero;
    pols.B4[0] = Fr.zero;
    pols.B5[0] = Fr.zero;
    pols.B6[0] = Fr.zero;
    pols.B7[0] = Fr.zero;
    pols.C0[0] = Fr.zero;
    pols.C1[0] = Fr.zero;
    pols.C2[0] = Fr.zero;
    pols.C3[0] = Fr.zero;
    pols.C4[0] = Fr.zero;
    pols.C5[0] = Fr.zero;
    pols.C6[0] = Fr.zero;
    pols.C7[0] = Fr.zero;
    pols.D0[0] = Fr.zero;
    pols.D1[0] = Fr.zero;
    pols.D2[0] = Fr.zero;
    pols.D3[0] = Fr.zero;
    pols.D4[0] = Fr.zero;
    pols.D5[0] = Fr.zero;
    pols.D6[0] = Fr.zero;
    pols.D7[0] = Fr.zero;
    pols.zkPC[0] = 0n;
    pols.op0Inv[0] = 0n;
};

async function printBatchL2Data(batchL2Data, getNameSelector) {
    console.log("/////////////////////////////");
    console.log("/////// BATCH L2 DATA ///////");
    console.log("/////////////////////////////\n");

    const txs = encodedStringToArray(batchL2Data);
    console.log("Number of transactions: ", txs.length);

    for (let i = 0; i < txs.length; i++){
        console.log("\nTxNumber: ", i);
        const rawTx = txs[i];
        const infoTx = decodeCustomRawTxProverMethod(rawTx);

        infoTx.txDecoded.from = from;

        if (getNameSelector) {
            infoTx.txDecoded.selectorLink = `${getNameSelector}${infoTx.txDecoded.data.slice(0, 10)}`;
        };

        console.log(infoTx.txDecoded);
    };

    console.log("/////////////////////////////");
    console.log("/////////////////////////////\n");
};

function evalCommands(ctx, cmds) {
    for (let j=0; j< cmds.length; j++) {
        evalCommand(ctx, cmds[j]);
    };
};

function evalCommand(ctx, tag) {
    if (tag.op == "number") {
        return eval_number(ctx, tag);
    } else if (tag.op == "declareVar") {
        return eval_declareVar(ctx, tag);
    } else if (tag.op == "setVar") {
        return eval_setVar(ctx, tag);
    } else if (tag.op == "getVar") {
        return eval_getVar(ctx, tag);
    } else if (tag.op == "getReg") {
        return eval_getReg(ctx, tag);
    } else if (tag.op == "functionCall") {
        return eval_functionCall(ctx, tag);
    } else if (tag.op == "add") {
        return eval_add(ctx, tag);
    } else if (tag.op == "sub") {
        return eval_sub(ctx, tag);
    } else if (tag.op == "neg") {
        return eval_neg(ctx, tag);
    } else if (tag.op == "mul") {
        return eval_mul(ctx, tag);
    } else if (tag.op == "div") {
        return eval_div(ctx, tag);
    } else if (tag.op == "mod") {
        return eval_mod(ctx, tag);
    } else if (tag.op == "or" || tag.op == "and" || tag.op == "gt" || tag.op == "ge" || tag.op == "lt" || tag.op == "le" ||
               tag.op == "eq" || tag.op == "ne" || tag.op == "not" ) {
        return eval_logical_operation(ctx, tag);
    } else if (tag.op == "bitand" || tag.op == "bitor" || tag.op == "bitxor" || tag.op == "bitnot"|| tag.op == "shl" || tag.op == "shr") {
        return eval_bit_operation(ctx, tag);
    } else if (tag.op == "if") {
        return eval_if(ctx, tag);
    } else {
        throw new Error(`Invalid operation ${tag.op} ${ctx.sourceRef}`);
    };
};

function eval_number(ctx, tag) {
    return Scalar.e(tag.num);
};

function eval_setVar(ctx, tag) {
    const varName = eval_left(ctx, tag.values[0]);

    if (typeof ctx.vars[varName] == "undefined") throw new Error(`Variable ${varName} not defined ${ctx.sourceRef}`);

    ctx.vars[varName] = evalCommand(ctx, tag.values[1]);
    return ctx.vars[varName];
};

function eval_left(ctx, tag) {
    if (tag.op == "declareVar") {
        eval_declareVar(ctx, tag);
        return tag.varName;
    } else if (tag.op == "getVar") {
        return tag.varName;
    } else {
        throw new Error(`Invalid left expression (${tag.op}) ${ctx.sourceRef}`);
    };
};

function eval_declareVar(ctx, tag) {
    // local variables, redeclared must start with _
    if (tag.varName[0] !== '_' && typeof ctx.vars[tag.varName] != "undefined") {
        throw new Error(`Variable ${tag.varName} already declared ${ctx.sourceRef}`);
    };

    ctx.vars[tag.varName] = Scalar.e(0);
    return ctx.vars[tag.varName];
};

function eval_getVar(ctx, tag) {
    if (typeof ctx.vars[tag.varName] == "undefined") throw new Error(`Variable ${tag.varName} not defined ${ctx.sourceRef}`);
    return ctx.vars[tag.varName];
};

function eval_getReg(ctx, tag) {
    if (tag.regName == "A") {
        return safeFea2scalar(ctx.Fr, ctx.A);
    } else if (tag.regName == "B") {
        return safeFea2scalar(ctx.Fr, ctx.B);
    } else if (tag.regName == "C") {
        return safeFea2scalar(ctx.Fr, ctx.C);
    } else if (tag.regName == "D") {
        return safeFea2scalar(ctx.Fr, ctx.D);
    } else if (tag.regName == "zkPC") {
        return Scalar.e(ctx.zkPC);
    } else if (tag.regName == "STEP") {
        return Scalar.e(ctx.step);
    } else {
        throw new Error(`Invalid register ${tag.regName} ${ctx.sourceRef}`);
    };
};

function eval_add(ctx, tag) {
    const a = evalCommand(ctx, tag.values[0]);
    const b = evalCommand(ctx, tag.values[1]);
    return Scalar.add(a,b);
};

function eval_sub(ctx, tag) {
    const a = evalCommand(ctx, tag.values[0]);
    const b = evalCommand(ctx, tag.values[1]);
    return Scalar.sub(a,b);
};

function eval_neg(ctx, tag) {
    const a = evalCommand(ctx, tag.values[0]);
    return Scalar.neg(a);
};

function eval_mul(ctx, tag) {
    const a = evalCommand(ctx, tag.values[0]);
    const b = evalCommand(ctx, tag.values[1]);
    return Scalar.mul(a,b);
};

function eval_div(ctx, tag) {
    const a = evalCommand(ctx, tag.values[0]);
    const b = evalCommand(ctx, tag.values[1]);
    return Scalar.div(a,b);
};

function eval_mod(ctx, tag) {
    const a = evalCommand(ctx, tag.values[0]);
    const b = evalCommand(ctx, tag.values[1]);
    return Scalar.mod(a,b);
};

function eval_bit_operation(ctx, tag) {
    const a = evalCommand(ctx, tag.values[0]);
    if (tag.op == "bitnot") {
        return ~a;
    };

    const b = evalCommand(ctx, tag.values[1]);

    switch(tag.op) {
        case 'bitor':    return Scalar.bor(a,b);
        case 'bitand':   return Scalar.band(a,b);
        case 'bitxor':   return Scalar.bxor(a,b);
        case 'shl':      return Scalar.shl(a,b);
        case 'shr':      return Scalar.shr(a,b);
    };

    throw new Error(`bit operation ${tag.op} not defined ${ctx.sourceRef}`);
};

function eval_if(ctx, tag)
{
    const a = evalCommand(ctx, tag.values[0]);
    return evalCommand(ctx, tag.values[ a ? 1:2]);
}

function eval_logical_operation(ctx, tag) {
    const a = evalCommand(ctx, tag.values[0]);

    if (tag.op === "not") {
        return (a)  ? 0 : 1;
    };

    const b = evalCommand(ctx, tag.values[1]);

    switch(tag.op) {
        case 'or':      return (a || b) ? 1 : 0;
        case 'and':     return (a && b) ? 1 : 0;
        case 'eq':      return (a == b) ? 1 : 0;
        case 'ne':      return (a != b) ? 1 : 0;
        case 'gt':      return (a > b)  ? 1 : 0;
        case 'ge':      return (a >= b) ? 1 : 0;
        case 'lt':      return (a < b)  ? 1 : 0;
        case 'le':      return (a > b)  ? 1 : 0;
    };

    throw new Error(`logical operation ${tag.op} not defined ${ctx.sourceRef}`);
};

function eval_functionCall(ctx, tag) {
    if (tag.funcName == "getAFreeInput") {
        return eval_getAFreeInput(ctx, tag);
    } else if (tag.funcName == "beforeLast") {
        return eval_beforeLast(ctx, tag)
    };
    
    throw new Error(`function ${tag.funcName} not defined ${ctx.sourceRef}`);
};

function eval_getAFreeInput(ctx, tag) {
    return [ctx.Fr.e(1), ctx.Fr.zero, ctx.Fr.zero, ctx.Fr.zero, ctx.Fr.zero, ctx.Fr.zero, ctx.Fr.zero, ctx.Fr.zero];
};

function eval_beforeLast(ctx) {
    if (ctx.step >= ctx.stepsN-2) {
        return [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
    } else {
        return [ctx.Fr.negone, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
    };
};

function safeFea2scalar(Fr, arr) {
    for (let index = 0; index < 8; ++index) {
        const value = Fr.toObject(arr[index]);

        if (value > 0xFFFFFFFFn) {
            throw new Error(`Invalid value 0x${value.toString(16)} to convert to scalar on index ${index}: ${sourceRef}`);
        };
    };

    return fea2scalar(Fr, arr);
};
