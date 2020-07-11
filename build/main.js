'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var ffjavascript = require('ffjavascript');
var fastFile = require('fastfile');

async function readBinFile(fileName, type, maxVersion) {

    const fd = await fastFile.readExisting(fileName);

    const b = await fd.read(4);
    let readedType = "";
    for (let i=0; i<4; i++) readedType += String.fromCharCode(b[i]);

    if (readedType != type) throw new Error(fileName + ": Invalid File format");

    let v = await fd.readULE32();

    if (v>maxVersion) throw new Error("Version not supported");

    const nSections = await fd.readULE32();

    // Scan sections
    let sections = [];
    for (let i=0; i<nSections; i++) {
        let ht = await fd.readULE32();
        let hl = await fd.readULE64();
        if (typeof sections[ht] == "undefined") sections[ht] = [];
        sections[ht].push({
            p: fd.pos,
            size: hl
        });
        fd.pos += hl;
    }

    return {fd, sections};
}

async function startReadUniqueSection(fd, sections, idSection) {
    if (typeof fd.readingSection != "undefined")
        throw new Error("Already reading a section");
    if (!sections[idSection])  throw new Error(fd.fileName + ": Missing section "+ idSection );
    if (sections[idSection].length>1) throw new Error(fd.fileName +": Section Duplicated " +idSection);

    fd.pos = sections[idSection][0].p;

    fd.readingSection = sections[idSection][0];
}

async function endReadSection(fd, noCheck) {
    if (typeof fd.readingSection == "undefined")
        throw new Error("Not reading a section");
    if (!noCheck) {
        if (fd.pos-fd.readingSection.p != fd.readingSection.size)
            throw new Error("Invalid section size");
    }
    delete fd.readingSection;
}


async function readBigInt(fd, n8, pos) {
    const buff = await fd.read(n8, pos);
    return ffjavascript.Scalar.fromRprLE(buff, 0, n8);
}

async function loadHeader(fd,sections) {


    const res = {};
    await startReadUniqueSection(fd, sections, 1);
    // Read Header
    res.n8 = await fd.readULE32();
    res.prime = await readBigInt(fd, res.n8);
    res.Fr = new ffjavascript.ZqField(res.prime);

    res.nVars = await fd.readULE32();
    res.nOutputs = await fd.readULE32();
    res.nPubInputs = await fd.readULE32();
    res.nPrvInputs = await fd.readULE32();
    res.nLabels = await fd.readULE64();
    res.nConstraints = await fd.readULE32();
    await endReadSection(fd);

    return res;
}

async function load(fileName, loadConstraints, loadMap) {

    const {fd, sections} = await readBinFile(fileName, "r1cs", 1);
    const res = await loadHeader(fd, sections);


    if (loadConstraints) {
        await startReadUniqueSection(fd, sections, 2);
        res.constraints = [];
        for (let i=0; i<res.nConstraints; i++) {
            const c = await readConstraint();
            res.constraints.push(c);
        }
        await endReadSection(fd);
    }

    // Read Labels

    if (loadMap) {
        await startReadUniqueSection(fd, sections, 3);

        res.map = [];
        for (let i=0; i<res.nVars; i++) {
            const idx = await fd.readULE64();
            res.map.push(idx);
        }
        await endReadSection(fd);
    }

    await fd.close();

    return res;

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
            const val = res.Fr.e(await readBigInt(fd, res.n8));
            lc[idx] = val;
        }
        return lc;
    }
}

exports.load = load;
exports.loadHeader = loadHeader;
