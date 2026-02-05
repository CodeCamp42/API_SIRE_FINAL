const fs = require('fs');
const xml2js = require('xml2js');

const UNIT_MAP = {
    'GLL': 'US GALON',
    'NIU': 'UNIDAD',
};

async function test() {
    const xml = fs.readFileSync('test_unit.xml', 'utf-8');
    const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false, mergeAttrs: true });

    const invoice = parsed.Invoice;
    const lines = invoice['cac:InvoiceLine'];
    const line = Array.isArray(lines) ? lines[0] : lines;

    const unitCode = line['cbc:InvoicedQuantity']?.['unitCode'] || 'NIU';
    const unidad = UNIT_MAP[unitCode] || unitCode;

    console.log('unitCode:', unitCode);
    console.log('unidad final:', unidad);
}

test();
