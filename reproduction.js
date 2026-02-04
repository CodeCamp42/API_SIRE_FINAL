const xml2js = require('xml2js');

const xml = `
<Invoice xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
    <cac:InvoiceLine>
        <cbc:ID>1</cbc:ID>
        <cac:Item>
            <cbc:Description>Item 1</cbc:Description>
        </cac:Item>
    </cac:InvoiceLine>
    <cac:InvoiceLine>
        <cbc:ID>2</cbc:ID>
        <cac:Item>
            <cbc:Description>Item 2</cbc:Description>
        </cac:Item>
    </cac:InvoiceLine>
</Invoice>
`;

async function run() {
    const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false, mergeAttrs: true });

    // Logic from SunatService
    const invoice = parsed.Invoice || parsed;

    // Helper improved
    const getValue = (val) => {
        if (val == null) return null;
        if (typeof val !== 'object') return val;
        if (Array.isArray(val)) return getValue(val[0]);
        return val['_'] || val['#text'] || val;
    };

    const get = (obj, paths) => {
        for (const p of paths) {
            const parts = p.split('.');
            let cur = obj;
            let ok = true;
            for (const part of parts) {
                if (cur == null) { ok = false; break; }
                cur = cur[part];
            }
            if (ok && cur != null) return getValue(cur);
        }
        return null;
    };

    let lines = invoice['cac:InvoiceLine'];
    console.log('Original lines type:', Array.isArray(lines) ? 'Array' : typeof lines);

    if (!lines) lines = [];
    if (!Array.isArray(lines)) lines = [lines];

    console.log('Normalized length:', lines.length);

    const items = lines.map((ln) => {
        const descripcion = get(ln, ['cac:Item.cbc:Description']);
        return { descripcion };
    });

    console.log('Items:', JSON.stringify(items, null, 2));
}

run();
