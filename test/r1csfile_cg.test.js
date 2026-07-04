import * as binFileUtils from "@iden3/binfileutils";
import { readR1csFd } from "../src/r1csfile.js";
import path from "path";
import { expect } from "vitest";

const cgList = [
    { "templateName": "RANGE_CHECK", "parameters": [10n, 20n] },
    { "templateName": "POSEIDON_HASH", "parameters": [5n, 6n] },
];

const cgUses = [
    { "id": 0, "signals": [6, 7] },
    { "id": 0, "signals": [8, 9] },
    { "id": 1, "signals": [4, 5, 6] },
];

function fixturePath(filename) {
    if (typeof window !== "undefined") {
        return window.location.origin + "/test/testutils/" + filename;
    }
    return path.join("test", "testutils", filename);
}

describe("Parse R1CS Custom Gates Sections file", function () {
    it("Parse R1CS Custom Gates example file", async () => {
        const filePath = fixturePath("circuitCG.r1cs");
        const { fd, sections } = await binFileUtils.readBinFile(filePath, "r1cs", 1, 1<<25, 1<<22);
        let cir;
        try {
            cir = await readR1csFd(fd, sections, { loadCustomGates: true });
        } finally {
            await fd.close();
        }

        for (let i = 0; i < cir.customGates.length; i++) {
            for (let j = 0; j < cir.customGates[i].parameters.length; j++) {
                cir.customGates[i].parameters[j] = cir.F.toObject(cir.customGates[i].parameters[j]);
            }
        }

        expect(cir.customGates).toEqual(cgList);
        expect(cir.customGatesUses).toEqual(cgUses);

        await cir.curve.terminate();
    });
});
