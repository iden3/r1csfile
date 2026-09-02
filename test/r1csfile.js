import * as r1cs from "../src/r1csfile.js";
import * as binFileUtils from "@iden3/binfileutils";
import path from "path";
import assert from "assert";
import fs from "fs";
import os from "os";
import { expect } from "vitest";

const primeStr = "21888242871839275222246405745257275088548364400416034343698204186575808495617";

const expected = {
    "n8": 32,
    "prime": primeStr,
    "useCustomGates": false,
    "nVars": 7,
    "nOutputs": 1,
    "nPubInputs": 2,
    "nPrvInputs": 3,
    "nLabels": 1000,
    "nConstraints": 3,
    "constraints": [
        [
            { "5": "3", "6": "8" },
            { "0": "2", "2": "20", "3": "12" },
            { "0": "5", "2": "7" }
        ],[
            { "1": "4", "4": "8", "5": "3" },
            { "3": "44", "6": "6" },
            {}
        ],[
            { "6": "4" },
            { "0": "6", "2": "11", "3": "5" },
            { "6": "600" }
        ]
    ],
    "map": [0, 3, 10, 11, 12, 15, 324],
    customGates: [],
    customGatesUses: []
};

export function stringifyBigInts(Fr, o) {
    if ((typeof(o) == "bigint") || o.eq !== undefined)  {
        return o.toString(10);
    } else if (o instanceof Uint8Array) {
        return Fr.toString(o);
    } else if (Array.isArray(o)) {
        return o.map(stringifyBigInts.bind(null, Fr));
    } else if (typeof o == "object") {
        const res = {};
        const keys = Object.keys(o);
        keys.forEach( (k) => {
            res[k] = stringifyBigInts(Fr, o[k]);
        });
        return res;
    } else {
        return o;
    }
}

function fixturePath(filename) {
    if (typeof window !== "undefined") {
        return window.location.origin + "/test/testutils/" + filename;
    }
    return path.join("test", "testutils", filename);
}

async function readR1csFixture(filename, opts) {
    const filePath = fixturePath(filename);
    const { fd, sections } = await binFileUtils.readBinFile(filePath, "r1cs", 1, 1<<25, 1<<22);
    try {
        return await r1cs.readR1csFd(fd, sections, opts);
    } finally {
        await fd.close();
    }
}

describe("Parse R1CS file", function () {
    it("Parse example file", async () => {
        let cir = await readR1csFixture("example.r1cs", {
            loadConstraints: true,
            loadMap: true,
            loadCustomGates: true,
        });

        const curve = cir.curve;
        delete cir.Fr;
        delete cir.curve;
        delete cir.F;

        cir = stringifyBigInts(curve.Fr, cir);

        expect(cir).toEqual(expected);

        await curve.terminate();
    });

    it("Parse example file with struct as second parameter", async () => {
        let cir = await readR1csFixture("example.r1cs", {
            loadConstraints: true,
            loadMap: true,
            loadCustomGates: true,
        });

        const curve = cir.curve;
        delete cir.Fr;
        delete cir.curve;
        delete cir.F;

        cir = stringifyBigInts(curve.Fr, cir);

        expect(cir).toEqual(expected);

        await curve.terminate();
    });

    it("loadConstraints: false returns correct header fields without reading the constraint section", async () => {
        const filePath = path.join("test", "testutils", "example.r1cs");

        // Find the constraints section's byte range (section 2), then write a
        // copy of the file with that range corrupted. If readR1csHeader (via
        // loadConstraints: false) genuinely never touches the constraint
        // body, reading the corrupted copy must still succeed and return the
        // same header fields as the uncorrupted file.
        const { fd: probeFd, sections } = await binFileUtils.readBinFile(filePath, "r1cs", 1, 1 << 20, 1 << 14);
        const constraintsSection = sections[r1cs.R1CS_FILE_CONSTRAINTS_SECTION][0];
        await probeFd.close();

        const corrupted = Buffer.from(fs.readFileSync(filePath));
        corrupted.fill(0xFF, constraintsSection.p, constraintsSection.p + constraintsSection.size);
        const tmpPath = path.join(os.tmpdir(), `r1csfile-test-corrupted-${process.pid}.r1cs`);
        fs.writeFileSync(tmpPath, corrupted);

        try {
            const header = await r1cs.readR1cs(tmpPath, { loadConstraints: false });
            assert.strictEqual(header.nConstraints, expected.nConstraints);
            assert.strictEqual(header.nVars, expected.nVars);
            assert.strictEqual(header.nOutputs, expected.nOutputs);
            assert.strictEqual(header.nPubInputs, expected.nPubInputs);
            assert.strictEqual(header.nPrvInputs, expected.nPrvInputs);
            assert.strictEqual(header.nLabels, expected.nLabels);
            assert.strictEqual(header.constraints, undefined);
            await header.curve.terminate();

            // Sanity check that the corruption is real: loading constraints
            // from the SAME corrupted file must behave differently (throw),
            // proving the header-only path above genuinely skipped that data
            // rather than the corruption being a no-op.
            let threwOnFullLoad = false;
            try {
                const full = await r1cs.readR1cs(tmpPath, { loadConstraints: true });
                await full.curve.terminate();
            } catch {
                threwOnFullLoad = true;
            }
            assert(threwOnFullLoad, "expected loadConstraints: true to fail on a file with a corrupted constraint section");
        } finally {
            fs.unlinkSync(tmpPath);
        }
    });

    it("rejects a file with the wrong magic string", async () => {
        const filePath = path.join("test", "testutils", "example.r1cs");
        const corrupted = Buffer.from(fs.readFileSync(filePath));
        corrupted.write("xxxx", 0); // magic string is the first 4 bytes
        const tmpPath = path.join(os.tmpdir(), `r1csfile-test-badmagic-${process.pid}.r1cs`);
        fs.writeFileSync(tmpPath, corrupted);

        try {
            await assert.rejects(() => r1cs.readR1cs(tmpPath, { loadConstraints: false }));
        } finally {
            fs.unlinkSync(tmpPath);
        }
    });
});
