// Generates sample files of every supported format into ./fixtures for manual and browser testing.
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import * as zlib from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { JPEG_B64, WEBP_B64, WEBM_B64 } from './fixture-media.mjs';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import * as XLSX from 'xlsx';
import { zipSync, strToU8 } from 'fflate';

mkdirSync('fixtures', { recursive: true });
const w = (name, data) => writeFileSync(`fixtures/${name}`, data);

const N = 5000;
const cities = ['Chennai', 'Bengaluru', 'Mumbai', 'Delhi', 'Hyderabad', 'Pune'];
const rows = Array.from({ length: N }, (_, i) => ({
  id: i + 1,
  name: `user_${i + 1}`,
  email: `user${i + 1}@example.com`,
  city: cities[i % cities.length],
  amount: Math.round(Math.random() * 100000) / 100,
  active: i % 3 === 0,
  signup: new Date(Date.UTC(2024, i % 12, (i % 27) + 1)).toISOString(),
  note: i % 50 === 0 ? 'has, comma and "quotes"' : '',
}));
const cols = Object.keys(rows[0]);

// CSV variants
const csvEsc = (v, d) => { const s = String(v ?? ''); return s.includes(d) || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s; };
const delimited = (d) => [cols.join(d), ...rows.map(r => cols.map(c => csvEsc(r[c], d)).join(d))].join('\n');
w('users.csv', delimited(','));
w('users.psv', delimited('|'));
w('users.tsv', delimited('\t'));
w('users-semicolon.txt', delimited(';'));
w('users.csv.gz', gzipSync(delimited(',')));
w('users-noext', delimited(','));

// JSON / NDJSON
w('users.json', JSON.stringify(rows.slice(0, 500), null, 2));
w('config.json', JSON.stringify({ service: 'orders', version: 3, replicas: 2, endpoints: { primary: 'https://api.example.com', fallback: null }, tags: ['prod', 'eu-west-1'], limits: { rps: 1200, burst: 5000 }, nested: { deep: { deeper: { deepest: [1, 2, { x: true }] } } } }, null, 2));
w('events.ndjson', rows.slice(0, 2000).map(r => JSON.stringify({ ts: r.signup, user: { id: r.id, city: r.city }, amount: r.amount })).join('\n'));
w('order.json', JSON.stringify({
  orderId: 'ORD-2026-000418', status: 'SHIPPED', placedAt: '2026-09-14T08:42:11Z', currency: 'INR',
  customer: { id: 'C-10482', name: 'Priya Raman', email: 'priya.raman@example.com', tier: 'gold', address: { line1: '14 Cathedral Road', city: 'Chennai', state: 'Tamil Nadu', postalCode: '600086', country: 'IN' } },
  items: [
    { sku: 'BK-1042', title: 'Designing Data-Intensive Applications', qty: 1, unitPrice: 3299, tax: 164.95 },
    { sku: 'EL-2210', title: 'USB-C Hub, 7-in-1', qty: 2, unitPrice: 2499, tax: 449.82, attributes: { color: 'space grey', warrantyMonths: 24 } },
    { sku: 'ST-0031', title: 'Notebook A5 dotted', qty: 3, unitPrice: 349, tax: 52.35 },
  ],
  totals: { subtotal: 9344, tax: 667.12, shipping: 0, discount: -500, grandTotal: 9511.12 },
  payment: { method: 'UPI', reference: 'upi-7f3a9c', captured: true },
  shipment: { carrier: 'Delhivery', trackingNumber: 'DLV4491028831', events: [{ at: '2026-09-14T15:10:00Z', status: 'PICKED_UP' }, { at: '2026-09-15T04:22:00Z', status: 'IN_TRANSIT', hub: 'MAA-1' }, { at: '2026-09-16T09:05:00Z', status: 'OUT_FOR_DELIVERY' }] },
  tags: ['prepaid', 'gift-wrap'], notes: null,
}, null, 2));

// XML
w('orders.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<orders generated="${new Date().toISOString()}">${rows.slice(0, 300).map(r => `<order id="${r.id}"><customer>${r.name}</customer><city>${r.city}</city><amount currency="INR">${r.amount}</amount><active>${r.active}</active></order>`).join('')}</orders>`);
w('pom.xml', `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>demo</artifactId><version>1.0.0</version><dependencies><dependency><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId><version>2.0.9</version></dependency></dependencies></project>`);

// YAML / TOML / Markdown / HTML / text / code / log
w('deploy.yaml', `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: orders\n  labels: {app: orders, tier: backend}\nspec:\n  replicas: 3\n  template:\n    spec:\n      containers:\n        - name: api\n          image: example/orders:1.4.2\n          ports: [{containerPort: 8080}]\n          env:\n            - name: LOG_LEVEL\n              value: info\n`);
w('config.toml', `[server]\nhost = "0.0.0.0"\nport = 8080\n\n[database]\nurl = "postgres://db/orders"\npool = 20\n\n[[features]]\nname = "beta"\nenabled = true\n`);
w('README.md', `# Orders service\n\nA **sample** markdown file.\n\n## Table\n\n| col | value |\n|-----|-------|\n| a | 1 |\n| b | 2 |\n\n- item one\n- item two\n\n\`\`\`js\nconsole.log('hi');\n\`\`\`\n\n[link](https://example.com) <script>alert(1)</script>\n`);
w('page.html', `<!doctype html><html><head><title>t</title><style>body{font-family:sans-serif;padding:20px}</style></head><body><h1>Hello from S3</h1><p>Scripts are disabled: <script>document.body.innerHTML='PWNED'</script></p><ul><li>one</li><li>two</li></ul></body></html>`);
w('app.log', Array.from({ length: 60000 }, (_, i) => `2024-05-${String((i % 28) + 1).padStart(2, '0')}T10:${String(i % 60).padStart(2, '0')}:00Z [${['INFO', 'WARN', 'ERROR', 'DEBUG'][i % 4]}] request_id=${i} path=/api/orders/${i % 97} status=${[200, 200, 200, 404, 500][i % 5]} latency_ms=${i % 300}`).join('\n'));
w('script.py', `import json\n\ndef main(path: str) -> None:\n    """Load and print."""\n    with open(path) as f:\n        data = json.load(f)\n    print(len(data))\n\nif __name__ == "__main__":\n    main("users.json")\n`);
w('query.sql', `SELECT city, COUNT(*) AS n, SUM(amount) AS total\nFROM users\nWHERE active = true\nGROUP BY city\nORDER BY total DESC;\n`);
w('notes.txt', 'Plain text file.\nSecond line.\n\tTabbed line.\n');

// Parquet (snappy) and Arrow
const parquetBuf = parquetWriteBuffer({
  columnData: [
    { name: 'id', data: rows.map(r => r.id), type: 'INT32' },
    { name: 'name', data: rows.map(r => r.name), type: 'STRING' },
    { name: 'city', data: rows.map(r => r.city), type: 'STRING' },
    { name: 'amount', data: rows.map(r => r.amount), type: 'DOUBLE' },
    { name: 'active', data: rows.map(r => r.active), type: 'BOOLEAN' },
    { name: 'signup', data: rows.map(r => new Date(r.signup)), type: 'TIMESTAMP' },
  ],
  compressed: true,
});
w('users.parquet', new Uint8Array(parquetBuf));
const arrowTable = tableFromArrays({ id: Int32Array.from(rows.map(r => r.id)), name: rows.map(r => r.name), city: rows.map(r => r.city), amount: Float64Array.from(rows.map(r => r.amount)) });
w('users.arrow', tableToIPC(arrowTable, 'file'));
w('users.feather', tableToIPC(arrowTable, 'file'));

// XLSX with two sheets
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.slice(0, 1000)), 'Users');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['City', 'Customers', 'Total', 'Average'], ...cities.map(c => { const cr = rows.filter(r => r.city === c); const t = cr.reduce((s, r) => s + r.amount, 0); return [c, cr.length, Math.round(t * 100) / 100, Math.round(t / cr.length * 100) / 100]; })]), 'Summary');
w('users.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
w('users.xls', XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }));
w('users.ods', XLSX.write(wb, { type: 'buffer', bookType: 'ods' }));

// ZIP containing several of the above
w('bundle.zip', zipSync({
  'data/users.csv': strToU8(delimited(',')),
  'data/config.json': strToU8(JSON.stringify({ a: 1, b: [1, 2, 3] })),
  'docs/README.md': strToU8('# inside zip\n\nhello'),
  'nested/users.csv.gz': gzipSync(delimited('|')),
}));

// Minimal valid PDF
w('doc.pdf', `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 60>>stream\nBT /F1 24 Tf 30 60 Td (Hello from S3 Any Viewer) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n0\n%%EOF`);

// SVG and a PNG (copy of the extension icon)
w('logo.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" rx="12" fill="#ff9900"/><text x="100" y="70" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif">S3</text><script>alert('x')</script></svg>`);
import { readFileSync } from 'node:fs';
w('icon.png', readFileSync('dist/icons/icon128.png'));

// Unknown binary
const bin = new Uint8Array(4096); for (let i = 0; i < bin.length; i++) bin[i] = (i * 7919) & 0xff;
w('blob.bin', bin);
// Fake avro header
w('data.avro', Buffer.concat([Buffer.from([0x4f, 0x62, 0x6a, 0x01]), Buffer.from('avro.schema{"type":"record"}')]));

// ---------- Office documents ----------
const png = readFileSync('dist/icons/icon128.png');
const u8 = (s) => strToU8(s);
const RELS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const docxParts = {
  '[Content_Types].xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
  '_rels/.rels': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELS}">
<Relationship Id="rId1" Type="${OREL}/officeDocument" Target="word/document.xml"/></Relationships>`),
  'word/_rels/document.xml.rels': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELS}">
<Relationship Id="rIdStyles" Type="${OREL}/styles" Target="styles.xml"/>
<Relationship Id="rIdImg" Type="${OREL}/image" Target="media/logo.png"/>
<Relationship Id="rIdWeb" Type="${OREL}/hyperlink" Target="https://example.com/report" TargetMode="External"/>
<Relationship Id="rIdBad" Type="${OREL}/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>`),
  'word/styles.xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4E79"/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`),
  'word/media/logo.png': png,
};
const para = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const cell = (t) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${para(t)}</w:tc>`;
docxParts['word/document.xml'] = u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${OREL}"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
${para('Quarterly Data Review', 'Heading1')}
<w:p><w:r><w:t xml:space="preserve">This report summarises the </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>September export</w:t></w:r><w:r><w:t xml:space="preserve"> from the analytics bucket, with </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>five thousand</w:t></w:r><w:r><w:t xml:space="preserve"> customer records across six cities.</w:t></w:r></w:p>
${para('Totals by city', 'Heading1')}
<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="9000" w:type="dxa"/></w:tblPr>
<w:tr>${cell('City')}${cell('Customers')}${cell('Total (INR)')}</w:tr>
<w:tr>${cell('Chennai')}${cell('834')}${cell('410,626.42')}</w:tr>
<w:tr>${cell('Hyderabad')}${cell('833')}${cell('422,049.99')}</w:tr>
<w:tr>${cell('Mumbai')}${cell('833')}${cell('414,042.42')}</w:tr></w:tbl>
${para('')}
<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Logo"/>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
${para('Figures are unaudited and for internal review only.')}
<w:p><w:hyperlink r:id="rIdWeb"><w:r><w:t>Full report online</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> and </w:t></w:r><w:hyperlink r:id="rIdBad"><w:r><w:t>a hostile link</w:t></w:r></w:hyperlink></w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`);
const docx = zipSync(docxParts);
w('report.docx', docx);
w('report-docx-noext', docx);

// PPTX: three slides with title, subtitle, bullets at two levels, a table, a picture and notes.
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const sp = (phType, paras) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="sp"/><p:cNvSpPr/><p:nvPr>${phType ? `<p:ph type="${phType}"/>` : ''}</p:nvPr></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr/>${paras.map(([t, lvl = 0, b]) => `<a:p><a:pPr lvl="${lvl}"/><a:r><a:rPr lang="en-US"${b ? ' b="1"' : ''}/><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
const slide = (inner) => u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${OREL}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${inner}</p:spTree></p:cSld></p:sld>`);
const tcell = (t) => `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${t}</a:t></a:r></a:p></a:txBody></a:tc>`;
const slideRels = (extra = '') => u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELS}">${extra}</Relationships>`);
w('deck.pptx', zipSync({
  '[Content_Types].xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`),
  '_rels/.rels': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${OREL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`),
  'ppt/presentation.xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="${P}" xmlns:r="${OREL}">
<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`),
  'ppt/_rels/presentation.xml.rels': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELS}">
<Relationship Id="rId2" Type="${OREL}/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="${OREL}/slide" Target="slides/slide2.xml"/><Relationship Id="rId4" Type="${OREL}/slide" Target="slides/slide3.xml"/></Relationships>`),
  'ppt/slides/slide1.xml': slide(sp('ctrTitle', [['S3 Any Viewer']]) + sp('subTitle', [['Q3 data platform review']])),
  'ppt/slides/_rels/slide1.xml.rels': slideRels(`<Relationship Id="rIdN" Type="${OREL}/notesSlide" Target="../notesSlides/notesSlide1.xml"/>`),
  'ppt/notesSlides/notesSlide1.xml': u8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree>${sp('body', [['Open with the pain point: every file in S3 is a download.']])}</p:spTree></p:cSld></p:notes>`),
  'ppt/slides/slide2.xml': slide(sp('title', [['What changed this quarter']]) + sp('body', [
    ['Exports moved to Parquet', 0, true], ['Read in parts, never downloaded whole', 1], ['Schema shown alongside the rows', 1],
    ['Logs now searchable in place', 0, true], ['60,000 lines filter in about 30 ms', 1]])),
  'ppt/slides/_rels/slide2.xml.rels': slideRels(),
  'ppt/slides/slide3.xml': slide(sp('title', [['Totals by city']]) +
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>
<a:tr h="0">${tcell('City')}${tcell('Customers')}${tcell('Total')}</a:tr><a:tr h="0">${tcell('Chennai')}${tcell('834')}${tcell('410,626')}</a:tr><a:tr h="0">${tcell('Pune')}${tcell('833')}${tcell('412,160')}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>` +
    `<p:pic><p:nvPicPr><p:cNvPr id="5" name="logo" descr="Product logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdImg"/></p:blipFill><p:spPr/></p:pic>`),
  'ppt/slides/_rels/slide3.xml.rels': slideRels(`<Relationship Id="rIdImg" Type="${OREL}/image" Target="../media/image1.png"/>`),
  'ppt/media/image1.png': png,
}));

// Legacy Word binary: OLE2 signature plus the UTF-16 stream name the detector looks for.
const ole = Buffer.alloc(4096);
Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(ole, 0);
Buffer.from('WordDocument', 'utf16le').copy(ole, 1024);
w('legacy.doc', ole);

// ---------- media ----------
w('sample.jpg', Buffer.from(JPEG_B64, 'base64'));
w('sample.webp', Buffer.from(WEBP_B64, 'base64'));
w('sample.gif', Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64'));
w('clip.webm', Buffer.from(WEBM_B64, 'base64'));
{ // half a second of a 440 Hz tone, 16-bit mono PCM
  const rate = 8000, samples = rate / 2, data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 12000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  w('tone.wav', Buffer.concat([h, data]));
}

// ---------- more compression and containers ----------
w('users.json.br', zlib.brotliCompressSync(readFileSync('fixtures/users.json')));
if (zlib.zstdCompressSync) w('users.csv.zst', zlib.zstdCompressSync(readFileSync('fixtures/users.csv')));
w('users.xlsb', XLSX.write(wb, { type: 'buffer', bookType: 'xlsb' }));
w('notes.odt', zipSync({
  mimetype: [u8('application/vnd.oasis.opendocument.text'), { level: 0 }],
  'content.xml': u8('<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>OpenDocument text</text:p></office:text></office:body></office:document-content>'),
}));

// JSON with one very large container, for the search expansion budget.
w('big-container.json', JSON.stringify({
  report: 'bulk',
  data: Array.from({ length: 50000 }, (_, i) => ({ id: i, city: cities[i % cities.length], tags: ['a', 'b'], meta: { n: i } })),
}));

// ---------- a Parquet file over the 32 MB range-read threshold ----------
// Uncompressed random text keeps it large; cached locally because it takes a few seconds.
if (!existsSync('fixtures/large.parquet') || statSync('fixtures/large.parquet').size < 34 * 1048576) {
  const count = 400000;
  w('large.parquet', new Uint8Array(parquetWriteBuffer({
    columnData: [
      { name: 'id', data: Int32Array.from({ length: count }, (_, i) => i), type: 'INT32' },
      { name: 'payload', data: Array.from({ length: count }, () => randomBytes(48).toString('hex')), type: 'STRING' },
    ],
    codec: 'UNCOMPRESSED',
    rowGroupSize: 50000,
  })));
}

console.log('fixtures written');
