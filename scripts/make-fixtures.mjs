// Generates sample files of every supported format into ./fixtures for manual and browser testing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
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

console.log('fixtures written');
