const { scalar2fea } = require("@0xpolygonhermez/zkevm-commonjs").smtUtils;
const { Scalar, F1Field }  = require("ffjavascript");

module.exports.buildConstants = async function buildConstants(pols, rom) {

    const F = new F1Field("0xFFFFFFFF00000001");

    const N = pols.CONST0.length;

    if (rom.program.length > N) throw new Error("Rom is too big for this N");

    for (let i = 0; i < N; i++) {
        const pIndex = i < rom.program.length ? i : (rom.program.length-1);
        
        pols.CONST0[i] = rom.program[pIndex].CONST ? F.e(rom.program[pIndex].CONST) : F.zero;
        pols.CONST1[i] = F.zero;
        pols.CONST2[i] = F.zero;
        pols.CONST3[i] = F.zero;
        pols.CONST4[i] = F.zero;
        pols.CONST5[i] = F.zero;
        pols.CONST6[i] = F.zero;
        pols.CONST7[i] = F.zero;

        pols.inA[i] = rom.program[pIndex].inA ? F.e(rom.program[pIndex].inA) : F.zero;
        pols.inB[i] = rom.program[pIndex].inB ? F.e(rom.program[pIndex].inB) : F.zero;
        pols.inC[i] = rom.program[pIndex].inC ? F.e(rom.program[pIndex].inC) : F.zero;
        pols.inD[i] = rom.program[pIndex].inD ? F.e(rom.program[pIndex].inD) : F.zero;
        pols.inE[i] = rom.program[pIndex].inE ? F.e(rom.program[pIndex].inE) : F.zero;
        pols.inFREE[i] = rom.program[pIndex].inFREE ? F.e(rom.program[pIndex].inFREE) : F.zero;
        pols.inHASHPOS[i] = rom.program[pIndex].inHASHPOS ? F.e(rom.program[pIndex].inHASHPOS) : F.zero;

        pols.inCntBinary[i] = rom.program[pIndex].inCntBinary ? F.e(rom.program[pIndex].inCntBinary) : F.zero;
        pols.inCntPaddingPG[i] = rom.program[pIndex].inCntPaddingPG ? F.e(rom.program[pIndex].inCntPaddingPG) : F.zero;
        pols.inCntPoseidonG[i] = rom.program[pIndex].inCntPoseidonG ? F.e(rom.program[pIndex].inCntPoseidonG) : F.zero;

        /*
        *
        *   Code generated with:
        *   node tools/pil_pol_table/bits_compose.js "assert,hashP,hashPDigest,hashPLen,JMP,JMPN,setA,setB,setC,setD,setE,setHASHPOS,useJmpAddr,JMPZ,hashP1,useElseAddr"  -B -e -p "rom.program[pIndex]."
        *   inside https://github.com/0xPolygonHermez/zkevm-proverjs
        *
        */

        pols.operations[i] =
          (rom.program[pIndex].assert ? (2n**0n  * BigInt(rom.program[pIndex].assert)) : 0n)
        + (rom.program[pIndex].hashP ? (2n**1n  * BigInt(rom.program[pIndex].hashP)) : 0n)
        + (rom.program[pIndex].hashPDigest ? (2n**2n  * BigInt(rom.program[pIndex].hashPDigest)) : 0n)
        + (rom.program[pIndex].hashPLen ? (2n**3n  * BigInt(rom.program[pIndex].hashPLen)) : 0n)
        + (rom.program[pIndex].JMP ? (2n**4n  * BigInt(rom.program[pIndex].JMP)) : 0n)
        + (rom.program[pIndex].JMPN ? (2n**5n  * BigInt(rom.program[pIndex].JMPN)) : 0n)
        + (rom.program[pIndex].setA ? (2n**6n  * BigInt(rom.program[pIndex].setA)) : 0n)
        + (rom.program[pIndex].setB ? (2n**7n  * BigInt(rom.program[pIndex].setB)) : 0n)
        + (rom.program[pIndex].setC ? (2n**8n  * BigInt(rom.program[pIndex].setC)) : 0n)
        + (rom.program[pIndex].setD ? (2n**9n  * BigInt(rom.program[pIndex].setD)) : 0n)
        + (rom.program[pIndex].setE ? (2n**10n * BigInt(rom.program[pIndex].setE)) : 0n)
        + (rom.program[pIndex].setHASHPOS ? (2n**11n * BigInt(rom.program[pIndex].setHASHPOS)) : 0n)
        + (rom.program[pIndex].useJmpAddr ? (2n**12n * BigInt(rom.program[pIndex].useJmpAddr)) : 0n)
        + (rom.program[pIndex].JMPZ ? (2n**13n * BigInt(rom.program[pIndex].JMPZ)) : 0n)
        + (rom.program[pIndex].hashP1 ? (2n**14n * BigInt(rom.program[pIndex].hashP1)) : 0n)
        + (rom.program[pIndex].useElseAddr ? (2n**15n * BigInt(rom.program[pIndex].useElseAddr)) : 0n);       

        pols.jmpAddr[i] = rom.program[pIndex].jmpAddr ? BigInt(rom.program[pIndex].jmpAddr) : 0n;
        pols.elseAddr[i] = rom.program[pIndex].elseAddr ? BigInt(rom.program[pIndex].elseAddr) : 0n;
        pols.line[i] = BigInt(pIndex);
    };
};
