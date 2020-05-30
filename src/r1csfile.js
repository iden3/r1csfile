const Scalar = require("ffjavascript").Scalar;
const assert = require("assert");
const ZqField = require("ffjavascript").ZqField;
const fastFile = require("fastfile");

module.exports.loadR1cs = loadR1cs;

async function loadR1cs(fileName, loadConstraints, loadMap) {
    const res = {};
    const fd = await fastFile.readExisting(fileName);

    const b = await fd.read(4);
    let readedType = "";
    for (let i=0; i<4; i++) readedType += String.fromCharCode(b[i]);

    if (readedType != "r1cs") assert(false, fileName + ": Invalid File format");

    let v = await fd.readULE32();

    if (v>1) assert(false, "Version not supported");

    const nSections = await fd.readULE32();

    let pHeader;
    let pConstraints;
    let headerSize;
    let constraintsSize;
    let pMap;
    let mapSize;
    for (let i=0; i<nSections; i++) {
        let ht = await fd.readULE32();
        let hl = await fd.readULE64();
        if (ht == 1) {
            if (typeof pHeader != "undefined") assert(false, "File has two headder sections");
            pHeader = fd.pos;
            headerSize = hl;
        } else if (ht==2) {
            if (typeof pConstraints != "undefined") assert(false, "File has two constraints sections");
            pConstraints = fd.pos;
            constraintsSize = hl;
        } else if (ht==3) {
            pMap = fd.pos;
            mapSize = hl;
        }
        fd.pos += hl;
    }

    if (typeof pHeader == "undefined") assert(false, "File has two header");

    // Read Header
    fd.pos = pHeader;
    const n8 = await fd.readULE32();
    res.prime = await readBigInt();
    res.Fr = new ZqField(res.prime);

    res.nVars = await fd.readULE32();
    res.nOutputs = await fd.readULE32();
    res.nPubInputs = await fd.readULE32();
    res.nPrvInputs = await fd.readULE32();
    res.nLabels = await fd.readULE64();
    res.nConstraints = await fd.readULE32();

    if (fd.pos != pHeader + headerSize) assert(false, "Invalid header section size");

    if (loadConstraints) {
        // Read Constraints
        fd.pos = pConstraints;

        res.constraints = [];
        for (let i=0; i<res.nConstraints; i++) {
            const c = await readConstraint();
            res.constraints.push(c);
        }
        if (fd.pos != pConstraints + constraintsSize) assert(false, "Invalid constraints size");
    }

    // Read Labels

    if (loadMap) {
        fd.pos = pMap;

        res.map = [];
        for (let i=0; i<res.nVars; i++) {
            const idx = await fd.readULE64();
            res.map.push(idx);
        }
        if (fd.pos != pMap + mapSize) assert(false, "Invalid Map size");
    }

    await fd.close();

    return res;

    async function readBigInt() {
        const buff = await fd.read(n8);
        return Scalar.fromRprLE(buff);
    }

    async function readConstraint() {
        const c = [];
        c[0] = await readLC();
        c[1] = await readLC();
        c[2] = await readLC();
        return c;
    }

    async function readLC() {
        const lc= {};
        const nIdx = await fd.readULE32();
        for (let i=0; i<nIdx; i++) {
            const idx = await fd.readULE32();
            const val = res.Fr.e(await readBigInt());
            lc[idx] = val;
        }
        return lc;
    }
}
