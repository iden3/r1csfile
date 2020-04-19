const Scalar = require("ffjavascript").Scalar;
const assert = require("assert");
const ZqField = require("ffjavascript").ZqField;
const fastFile = require("fastfile");

module.exports.loadR1cs = loadR1cs;

async function loadR1cs(fileName, loadConstraints, loadMap) {
    const res = {};
    const fd = await fastFile.readExisting(fileName);

    const b = await fd.read(0, 4);

    if (b.toString() != "r1cs") assert(false, "Invalid File format");

    let p=4;

    let v = await readU32();

    if (v>1) assert(false, "Version not supported");

    const nSections = await readU32();

    let pHeader;
    let pConstraints;
    let headerSize;
    let constraintsSize;
    let pMap;
    let mapSize;
    for (let i=0; i<nSections; i++) {
        let ht = await readU32();
        let hl = await readU64();
        if (ht == 1) {
            if (typeof pHeader != "undefined") assert(false, "File has two headder sections");
            pHeader = p;
            headerSize = hl;
        } else if (ht==2) {
            if (typeof pConstraints != "undefined") assert(false, "File has two constraints sections");
            pConstraints = p;
            constraintsSize = hl;
        } else if (ht==3) {
            pMap = p;
            mapSize = hl;
        }
        p += hl;
    }

    if (typeof pHeader == "undefined") assert(false, "File has two header");

    // Read Header
    p = pHeader;
    const n8 = await readU32();
    res.prime = await readBigInt();
    res.Fr = new ZqField(res.prime);

    res.nVars = await readU32();
    res.nOutputs = await readU32();
    res.nPubInputs = await readU32();
    res.nPrvInputs = await readU32();
    res.nLabels = await readU64();
    res.nConstraints = await readU32();

    if (p != pHeader + headerSize) assert(false, "Invalid header section size");

    if (loadConstraints) {
        // Read Constraints
        p = pConstraints;

        res.constraints = [];
        for (let i=0; i<res.nConstraints; i++) {
            const c = await readConstraint();
            res.constraints.push(c);
        }
        if (p != pConstraints + constraintsSize) assert(false, "Invalid constraints size");
    }

    // Read Labels

    if (loadMap) {
        p = pMap;

        res.map = [];
        for (let i=0; i<res.nVars; i++) {
            const idx = await readU64();
            res.map.push(idx);
        }
        if (p != pMap + mapSize) assert(false, "Invalid Map size");
    }

    await fd.close();

    return res;

    async function readU32() {
        const b = await fd.read(p, 4);

        p+=4;

        return b.readUInt32LE(0);
    }

    async function readU64() {
        const b = await fd.read(p, 8);

        p+=8;

        const LS = b.readUInt32LE(0);
        const MS = b.readUInt32LE(4);

        return MS * 0x100000000 + LS;
    }

    async function readBigInt() {
        const buff = await fd.read(p, n8);
        assert(buff.length == n8);
        const buffR = Buffer.allocUnsafe(n8);
        for (let i=0; i<n8; i++) buffR[i] = buff[n8-1-i];

        p += n8;

        return Scalar.fromString(buffR.toString("hex"), 16);
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
        const nIdx = await readU32();
        for (let i=0; i<nIdx; i++) {
            const idx = await readU32();
            const val = res.Fr.e(await readBigInt());
            lc[idx] = val;
        }
        return lc;
    }
}
