const fs = require("fs");
const tty = require('tty');
const { compile: compileZkasm } = require("@0xpolygonhermez/zkasmcom");
const { F1Field } = require("ffjavascript");
const { FGL } = require("pil-stark");
const { newConstantPolsArray, compile: compilePil } = require("pilcom");

const binarySM = require("./sm/binary_sm.js");
const paddingPGSM = require("./sm/padding_pg_sm.js");
const poseidonGSM = require("./sm/poseidong_sm.js");
const globalSM = require("./sm/global_sm.js");
const romSM = require("./sm/rom_sm.js");

const argv = require("yargs")
    .usage("main_buildconstants -r <rom.json> -o <constant.bin|json> [-p <main.pil>] [-P <pilconfig.json>] [-v]")
    .alias("r", "rom")
    .alias("o", "output")
    .alias("t", "text")
    .alias("p", "pil")
    .alias("P", "pilconfig")
    .alias("v", "verbose")
    .argv;

async function run() {
    if (typeof(argv.rom) !== "string") {
        throw new Error("A rom file needs to be specified")
    };

    if (typeof(argv.output) !== "string") {
        throw new Error("A output file needs to be specified")
    };

    const romFile = argv.rom.trim();
    const outputFile = argv.output.trim();
    const outputTextDir = argv.text ? (typeof argv.text == 'string' ? argv.text.trim() : ''):false;

    let pilFile = __dirname + "/../pil/main.pil";
    if (argv.pil) {
        if (typeof(argv.pil) !== "string") {
            throw new Error("Pil file needs to be specified with pil option")
        };
        pilFile = argv.pil.trim();
    };

    console.log('compile PIL ' + pilFile);

    const rom = await compileZkasm(romFile);
    const pil = await compilePil(FGL, pilFile);
    const constPols = newConstantPolsArray(pil);

    const N = constPols.Global.L1.length;
    console.log(`N = ${N}`);

    if (constPols.Binary) {
        console.log("Binary...");
        await binarySM.buildConstants(constPols.Binary);
    };

    if (constPols.Global) {
        console.log("Global...");
        await globalSM.buildConstants(constPols.Global);
    };

    if (constPols.PaddingPG) {
        console.log("PaddingPG...");
        await paddingPGSM.buildConstants(constPols.PaddingPG);
    };

    if (constPols.PoseidonG) {
        console.log("PoseidonG...");
        await poseidonGSM.buildConstants(constPols.PoseidonG);
    };

    if (constPols.Rom) {
        console.log("Rom...");
        await romSM.buildConstants(constPols.Rom, rom);
    };

    if (typeof outputTextDir === 'string') {
        let index = 0;
        const pathSep = (outputTextDir.length > 0 & !outputTextDir.endsWith('/')) ? '/':'';
        const blockSize = 16*1024;

        for (cpol of constPols.$$defArray) {
            const name = cpol.name + (typeof cpol.idx == 'undefined' ? '':('#'+cpol.idx));
            const polfile = outputTextDir + pathSep + name + '.txt';
            console.log(`saving constant ${name} on ${polfile}.... `);
            let output = await fs.promises.open(polfile, 'w');
            let from = 0;
            while (from < constPols.$$array[index].length) {
                res = await output.write(constPols.$$array[index].slice(from, from+blockSize).join("\n")+"\n");
                from += blockSize;
            }
            await output.close();
            ++index;
        };
    };

    for (let i = 0; i < constPols.$$array.length; i++) {
        for (let j = 0; j < N; j++) {
            if (typeof constPols.$$array[i][j] === "undefined") {
                throw new Error(`Polinomial not fited ${constPols.$$defArray[i].name} at ${j}` )
            };
        };
    };

    if (!fs.existsSync("./build")){
        fs.mkdirSync("./build");
    }

    await constPols.saveToFile(outputFile);

    console.log("Constants generated succefully!");
};

run().then(()=> {
    process.exit(0);
}, (err) => {
    console.log(err.message);
    console.log(err.stack);
    process.exit(1);
});
