import * as r1cs from "../src/r1csfile.js";
import * as binFileUtils from "@iden3/binfileutils";
import path from "path";
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

function stringifyBigInts(Fr, o) {
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
    const res = await r1cs.readR1csFd(fd, sections, opts);
    await fd.close();
    return res;
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
});
