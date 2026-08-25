import * as r1cs from "../src/r1csfile.js";
import { F1Field, getCurveFromR } from "ffjavascript";
import * as binFileUtils from "@iden3/binfileutils";
import path from "path";
import assert from "assert";
import fs from "fs";
import os from "os";

import { stringifyBigInts } from "./r1csfile.js";

const examplePath = path.join("test", "testutils", "example.r1cs");

function tmpFile(tag) {
    return path.join(os.tmpdir(), `r1csfile-test-${tag}-${process.pid}.r1cs`);
}

const collectingLogger = (lines) => ({
    info: (m) => lines.push(m),
    debug: (m) => lines.push(m),
    warn: (m) => lines.push(m),
    error: (m) => lines.push(m),
});

describe("R1CS writing and reading round-trip", function () {
    this.timeout(1000000000);

    it("writeR1cs(readR1cs(file)) preserves the circuit", async () => {
        const cir = await r1cs.readR1cs(examplePath, { loadConstraints: true, loadMap: true });
        const curve = cir.curve;

        const outPath = tmpFile("roundtrip");
        const lines = [];
        try {
            await r1cs.writeR1cs(outPath, cir, collectingLogger(lines), "RT");

            const cir2 = await r1cs.readR1cs(outPath, { loadConstraints: true, loadMap: true });
            const curve2 = cir2.curve;

            const a = stringifyBigInts(curve.Fr, {
                constraints: cir.constraints, map: cir.map,
                nVars: cir.nVars, nOutputs: cir.nOutputs, nPubInputs: cir.nPubInputs,
                nPrvInputs: cir.nPrvInputs, nLabels: cir.nLabels, nConstraints: cir.nConstraints,
            });
            const b = stringifyBigInts(curve2.Fr, {
                constraints: cir2.constraints, map: cir2.map,
                nVars: cir2.nVars, nOutputs: cir2.nOutputs, nPubInputs: cir2.nPubInputs,
                nPrvInputs: cir2.nPrvInputs, nLabels: cir2.nLabels, nConstraints: cir2.nConstraints,
            });
            assert.deepEqual(b, a);
            assert(lines.length > 0, "expected write progress to be logged");

            await curve2.terminate();
        } finally {
            await curve.terminate();
            if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        }
    });

    it("writeR1cs works without a logger and via cir.curve.Fr when cir.F is absent", async () => {
        const cir = await r1cs.readR1cs(examplePath, { loadConstraints: true, loadMap: true });
        const curve = cir.curve;
        delete cir.F; // writeConstraint must fall back to cir.curve.Fr

        const outPath = tmpFile("nof");
        try {
            await r1cs.writeR1cs(outPath, cir);
            const cir2 = await r1cs.readR1cs(outPath, { loadConstraints: true });
            assert.strictEqual(cir2.nConstraints, cir.nConstraints);
            await cir2.curve.terminate();
        } finally {
            await curve.terminate();
            if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        }
    });

    it("writeR1csMap rejects a map whose size does not match nVars", async () => {
        const cir = await r1cs.readR1cs(examplePath, { loadConstraints: true, loadMap: true });
        const curve = cir.curve;
        cir.map = cir.map.slice(0, cir.map.length - 1);

        const outPath = tmpFile("badmap");
        try {
            await assert.rejects(r1cs.writeR1cs(outPath, cir), /Invalid map size/);
        } finally {
            await curve.terminate();
            if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        }
    });

    it("round-trips a circuit over a non-standard prime (F1Field fallback)", async () => {
        // A prime that is neither bn128's nor bls12-381's r: getCurveFromR
        // throws and readR1csHeader must fall back to a plain F1Field.
        const prime = 18446744069414584321n; // goldilocks
        const F = new F1Field(prime);
        const cir = {
            n8: 8,
            prime: prime,
            F: F,
            nVars: 3,
            nOutputs: 1,
            nPubInputs: 1,
            nPrvInputs: 1,
            nLabels: 5,
            constraints: [
                [{ 0: F.e(2), 2: F.e(3) }, { 1: F.e(4) }, { 2: F.e(1) }],
                [{ 1: F.e(7) }, {}, { 0: F.e(5) }],
            ],
            map: [0, 2, 4],
        };

        const outPath = tmpFile("goldilocks");
        try {
            await r1cs.writeR1cs(outPath, cir);
            const cir2 = await r1cs.readR1cs(outPath, { loadConstraints: true, loadMap: true });

            assert.strictEqual(cir2.curve, undefined, "no curve expected for a non-pairing prime");
            assert(cir2.F instanceof F1Field);
            assert.strictEqual(cir2.F.p, prime);
            assert.strictEqual(cir2.nConstraints, 2);
            assert.deepEqual(cir2.map, [0, 2, 4]);
            assert.strictEqual(cir2.F.toString(cir2.constraints[0][0][2]), "3");
            assert.strictEqual(cir2.F.toString(cir2.constraints[1][2][0]), "5");
        } finally {
            if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        }
    });
});

describe("readR1csHeader field-resolution options", function () {
    this.timeout(1000000000);

    async function withFd(cb) {
        const { fd, sections } = await binFileUtils.readBinFile(examplePath, "r1cs", 1, 1 << 20, 1 << 14);
        try {
            return await cb(fd, sections);
        } finally {
            await fd.close();
        }
    }

    it("defaults when singleThread is undefined, accepts a boolean too", async () => {
        const header = await withFd((fd, sections) => r1cs.readR1csHeader(fd, sections));
        assert.strictEqual(header.nVars, 7);
        await header.curve.terminate();

        const header2 = await withFd((fd, sections) => r1cs.readR1csHeader(fd, sections, true));
        assert.strictEqual(header2.nVars, 7);
        if (header2.curve) await header2.curve.terminate();
    });

    it("uses a caller-provided field and validates its prime", async () => {
        const bn128r = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
        const F = new F1Field(bn128r);
        const header = await withFd((fd, sections) => r1cs.readR1csHeader(fd, sections, { F }));
        assert.strictEqual(header.F, F);

        const wrongF = new F1Field(23n);
        await assert.rejects(
            withFd((fd, sections) => r1cs.readR1csHeader(fd, sections, { F: wrongF })),
            /Different Prime/);
    });

    it("uses getFieldFromPrime and getCurveFromPrime factories when provided", async () => {
        let fieldCalls = 0;
        const header = await withFd((fd, sections) => r1cs.readR1csHeader(fd, sections, {
            getFieldFromPrime: async (p) => { fieldCalls++; return new F1Field(p); },
        }));
        assert.strictEqual(fieldCalls, 1);
        assert(header.F instanceof F1Field);

        let curveCalls = 0;
        const header2 = await withFd((fd, sections) => r1cs.readR1csHeader(fd, sections, {
            getCurveFromPrime: async (p) => { curveCalls++; return { Fr: new F1Field(p) }; },
        }));
        assert.strictEqual(curveCalls, 1);
        assert(header2.F instanceof F1Field);
        assert(header2.curve.Fr === header2.F);
    });
});

describe("reader entry points and legacy signatures", function () {
    this.timeout(1000000000);

    it("readR1cs with no options loads constraints and custom gates by default", async () => {
        const cir = await r1cs.readR1cs(examplePath);
        assert(Array.isArray(cir.constraints));
        assert.strictEqual(cir.map, undefined);
        assert.deepEqual(cir.customGates, []);
        assert.deepEqual(cir.customGatesUses, []);
        await cir.curve.terminate();
    });

    it("readR1csFd rejects non-object options", async () => {
        const { fd, sections } = await binFileUtils.readBinFile(examplePath, "r1cs", 1, 1 << 20, 1 << 14);
        try {
            await assert.rejects(r1cs.readR1csFd(fd, sections), /options must be an object/);
        } finally {
            await fd.close();
        }
    });

    it("readConstraints and readMap accept legacy (logger, loggerCtx) arguments", async () => {
        const { fd, sections } = await binFileUtils.readBinFile(examplePath, "r1cs", 1, 1 << 20, 1 << 14);
        const header = await r1cs.readR1csHeader(fd, sections, { getFieldFromPrime: async (p) => new F1Field(p) });
        try {
            const lines = [];

            // options-object form with logger + loggerCtx
            const constraintsOpt = await r1cs.readConstraints(fd, sections, header,
                { logger: collectingLogger(lines), loggerCtx: "OPT" });
            assert.strictEqual(constraintsOpt.length, header.nConstraints);
            assert(lines.some((l) => l.includes("OPT")));

            // legacy positional form: any OBJECT 4th argument is treated as
            // options, so the positional branch only fires for a non-object
            // logger -- a function carrying .info exercises it.
            const legacyLines = [];
            const loggerFn = () => {};
            loggerFn.info = (m) => legacyLines.push(m);
            const constraints = await r1cs.readConstraints(fd, sections, header, loggerFn, "LEGACY");
            assert.strictEqual(constraints.length, header.nConstraints);
            assert(legacyLines.some((l) => l.includes("LEGACY")));

            const map = await r1cs.readMap(fd, sections, header, loggerFn, "LEGACY");
            assert.strictEqual(map.length, header.nVars);

            // undefined logger
            const constraints2 = await r1cs.readConstraints(fd, sections, header);
            assert.strictEqual(constraints2.length, header.nConstraints);
            const map2 = await r1cs.readMap(fd, sections, header);
            assert.strictEqual(map2.length, header.nVars);
        } finally {
            await fd.close();
        }
    });
});

describe("BigArray paths for circuits above the 2^20 threshold", function () {
    this.timeout(1000000000);

    it("uses BigArray for constraints, map and custom gate uses", async () => {
        // Craft a syntactically valid r1cs with (2^20)+1 empty constraints,
        // (2^20)+1 map entries and (2^20)+1 custom gate uses over a
        // non-pairing prime (fast F1Field header, no wasm curve).
        const N = (1 << 20) + 1;
        const prime = 18446744069414584321n;
        const n8 = 8;

        const outPath = tmpFile("bigarray");
        const fd = await binFileUtils.createBinFile(outPath, "r1cs", 1, 5, 1 << 25, 1 << 22);

        // header
        await binFileUtils.startWriteSection(fd, 1);
        await fd.writeULE32(n8);
        await binFileUtils.writeBigInt(fd, prime, n8);
        await fd.writeULE32(N);      // nVars
        await fd.writeULE32(0);      // nOutputs
        await fd.writeULE32(0);      // nPubInputs
        await fd.writeULE32(0);      // nPrvInputs
        await fd.writeULE64(N);      // nLabels
        await fd.writeULE32(N);      // nConstraints
        await binFileUtils.endWriteSection(fd);

        // constraints: each is three empty linear combinations (3 x u32 zero)
        await binFileUtils.startWriteSection(fd, 2);
        await fd.write(new Uint8Array(N * 12));
        await binFileUtils.endWriteSection(fd);

        // map: N zero labels
        await binFileUtils.startWriteSection(fd, 3);
        await fd.write(new Uint8Array(N * 8));
        await binFileUtils.endWriteSection(fd);

        // custom gates list: zero gates
        await binFileUtils.startWriteSection(fd, 4);
        await fd.writeULE32(0);
        await binFileUtils.endWriteSection(fd);

        // custom gate uses: N uses with id 0 and no signals
        await binFileUtils.startWriteSection(fd, 5);
        const uses = new Uint8Array(4 + N * 8);
        new DataView(uses.buffer).setUint32(0, N, true);
        await fd.write(uses);
        await binFileUtils.endWriteSection(fd);

        await fd.close();

        try {
            const lines = [];
            const cir = await r1cs.readR1cs(outPath, {
                loadConstraints: true, loadMap: true, loadCustomGates: true,
                logger: collectingLogger(lines), loggerCtx: "BIG",
            });

            assert.strictEqual(cir.constraints.length, N);
            assert.strictEqual(cir.map.length, N);
            assert.strictEqual(cir.customGatesUses.length, N);
            assert(!Array.isArray(cir.constraints), "constraints should be a BigArray proxy");
            assert.deepEqual(cir.constraints[N - 1], [{}, {}, {}]);
            assert.strictEqual(cir.map[N - 1], 0);
            assert.deepEqual(cir.customGatesUses[N - 1], { id: 0, signals: [] });
            assert(lines.some((l) => l.includes("Loading constraints: 1000000/")),
                "expected mid-run progress logging");
        } finally {
            if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
        }
    });
});
