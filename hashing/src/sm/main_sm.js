const path = require("path");
const { ethers } = require("ethers");
const { Scalar, F1Field } = require("ffjavascript");
const { string2fea } = require("@0xpolygonhermez/zkevm-commonjs/src/smt-utils");

const {
    scalar2fea,
    fea2scalar,
    fe2n,
    scalar2h4,
    stringToH4,
    h4toString,
    nodeIsEq,
    hashContractBytecode,
    fea2String
} = require("@0xpolygonhermez/zkevm-commonjs").smtUtils;
const SMT = require("@0xpolygonhermez/zkevm-commonjs").SMT;
const Database = require("@0xpolygonhermez/zkevm-commonjs").Database;
const buildPoseidon = require("@0xpolygonhermez/zkevm-commonjs").getPoseidon;
const { byteArray2HexString, hexString2byteArray } = require("@0xpolygonhermez/zkevm-commonjs").utils;
const { encodedStringToArray, decodeCustomRawTxProverMethod} = require("@0xpolygonhermez/zkevm-commonjs").processorUtils;

const twoTo255 = Scalar.shl(Scalar.one, 255);
const twoTo256 = Scalar.shl(Scalar.one, 256);

const Mask256 = Scalar.sub(Scalar.shl(Scalar.e(1), 256), 1);
const byteMaskOn256 = Scalar.bor(Scalar.shl(Mask256, 256), Scalar.shr(Mask256, 8n));

const WarningCheck = 1;
const ErrorCheck = 2;

let fullTracer;
let debug;
let statsTracer;
let sourceRef;
let nameRomErrors = [];

module.exports.execute = async function (pols, input, rom, config = {}, metadata = {}) {
    const required = {
        Binary: [],
        PaddingPG: [],
        PoseidonG: [],
    };

    debug = config && config.debug;
    const flagTracer = config && config.tracer;
    const verboseOptions = typeof config.verboseOptions === 'undefined' ? {} : config.verboseOptions;
    const N = pols.zkPC.length;
    const stepsN = (debug && config.stepsN) ? config.stepsN : N;
    const skipAddrRelControl = (config && config.skipAddrRelControl) || false;

    const POSEIDONG_PERMUTATION1_ID = 1;
    const POSEIDONG_PERMUTATION2_ID = 2;

    if (config && config.unsigned){
        if (typeof input.from === 'undefined'){
            throw new Error('Unsigned flag requires a `from` in the input');
        }
    }

    const skipAsserts = config.unsigned || config.execute;
    const skipCounters = config.counters;

    const poseidon = await buildPoseidon();
    const Fr = poseidon.F;
    const Fec = new F1Field(0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn);
    const Fnec = new F1Field(0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n);

    const FrFirst32Negative = 0xFFFFFFFF00000001n - 0xFFFFFFFFn;
    const FrLast32Positive = 0xFFFFFFFFn;

    let op7, op6, op5, op4, op3, op2, op1, op0;

    const ctx = {
        hashP: [],
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
    }

    if (config.stats) {
        metadata.stats = {
            trace:[],
            lineTimes:[]
        };
    }

    initState(Fr, pols, ctx);

    let pendingCmds = false;

    if (debug && flagTracer) {
        fullTracer = new FullTracer(
            config.debugInfo.inputName,
            smt,
            {
                verbose: typeof verboseOptions.fullTracer === 'undefined' ? {} : verboseOptions.fullTracer
            }
        );
    };

    if (config.stats) {
        statsTracer = new StatsTracer(config.debugInfo.inputName);
    };

    let merkleTreeRoot;
    var merkleTreeLevel = 0;

    const checkJmpZero = config.checkJmpZero ? (config.checkJmpZero === "warning" ? WarningCheck:ErrorCheck) : false;
    const checkHashNoDigest = config.checkHashNoDigest ? (config.checkHashNoDigest === "warning" ? WarningCheck:ErrorCheck) : false;

    try {
    for (let step = 0; step < stepsN; step++) {
        const i = step % N;
        ctx.ln = Fr.toObject(pols.zkPC[i]);
        ctx.step = step;
        ctx.A = [pols.A0[i], pols.A1[i], pols.A2[i], pols.A3[i], pols.A4[i], pols.A5[i], pols.A6[i], pols.A7[i]];
        ctx.B = [pols.B0[i], pols.B1[i], pols.B2[i], pols.B3[i], pols.B4[i], pols.B5[i], pols.B6[i], pols.B7[i]];
        ctx.C = [pols.C0[i], pols.C1[i], pols.C2[i], pols.C3[i], pols.C4[i], pols.C5[i], pols.C6[i], pols.C7[i]];
        ctx.D = [pols.D0[i], pols.D1[i], pols.D2[i], pols.D3[i], pols.D4[i], pols.D5[i], pols.D6[i], pols.D7[i]];
        ctx.E = [pols.E0[i], pols.E1[i], pols.E2[i], pols.E3[i], pols.E4[i], pols.E5[i], pols.E6[i], pols.E7[i]];
        ctx.HASHPOS = pols.HASHPOS[i];
        ctx.zkPC = pols.zkPC[i];
        ctx.cntBinary = pols.cntBinary[i];
        ctx.cntPoseidonG = pols.cntPoseidonG[i];
        ctx.cntPaddingPG = pols.cntPaddingPG[i];

        // evaluate commands "after" before start new line, but when new values of registers are ready.
        if (pendingCmds) {
            evalCommands(ctx, pendingCmds);
            if (fullTracer){
                await eventsAsyncTracer(ctx, pendingCmds);
            }
            pendingCmds = false;
        }

        const l = rom.program[ ctx.zkPC ];

        if (config.stats) {
            statsTracer.addZkPC(ctx.zkPC);
            metadata.stats.trace.push(ctx.zkPC);
            metadata.stats.lineTimes[ctx.zkPC] = (metadata.stats.lineTimes[ctx.zkPC] || 0) + 1;
        }

        ctx.fileName = l.fileName;
        ctx.line = l.line;
        sourceRef = `[w:${step} zkPC:${ctx.ln} ${ctx.fileName}:${ctx.line}]`;
        ctx.sourceRef = sourceRef;

        if (verboseOptions.zkPC) {
            console.log(sourceRef);
        }

        // Store the Merkle tree root before it is set to 0 at finalizeExecution
        if(Number(ctx.zkPC) === rom.labels.finalizeExecution) {
            merkleTreeRoot = fea2String(Fr, ctx.A);
        }

        let incHashPos = 0;
        let incCounter = 0;

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

        if (l.inE) {
            [op0, op1, op2, op3, op4, op5, op6, op7] = [
                Fr.add(op0, Fr.mul( Fr.e(l.inE), ctx.E[0])),
                Fr.add(op1, Fr.mul( Fr.e(l.inE), ctx.E[1])),
                Fr.add(op2, Fr.mul( Fr.e(l.inE), ctx.E[2])),
                Fr.add(op3, Fr.mul( Fr.e(l.inE), ctx.E[3])),
                Fr.add(op4, Fr.mul( Fr.e(l.inE), ctx.E[4])),
                Fr.add(op5, Fr.mul( Fr.e(l.inE), ctx.E[5])),
                Fr.add(op6, Fr.mul( Fr.e(l.inE), ctx.E[6])),
                Fr.add(op7, Fr.mul( Fr.e(l.inE), ctx.E[7]))
            ];
            pols.inE[i] = Fr.e(l.inE);
        } else {
            pols.inE[i] = Fr.zero;
        };

        if (l.inHASHPOS) {
            op0 = Fr.add(op0, Fr.mul( Fr.e(l.inHASHPOS), Fr.e(ctx.HASHPOS)));
            pols.inHASHPOS[i] = Fr.e(l.inHASHPOS);
        } else {
            pols.inHASHPOS[i] = Fr.zero;
        };

        // COUNTERS
        if (l.inCntBinary) {
            op0 = Fr.add(op0, Fr.mul( Fr.e(l.inCntBinary), Fr.e(ctx.cntBinary)));
            pols.inCntBinary[i] = Fr.e(l.inCntBinary);
        } else {
            pols.inCntBinary[i] = Fr.zero;
        };

        if (l.inCntPoseidonG) {
            op0 = Fr.add(op0, Fr.mul( Fr.e(l.inCntPoseidonG), Fr.e(ctx.cntPoseidonG)));
            pols.inCntPoseidonG[i] = Fr.e(l.inCntPoseidonG);
        } else {
            pols.inCntPoseidonG[i] = Fr.zero;
        };

        if (l.inCntPaddingPG) {
            op0 = Fr.add(op0, Fr.mul( Fr.e(l.inCntPaddingPG), Fr.e(ctx.cntPaddingPG)));
            pols.inCntPaddingPG[i] = Fr.e(l.inCntPaddingPG);
        } else {
            pols.inCntPaddingPG[i] = Fr.zero;
        };

        if ((!isNaN(l.CONSTL))&&(l.CONSTL)) {
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
        let addr = ctx.cntBinary;

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

                if (l.hashP || l.hashP1) {
                    if (typeof ctx.hashP[addr] === "undefined") ctx.hashP[addr] = { data: [], reads: {}, digestCalled: false, lenCalled: false, sourceRef };
                    const size = l.hashP1 ? 1 : fe2n(Fr, ctx.D[0], ctx);
                    const pos = fe2n(Fr, ctx.HASHPOS, ctx);

                    if ((size<0) || (size>32)) throw new Error(`Invalid size for hash ${sourceRef}`);
                    if (pos+size > ctx.hashP[addr].data.length) throw new Error(`Accessing hashP(${addr}) out of bounds ${sourceRef}`);
                    let s = Scalar.zero;

                    for (let k = 0; k < size; k++) {
                        if (typeof ctx.hashP[addr].data[pos + k] === "undefined") throw new Error(`Accessing hashP(${addr}) not defined place ${pos+k} ${sourceRef}`);
                        s = Scalar.add(Scalar.mul(s, 256), Scalar.e(ctx.hashP[addr].data[pos + k]));
                    };

                    fi = scalar2fea(Fr, s);
                    nHits++;
                };

                if (l.hashPDigest == 1) {
                    if (typeof ctx.hashP[addr] === "undefined") {
                        throw new Error(`digest(${addr}) not defined ${sourceRef}`);
                    };

                    if (typeof ctx.hashP[addr].digest === "undefined") {
                        throw new Error(`digest(${addr}) not calculated. Call hashPlen to finish digest ${sourceRef}`);
                    };

                    fi = scalar2fea(Fr, ctx.hashP[addr].digest);
                    nHits++;
                };

                if (l.memAlignRD) {
                    const m0 = safeFea2scalar(Fr, ctx.A);
                    const m1 = safeFea2scalar(Fr, ctx.B);
                    const P2_256 = 2n ** 256n;
                    const MASK_256 = P2_256 - 1n;
                    const offset = safeFea2scalar(Fr, ctx.C);

                    if (offset < 0 || offset > 32) {
                        throw new Error(`MemAlign out of range (${offset})  ${sourceRef}`);
                    };

                    const leftV = Scalar.band(Scalar.shl(m0, offset * 8n), MASK_256);
                    const rightV = Scalar.band(Scalar.shr(m1, 256n - (offset * 8n)), MASK_256 >> (256n - (offset * 8n)));
                    const _V = Scalar.bor(leftV, rightV);

                    fi = scalar2fea(Fr, _V);
                    nHits ++;
                };

                if (nHits==0) {
                    throw new Error(`Empty freeIn without a valid instruction ${sourceRef}`);
                };

                if (nHits>1) {
                    throw new Error(`Only one instruction that requires freeIn is allowed ${sourceRef}`);
                };
            } else if (l.freeInTag.funcName == "getPathIndex") {
                fi = evalCommand(ctx, { ...l.freeInTag, params: merkleTreeLevel });
                if (!Array.isArray(fi)) fi = scalar2fea(Fr, fi);
                merkleTreeLevel++;
            } else if (l.freeInTag.funcName == "getPathValue") {
                fi = evalCommand(ctx, { ...l.freeInTag, params: merkleTreeLevel - 1 });
                if (!Array.isArray(fi)) fi = scalar2fea(Fr, fi);
            } else {
                fi = evalCommand(ctx, l.freeInTag);
                if (!Array.isArray(fi)) fi = scalar2fea(Fr, fi);
            };

            [pols.FREE0[i], pols.FREE1[i], pols.FREE2[i], pols.FREE3[i], pols.FREE4[i], pols.FREE5[i], pols.FREE6[i], pols.FREE7[i]] = fi;
            
            [op0, op1, op2, op3, op4, op5, op6, op7] = [
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[0]), op0 ),
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[1]), op1 ),
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[2]), op2 ),
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[3]), op3 ),
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[4]), op4 ),
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[5]), op5 ),
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[6]), op6 ),
                Fr.add( Fr.mul(Fr.e(l.inFREE), fi[7]), op7 )
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
        if (l.assert) {
            if ((Number(ctx.zkPC) === rom.labels.assertNewStateRoot) && skipAsserts){
                console.log("Skip assert newStateRoot");
            } else if ((Number(ctx.zkPC) === rom.labels.assertNewLocalExitRoot) && skipAsserts){
                console.log("Skip assert newLocalExitRoot");
            } else if (
                    (!Fr.eq(ctx.A[0], op0)) ||
                    (!Fr.eq(ctx.A[1], op1)) ||
                    (!Fr.eq(ctx.A[2], op2)) ||
                    (!Fr.eq(ctx.A[3], op3)) ||
                    (!Fr.eq(ctx.A[4], op4)) ||
                    (!Fr.eq(ctx.A[5], op5)) ||
                    (!Fr.eq(ctx.A[6], op6)) ||
                    (!Fr.eq(ctx.A[7], op7))
            ) {
                throw new Error(`Assert does not match ${sourceRef} (op:${fea2scalar(Fr, [op0, op1, op2, op3, op4, op5, op6, op7])} A:${fea2scalar(Fr, ctx.A)})`);
            };

            pols.assert[i] = 1n;
        } else {
            pols.assert[i] = 0n;
        };
        
        if (l.hashP || l.hashP1) {
            if (typeof ctx.hashP[addr] === "undefined") ctx.hashP[addr] = { data: [], reads: {}, digestCalled: false, lenCalled: false, sourceRef };
            
            pols.hashP[i] = l.hashP ? 1n : 0n;
            pols.hashP1[i] = l.hashP1 ? 1n : 0n;

            const size = l.hashP1 ? 1 : fe2n(Fr, ctx.D[0], ctx);
            const pos = fe2n(Fr, ctx.HASHPOS, ctx);

            if ((size<0) || (size>32)) throw new Error(`HashP(${addr}) invalid size ${size} ${sourceRef}`);

            const a = safeFea2scalar(Fr, [op0, op1, op2, op3, op4, op5, op6, op7]);
            const maskByte = Scalar.e("0xFF");

            for (let k=0; k<size; k++) {
                const bm = Scalar.toNumber(Scalar.band( Scalar.shr( a, (size-k -1)*8 ) , maskByte));
                const bh = ctx.hashP[addr].data[pos + k];

                if (typeof bh === "undefined") {
                    ctx.hashP[addr].data[pos + k] = bm;
                } else if (bm != bh) {
                    throw new Error(`HashP(${addr}) do not match pos ${pos+k} is ${bm} and should be ${bh} ${sourceRef}`)
                };
            };

            const paddingA = Scalar.shr(a, size * 8);
            
            if (!Scalar.isZero(paddingA)) {
                throw new Error(`HashP(${addr}) incoherent size (${size}) and data (0x${a.toString(16)}) padding (0x${paddingA.toString(16)}) (w=${step}) ${sourceRef}`);
            };

            if ((typeof ctx.hashP[addr].reads[pos] !== "undefined") && (ctx.hashP[addr].reads[pos] != size)) {
                throw new Error(`HashP(${addr}) diferent read sizes in the same position ${pos} (${ctx.hashP[addr].reads[pos]} != ${size}) ${sourceRef}`);
            };

            ctx.hashP[addr].reads[pos] = size;
            ctx.hashP[addr].sourceRef = sourceRef;
            incHashPos = size;
        } else {
            pols.hashP[i] = 0n;
            pols.hashP1[i] = 0n;
        };

        if (l.hashPLen) {
            pols.hashPLen[i] = 1n;

            if (typeof ctx.hashP[addr] === "undefined") {
                ctx.hashP[addr] = { data: [], reads: {} , digestCalled: false};
            };

            const lh = ctx.hashP[addr].data.length;
            const lm = fe2n(Fr, op0, ctx);

            if (lm != lh) throw new Error(`HashPLen(${addr}) length does not match is ${lm} and should be ${lh} ${sourceRef}`);

            if (typeof ctx.hashP[addr].digest === "undefined") {
                // ctx.hashP[addr].digest = poseidonLinear(ctx.hash[addr].data);
                ctx.hashP[addr].digest = await hashContractBytecode(byteArray2HexString(ctx.hashP[addr].data));
                ctx.hashP[addr].digestCalled = false;
            };

            ctx.hashP[addr].sourceRef = sourceRef;

            if (ctx.hashP[addr].lenCalled) {
                throw new Error(`Call HASHPLEN @${addr} more than once: ${ctx.ln} at ${ctx.fileName}:${ctx.line}`);
            };

            ctx.hashP[addr].lenCalled = true;
            addr++
        } else {
            pols.hashPLen[i] = 0n;
        };

        if (l.hashPDigest) {
            pols.hashPDigest[i] = 1n;
            const dg = safeFea2scalar(Fr, [op0, op1, op2, op3, op4, op5, op6, op7]);

            if (ctx.hashP[addr].digestCalled) {
                throw new Error(`Call HASHPDIGEST @${addr} more than once: ${ctx.ln} at ${ctx.fileName}:${ctx.line}`);
            };

            ctx.hashP[addr].digestCalled = true;
            incCounter = Math.ceil((ctx.hashP[addr].data.length + 1) / 56);

            if (!Scalar.eq(Scalar.e(dg), Scalar.e(ctx.hashP[addr].digest))) {
                throw new Error(`HashPDigest(${addr}) doesn't match ${sourceRef}`);
            };
        } else {
            pols.hashPDigest[i] = 0n;
        };

        if (l.hashPDigest) {
            const op = safeFea2scalar(Fr, [op0, op1, op2, op3, op4, op5, op6, op7]);
            required.Binary.push({a: op, b: 0n, c: op, opcode: 0, type: 2});
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

        if (l.setE == 1) {
            pols.setE[i]=1n;

            [
                pols.E0[nexti],
                pols.E1[nexti],
                pols.E2[nexti],
                pols.E3[nexti],
                pols.E4[nexti],
                pols.E5[nexti],
                pols.E6[nexti],
                pols.E7[nexti]
            ] = [op0, op1, op2, op3, op4, op5, op6, op7];
        } else {
            pols.setE[i]=0n;

            [
                pols.E0[nexti],
                pols.E1[nexti],
                pols.E2[nexti],
                pols.E3[nexti],
                pols.E4[nexti],
                pols.E5[nexti],
                pols.E6[nexti],
                pols.E7[nexti]
            ] = [
                pols.E0[i],
                pols.E1[i],
                pols.E2[i],
                pols.E3[i],
                pols.E4[i],
                pols.E5[i],
                pols.E6[i],
                pols.E7[i]
            ];
        };

        if (!skipCounters && l.hashPDigest) {
            pols.cntBinary[nexti] = pols.cntBinary[i] + 1n;
        } else {
            pols.cntBinary[nexti] = pols.cntBinary[i];
        }

        pols.JMP[i] = 0n;
        pols.JMPN[i] = 0n;
        pols.JMPZ[i] = 0n;

        pols.jmpAddr[i] = l.jmpAddr ? BigInt(l.jmpAddr) : 0n;
        pols.useJmpAddr[i] = l.useJmpAddr ? 1n: 0n;

        const finalJmpAddr = l.useJmpAddr ? l.jmpAddr : addr;
        const nextNoJmpZkPC = pols.zkPC[i] + ((l.repeat && !Fr.isZero(ctx.RCX)) ? 0n:1n);

        let elseAddr = l.useElseAddr ? BigInt(l.elseAddr) : nextNoJmpZkPC;
        // modify JMP 'elseAddr' to continue execution in case of an unsigned transaction
        if (config.unsigned && l.elseAddrLabel === 'invalidIntrinsicTxSenderCode') {
            elseAddr = BigInt(finalJmpAddr);
        }

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

            pols.lJmpnCondValue[i] = jmpnCondValue & 0x1FFFFn;  // 2 ** 17 - 1, seeing that N = 2 ** 17
            jmpnCondValue = jmpnCondValue >> 17n;

            for (let index = 0; index < 15; ++index) {
                pols.hJmpnCondValueBit[index][i] = jmpnCondValue & 0x01n;
                jmpnCondValue = jmpnCondValue >> 1n;
            };

            pols.JMPN[i] = 1n;
        } else {
            pols.isNeg[i] = 0n;
            pols.lJmpnCondValue[i] = 0n;

            for (let index = 0; index < 15; ++index) {
                pols.hJmpnCondValueBit[index][i] = 0n;
            };

            if (l.JMPZ) {
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

        if (l.setHASHPOS == 1) {
            pols.setHASHPOS[i]=1n;
            pols.HASHPOS[nexti] = BigInt(fe2n(Fr, op0, ctx) + incHashPos);
        } else {
            pols.setHASHPOS[i]=0n;
            pols.HASHPOS[nexti] = pols.HASHPOS[i] + BigInt( incHashPos);
        };

        if (l.hashPDigest) {
            pols.incCounter[i] = Fr.e(incCounter);
        } else {
            pols.incCounter[i] = Fr.zero;
        };

        // Setting current value of counters to next step
        if (l.hashPDigest) {
            if (skipCounters) {
                pols.cntPaddingPG[nexti] = pols.cntPaddingPG[i];
                pols.cntPoseidonG[nexti] = pols.cntPoseidonG[i];
            } else {
                pols.cntPaddingPG[nexti] = pols.cntPaddingPG[i] + BigInt(incCounter);
                pols.cntPoseidonG[nexti] = pols.cntPoseidonG[i] + BigInt(incCounter);
            };
        } else {
            pols.cntPaddingPG[nexti] = pols.cntPaddingPG[i];
            pols.cntPoseidonG[nexti] = pols.cntPoseidonG[i];
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
    };
    } catch (error) {
        if (!error.message.includes(sourceRef)) {
            error.message += ' '+sourceRef;
        }
        throw error;
    };

    if (config.stats) {
        statsTracer.saveStatsFile();
    };

    for (let i = 0; i < ctx.hashP.length; i++) {
        if (typeof ctx.hashP[i] === 'undefined') {
            const nextAddr = Object.keys(ctx.hashP)[i];
            throw new Error(`Reading hashP(${i}) not defined, next defined was ${nextAddr} on ${ctx.hashP[nextAddr].sourceRef||''}`);
        };

        const h = {
            data: ctx.hashP[i].data,
            digestCalled: ctx.hashP[i].digestCalled,
            lenCalled: ctx.hashP[i].lenCalled,
            reads: []
        };

        let p= 0;

        while (p<ctx.hashP[i].data.length) {
            if (ctx.hashP[i].reads[p]) {
                h.reads.push(ctx.hashP[i].reads[p]);
                p += ctx.hashP[i].reads[p];
            } else {
                h.reads.push(1);
                p += 1;
            };
        };

        if (p!= ctx.hashP[i].data.length) {
            throw new Error(`Reading hashP(${i}) out of limits (${p} != ${ctx.hashP[i].data.length})`);
        };

        if (checkHashNoDigest && !ctx.hashP[i].digestCalled) {
            const msg = `Reading hashP(${i}) not call to hashPDigest, last access on ${ctx.hashP[i].sourceRef||''}`;

            if (checkHashNoDigest === ErrorCheck) {
                throw new Error('ERROR:'+msg);
            };

            console.log('WARNING:'+msg)
        };

        required.PaddingPG.push(h);
    };

    required.logs = ctx.outLogs;
    required.errors = nameRomErrors;

    required.counters = {
        cntBinary: ctx.cntBinary,
        cntPoseidonG: ctx.cntPoseidonG,
        cntPaddingPG: ctx.cntPaddingPG,
        cntSteps: ctx.step,
    };

    required.output = {
        merkleTreeRoot: merkleTreeRoot,
    };

    return required;
};

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
    pols.E0[0] = Fr.zero;
    pols.E1[0] = Fr.zero;
    pols.E2[0] = Fr.zero;
    pols.E3[0] = Fr.zero;
    pols.E4[0] = Fr.zero;
    pols.E5[0] = Fr.zero;
    pols.E6[0] = Fr.zero;
    pols.E7[0] = Fr.zero;
    pols.HASHPOS[0] = 0n;
    pols.zkPC[0] = 0n;
    pols.cntBinary[0] = 0n;
    pols.cntPaddingPG[0] = 0n;
    pols.cntPoseidonG[0] = 0n;
    pols.op0Inv[0] = 0n;
};

async function eventsAsyncTracer(ctx, cmds) {
    for (let j = 0; j < cmds.length; j++) {
        const tag = cmds[j];
        if (tag.funcName == 'eventLog') {
            await fullTracer.handleAsyncEvent(ctx, cmds[j]);
        };
    };
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
    } else if (tag.regName == "E") {
        return safeFea2scalar(ctx.Fr, ctx.E);
    } else if (tag.regName == "SR") {
        return safeFea2scalar(ctx.Fr, ctx.SR);
    } else if (tag.regName == "CTX") {
        return Scalar.e(ctx.CTX);
    } else if (tag.regName == "SP") {
        return Scalar.e(ctx.SP);
    } else if (tag.regName == "PC") {
        return Scalar.e(ctx.PC);
    } else if (tag.regName == "GAS") {
        return Scalar.e(ctx.GAS);
    } else if (tag.regName == "zkPC") {
        return Scalar.e(ctx.zkPC);
    } else if (tag.regName == "RR") {
        return Scalar.e(ctx.RR);
    } else if (tag.regName == "CNT_BINARY") {
        return Scalar.e(ctx.cntBinary);
    } else if (tag.regName == "CNT_KECCAK_F") {
        return Scalar.e(ctx.cntKeccakF);
    } else if (tag.regName == "CNT_MEM_ALIGN") {
        return Scalar.e(ctx.cntMemAlign);
    } else if (tag.regName == "CNT_PADDING_PG") {
        return Scalar.e(ctx.cntPaddingPG);
    } else if (tag.regName == "CNT_POSEIDON_G") {
        return Scalar.e(ctx.cntPoseidonG);
    } else if (tag.regName == "STEP") {
        return Scalar.e(ctx.step);
    } else if (tag.regName == "HASHPOS") {
        return Scalar.e(ctx.HASHPOS);
    } else if (tag.regName == "RCX") {
        return Scalar.e(ctx.RCX);
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

function eval_if(ctx, tag) {
    const a = evalCommand(ctx, tag.values[0]);
    return evalCommand(ctx, tag.values[ a ? 1:2]);
};

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
    if (tag.funcName == "beforeLast") {
        return eval_beforeLast(ctx, tag)
    } else if (tag.funcName == "getMerkleTreeHeight") {
        return eval_getMerkleTreeHeight(ctx, tag);
    } else if (tag.funcName == "getMerkleTreeRoot") {
        return eval_getMerkleTreeRoot(ctx, tag);
    } else if (tag.funcName == "getLeafValue") {
        return eval_getLeafValue(ctx, tag);
    } else if (tag.funcName == "getPathIndex") {
        return eval_getPathIndex(ctx, tag);
    } else if (tag.funcName == "getPathValue") {
        return eval_getPathValue(ctx, tag);
    };

    throw new Error(`function ${tag.funcName} not defined ${ctx.sourceRef}`);
};

function eval_beforeLast(ctx) {
    if (ctx.step >= ctx.stepsN-2) {
        return [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
    } else {
        return [ctx.Fr.negone, 0n, 0n, 0n, 0n, 0n, 0n, 0n];
    };
};

function eval_getMerkleTreeHeight(ctx, tag) {
    return scalar2fea(ctx.Fr, Scalar.e(ctx.input.merkleTreeHeight));
};

function eval_getMerkleTreeRoot(ctx, tag) {
    return scalar2fea(ctx.Fr, Scalar.e(ctx.input.merkleTreeRoot));
};

function eval_getLeafValue(ctx, tag) {
    return scalar2fea(ctx.Fr, Scalar.e(ctx.input.leafValue));
};

function eval_getPathIndex(ctx, tag) {
    return scalar2fea(ctx.Fr, Scalar.e(ctx.input.pathIndices[tag.params]));
};

function eval_getPathValue(ctx, tag) {
    return scalar2fea(ctx.Fr, Scalar.e(ctx.input.pathValues[tag.params]));
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
