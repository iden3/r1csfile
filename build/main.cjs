'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var ffjavascript = require('ffjavascript');
var BigArray = _interopDefault(require('@iden3/bigarray'));
var fastFile = require('fastfile');

async function readBinFile(fileName, type, maxVersion, cacheSize, pageSize) {

    const fd = await fastFile.readExisting(fileName, cacheSize, pageSize);

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

async function createBinFile(fileName, type, version, nSections, cacheSize, pageSize) {

    const fd = await fastFile.createOverride(fileName, cacheSize, pageSize);

    const buff = new Uint8Array(4);
    for (let i=0; i<4; i++) buff[i] = type.charCodeAt(i);
    await fd.write(buff, 0); // Magic "r1cs"

    await fd.writeULE32(version); // Version
    await fd.writeULE32(nSections); // Number of Sections

    return fd;
}

async function startWriteSection(fd, idSection) {
    if (typeof fd.writingSection !== "undefined") throw new Error("Already writing a section");
    await fd.writeULE32(idSection); // Header type
    fd.writingSection = {
        pSectionSize: fd.pos
    };
    await fd.writeULE64(0); // Temporally set to 0 length
}

async function endWriteSection(fd) {
    if (typeof fd.writingSection === "undefined") throw new Error("Not writing a section");

    const sectionSize = fd.pos - fd.writingSection.pSectionSize - 8;
    const oldPos = fd.pos;
    fd.pos = fd.writingSection.pSectionSize;
    await fd.writeULE64(sectionSize);
    fd.pos = oldPos;
    delete fd.writingSection;
}

async function startReadUniqueSection(fd, sections, idSection) {
    if (typeof fd.readingSection !== "undefined") throw new Error("Already reading a section");
    if (!sections[idSection])  throw new Error(fd.fileName + ": Missing section "+ idSection );
    if (sections[idSection].length>1) throw new Error(fd.fileName +": Section Duplicated " +idSection);

    fd.pos = sections[idSection][0].p;

    fd.readingSection = sections[idSection][0];
}

async function endReadSection(fd, noCheck) {
    if (typeof fd.readingSection === "undefined") throw new Error("Not reading a section");
    if (!noCheck) {
        if (fd.pos-fd.readingSection.p !=  fd.readingSection.size) throw new Error("Invalid section size reading");
    }
    delete fd.readingSection;
}

async function writeBigInt(fd, n, n8, pos) {
    const buff = new Uint8Array(n8);
    ffjavascript.Scalar.toRprLE(buff, 0, n, n8);
    await fd.write(buff, pos);
}

async function readBigInt(fd, n8, pos) {
    const buff = await fd.read(n8, pos);
    return ffjavascript.Scalar.fromRprLE(buff, 0, n8);
}

async function readSection(fd, sections, idSection, offset, length) {

    offset = (typeof offset === "undefined") ? 0 : offset;
    length = (typeof length === "undefined") ? sections[idSection][0].size - offset : length;

    if (offset + length > sections[idSection][0].size) {
        throw new Error("Reading out of the range of the section");
    }

    let buff;
    if (length < (1 << 30) ) {
        buff = new Uint8Array(length);
    } else {
        buff = new ffjavascript.BigBuffer(length);
    }

    await fd.readToBuffer(buff, 0, length, sections[idSection][0].p + offset);
    return buff;
}

async function readR1csHeader(fd,sections,singleThread) {


    const res = {};
    await startReadUniqueSection(fd, sections, 1);
    // Read Header
    res.n8 = await fd.readULE32();
    res.prime = await readBigInt(fd, res.n8);

    res.curve = await ffjavascript.getCurveFromR(res.prime, singleThread);

    res.nVars = await fd.readULE32();
    res.nOutputs = await fd.readULE32();
    res.nPubInputs = await fd.readULE32();
    res.nPrvInputs = await fd.readULE32();
    res.nLabels = await fd.readULE64();
    res.nConstraints = await fd.readULE32();
    await endReadSection(fd);

    return res;
}

async function readConstraints(fd,sections, r1cs, logger, loggerCtx) {
    const bR1cs = await readSection(fd, sections, 2);
    let bR1csPos = 0;
    let constraints;
    if (r1cs.nConstraints>1<<20) {
        constraints = new BigArray();
    } else {
        constraints = [];
    }
    for (let i=0; i<r1cs.nConstraints; i++) {
        if ((logger)&&(i%100000 == 0)) logger.info(`${loggerCtx}: Loading constraints: ${i}/${r1cs.nConstraints}`);
        const c = readConstraint();
        constraints.push(c);
    }
    return constraints;


    function readConstraint() {
        const c = [];
        c[0] = readLC();
        c[1] = readLC();
        c[2] = readLC();
        return c;
    }

    function readLC() {
        const lc= {};

        const buffUL32 = bR1cs.slice(bR1csPos, bR1csPos+4);
        bR1csPos += 4;
        const buffUL32V = new DataView(buffUL32.buffer);
        const nIdx = buffUL32V.getUint32(0, true);

        const buff = bR1cs.slice(bR1csPos, bR1csPos + (4+r1cs.n8)*nIdx );
        bR1csPos += (4+r1cs.n8)*nIdx;
        const buffV = new DataView(buff.buffer);
        for (let i=0; i<nIdx; i++) {
            const idx = buffV.getUint32(i*(4+r1cs.n8), true);
            const val = r1cs.curve.Fr.fromRprLE(buff, i*(4+r1cs.n8)+4);
            lc[idx] = val;
        }
        return lc;
    }
}

async function readMap(fd, sections, r1cs, logger, loggerCtx) {
    const bMap = await readSection(fd, sections, 3);
    let bMapPos = 0;
    let map;

    if (r1cs.nVars>1<<20) {
        map = new BigArray();
    } else {
        map = [];
    }
    for (let i=0; i<r1cs.nVars; i++) {
        if ((logger)&&(i%10000 == 0)) logger.info(`${loggerCtx}: Loading map: ${i}/${r1cs.nVars}`);
        const idx = readULE64();
        map.push(idx);
    }

    return map;

    function readULE64() {
        const buffULE64 = bMap.slice(bMapPos, bMapPos+8);
        bMapPos += 8;
        const buffULE64V = new DataView(buffULE64.buffer);
        const LSB = buffULE64V.getUint32(0, true);
        const MSB = buffULE64V.getUint32(4, true);

        return MSB * 0x100000000 + LSB;
    }

}

async function readR1cs(fileName, loadConstraints, loadMap, singleThread, logger, loggerCtx) {

    const {fd, sections} = await readBinFile(fileName, "r1cs", 1, 1<<22, 1<<25);

    const res = await readR1csHeader(fd, sections, singleThread);


    if (loadConstraints) {
        res.constraints = await readConstraints(fd, sections, res, logger, loggerCtx);
    }

    // Read Labels

    if (loadMap) {
        res.map = await readMap(fd, sections, res, logger, loggerCtx);
    }

    await fd.close();

    return res;
}


async function writeR1csHeader(fd, cir) {
    await startWriteSection(fd, 1);
    await fd.writeULE32(cir.n8); // Temporally set to 0 length
    await writeBigInt(fd, cir.prime, cir.n8);

    await fd.writeULE32(cir.nVars);
    await fd.writeULE32(cir.nOutputs);
    await fd.writeULE32(cir.nPubInputs);
    await fd.writeULE32(cir.nPrvInputs);
    await fd.writeULE64(cir.nLabels);
    await fd.writeULE32(cir.constraints.length);

    await endWriteSection(fd);
}

async function writeR1csConstraints(fd, cir, logger, loggerCtx) {
    await startWriteSection(fd, 2);

    for (let i=0; i<cir.constraints.length; i++) {
        if ((logger)&&(i%10000 == 0)) logger.info(`${loggerCtx}: writing constraint: ${i}/${cir.constraints.length}`);
        await writeConstraint(cir.constraints[i]);
    }

    await endWriteSection(fd);


    function writeConstraint(c) {
        const n8 = cir.n8;
        const F = cir.curve.Fr;
        const idxA = Object.keys(c[0]);
        const idxB = Object.keys(c[1]);
        const idxC = Object.keys(c[2]);
        const buff = new Uint8Array((idxA.length+idxB.length+idxC.length)*(n8+4) + 12);
        const buffV = new DataView(buff.buffer);
        let o=0;

        buffV.setUint32(o, idxA.length, true); o+=4;
        for (let i=0; i<idxA.length; i++) {
            const coef = idxA[i];
            buffV.setUint32(o, coef, true); o+=4;
            F.toRprLE(buff, o, c[0][coef]); o+=n8;
        }

        buffV.setUint32(o, idxB.length, true); o+=4;
        for (let i=0; i<idxB.length; i++) {
            const coef = idxB[i];
            buffV.setUint32(o, coef, true); o+=4;
            F.toRprLE(buff, o, c[1][coef]); o+=n8;
        }

        buffV.setUint32(o, idxC.length, true); o+=4;
        for (let i=0; i<idxC.length; i++) {
            const coef = idxC[i];
            buffV.setUint32(o, coef, true); o+=4;
            F.toRprLE(buff, o, c[2][coef]); o+=n8;
        }

        return fd.write(buff);
    }

}


async function writeR1csMap(fd, cir, logger, loggerCtx) {
    await startWriteSection(fd, 3);

    if (cir.map.length != cir.nVars) throw new Error("Invalid map size");
    for (let i=0; i<cir.nVars; i++) {
        if ((logger)&&(i%10000 == 0)) logger.info(`${loggerCtx}: writing map: ${i}/${cir.nVars}`);
        await fd.writeULE64(cir.map[i]);
    }

    await endWriteSection(fd);
}



async function writeR1cs(fileName, cir, logger, loggerCtx) {

    const fd = await createBinFile(fileName, "r1cs", 1, 3, 1<<22, 1<<24);

    await writeR1csHeader(fd, cir);

    await writeR1csConstraints(fd, cir, logger, loggerCtx);

    await writeR1csMap(fd, cir, logger, loggerCtx);

    await fd.close();
}

exports.readConstraints = readConstraints;
exports.readMap = readMap;
exports.readR1cs = readR1cs;
exports.readR1csHeader = readR1csHeader;
exports.writeR1cs = writeR1cs;
exports.writeR1csConstraints = writeR1csConstraints;
exports.writeR1csHeader = writeR1csHeader;
exports.writeR1csMap = writeR1csMap;
