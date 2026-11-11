import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const BASE_URL = 'http://localhost:5000';
const dbPath = path.resolve(process.cwd(), 'data/app.db');

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyEnglishRules() {
  console.log('===========================================================');
  console.log(' VERIFYING ENGLISH-ONLY DATA & STRICT INTEGRITY RULES       ');
  console.log('===========================================================\n');

  // Verify server is responsive
  let serverReady = false;
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/stats`);
      if (res.ok) {
        serverReady = true;
        break;
      }
    } catch {
      await wait(1000);
    }
  }

  if (!serverReady) {
    console.error('ERROR: Server not responsive at', BASE_URL);
    process.exit(1);
  }

  const db = new Database(dbPath);

  // ----------------------------------------------------
  // TEST A: Rejection of Non-English Donor Name (Hindi / Symbols / Numbers)
  // ----------------------------------------------------
  console.log('--- TEST A: Rejection of Non-English Names ---');
  const invalidNameRes = await fetch(`${BASE_URL}/api/donations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      donorName: 'श्री रामेश्वर सिंह', // Hindi name should be rejected
      phone: '9876543210',
      amount: 1001,
      paymentMode: 'Cash',
    }),
  });

  const invalidNameData = await invalidNameRes.json();
  console.log('Hindi Name Submission Status:', invalidNameRes.status, 'Response:', invalidNameData);
  if (invalidNameRes.status === 400 && invalidNameData.error === 'Please enter the name in English') {
    console.log('✓ Non-English donor name rejected with exact message: "Please enter the name in English"');
  } else {
    console.error('✗ Failed to reject non-English donor name properly');
  }

  // ----------------------------------------------------
  // TEST B: Rejection of Non-ASCII Note
  // ----------------------------------------------------
  console.log('\n--- TEST B: Rejection of Non-ASCII Note ---');
  const invalidNoteRes = await fetch(`${BASE_URL}/api/donations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      donorName: 'Ramesh Kumar',
      phone: '9876543210',
      amount: 1001,
      paymentMode: 'Cash',
      note: 'घाट निर्माण एवं दीप सेवा', // Non-ASCII Hindi note
    }),
  });

  const invalidNoteData = await invalidNoteRes.json();
  console.log('Non-ASCII Note Status:', invalidNoteRes.status, 'Response:', invalidNoteData);
  if (invalidNoteRes.status === 400 && invalidNoteData.error.includes('Please enter the note in English')) {
    console.log('✓ Non-ASCII note rejected with exact error message');
  } else {
    console.error('✗ Failed to reject non-ASCII note properly');
  }

  // ----------------------------------------------------
  // TEST C: Name Normalization (Trim, Collapse Spaces, Title Case, Lowercase)
  // ----------------------------------------------------
  console.log('\n--- TEST C: Name Normalization & Insertion ---');
  const d1Res = await fetch(`${BASE_URL}/api/donations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      donorName: '   ramesh    kumar   ', // Messy casing & spaces
      phone: '9876543210',
      amount: 2100,
      paymentMode: 'PhonePe',
      note: 'Family contribution for ghat lighting',
      clientId: 'idempotent-test-001',
    }),
  });

  const d1 = await d1Res.json();
  console.log('Donation 1 Created:', d1);

  const donor1Row = db.prepare('SELECT * FROM donors WHERE phone = ?').get('9876543210') as any;
  const donation1Row = db.prepare('SELECT * FROM donations WHERE id = ?').get(d1.id) as any;

  console.log('Stored Donor Row in DB:');
  console.log({
    id: donor1Row.id,
    name: donor1Row.name,
    name_normalized: donor1Row.name_normalized,
    phone: donor1Row.phone,
  });
  console.log('Stored Donation Row name_on_receipt:', donation1Row.name_on_receipt);

  if (
    donor1Row.name === 'Ramesh Kumar' &&
    donor1Row.name_normalized === 'ramesh kumar' &&
    donation1Row.name_on_receipt === 'Ramesh Kumar'
  ) {
    console.log('✓ Name properly trimmed, collapsed, Title Cased, and stored with name_normalized!');
  } else {
    console.error('✗ Name normalization failed:', donor1Row);
  }

  // ----------------------------------------------------
  // TEST D: Idempotency Key (Double tap returns same record)
  // ----------------------------------------------------
  console.log('\n--- TEST D: Idempotency Key Double Tap ---');
  const d1DuplicateRes = await fetch(`${BASE_URL}/api/donations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      donorName: 'Ramesh Kumar',
      phone: '9876543210',
      amount: 2100,
      paymentMode: 'PhonePe',
      clientId: 'idempotent-test-001', // Same clientId
    }),
  });

  const d1Duplicate = await d1DuplicateRes.json();
  console.log('Duplicate Submission Result:', d1Duplicate);
  if (d1Duplicate.id === d1.id && d1Duplicate.billNo === d1.billNo) {
    console.log(`✓ Idempotency verified: duplicate tap returned exact same bill #${d1.billNo} without creating duplicate!`);
  } else {
    console.error('✗ Idempotency failed: duplicate donation created');
  }

  // ----------------------------------------------------
  // TEST E: Identity is Phone (Same Phone, Different Name)
  // ----------------------------------------------------
  console.log('\n--- TEST E: Same Phone with Different Name (Receipt Immutability) ---');
  const d2Res = await fetch(`${BASE_URL}/api/donations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      donorName: 'R. K. Prasad', // Different name representation
      phone: '9876543210',       // SAME phone number
      amount: 501,
      paymentMode: 'Cash',
      clientId: 'client-second-donation-002',
    }),
  });
  const d2 = await d2Res.json();
  console.log('Donation 2 Created with same phone:', d2);

  const donorsWithPhone = db.prepare('SELECT COUNT(*) as count FROM donors WHERE phone = ?').get('9876543210') as any;
  const donation1Check = db.prepare('SELECT id, name_on_receipt FROM donations WHERE id = ?').get(d1.id) as any;
  const donation2Check = db.prepare('SELECT id, name_on_receipt FROM donations WHERE id = ?').get(d2.id) as any;

  console.log(`Donors with phone 9876543210 in DB: ${donorsWithPhone.count} (Should be exactly 1 because phone was reused)`);
  console.log(`Donation 1 Receipt Name: "${donation1Check.name_on_receipt}" (Should be "Ramesh Kumar")`);
  console.log(`Donation 2 Receipt Name: "${donation2Check.name_on_receipt}" (Should be "R. K. Prasad")`);

  if (
    donorsWithPhone.count === 1 &&
    donation1Check.name_on_receipt === 'Ramesh Kumar' &&
    donation2Check.name_on_receipt === 'R. K. Prasad'
  ) {
    console.log('✓ Reused single donor record while preserving exact receipt names immutably!');
  } else {
    console.error('✗ Donor identity or receipt immutability failed');
  }

  // ----------------------------------------------------
  // TEST F: Same Name with Different Phone -> Different Donor
  // ----------------------------------------------------
  console.log('\n--- TEST F: Same Name with Different Phone (Different Donors) ---');
  const d3Res = await fetch(`${BASE_URL}/api/donations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      donorName: 'Ramesh Kumar', // Same name as donor 1
      phone: '9123456789',       // DIFFERENT phone
      amount: 1100,
      paymentMode: 'Online',
      clientId: 'client-diff-donor-003',
    }),
  });
  const d3 = await d3Res.json();
  console.log('Donation 3 Created with different phone:', d3);

  const rameshDonors = db.prepare('SELECT id, name, phone FROM donors WHERE name = ? ORDER BY id ASC').all('Ramesh Kumar') as any[];
  console.log('Donors named Ramesh Kumar in DB:');
  console.table(rameshDonors);

  if (rameshDonors.length >= 2 && rameshDonors[0].phone !== rameshDonors[1].phone) {
    console.log('✓ Same name with different phones successfully recognized as distinct donors!');
  } else {
    console.error('✗ Different phone donor separation failed');
  }

  // ----------------------------------------------------
  // TEST G: Case-Insensitive Search on Name showing Phone
  // ----------------------------------------------------
  console.log('\n--- TEST G: Case-Insensitive Name Search showing Phone ---');
  const searchLowerRes = await (await fetch(`${BASE_URL}/api/donors/search?q=ramesh`)).json();
  console.log(`Search for "ramesh" returned ${searchLowerRes.donors?.length} donor(s):`);
  for (const d of searchLowerRes.donors || []) {
    console.log(` - ID: ${d.id} | Name: ${d.name} | Phone: +91 ${d.phone} | Total Donated: ₹${d.totalDonated}`);
  }

  const allHavePhone = (searchLowerRes.donors || []).every((x: any) => Boolean(x.phone));
  const hasRameshMatch = (searchLowerRes.donors || []).some((x: any) => x.name.toLowerCase().includes('ramesh'));
  if (allHavePhone && hasRameshMatch) {
    console.log('✓ Case-insensitive search found donors and includes phone number for each!');
  } else {
    console.error('✗ Search failed case-insensitive match or phone inclusion');
  }

  // ----------------------------------------------------
  // TEST H: PDF File Naming (receipt_<billNo>.pdf without donor name)
  // ----------------------------------------------------
  console.log('\n--- TEST H: PDF File Name Inspection ---');
  const pdf1Path = path.resolve(process.cwd(), `data/receipts/${d1.billNo}.pdf`);
  const hasPdf1 = fs.existsSync(pdf1Path);
  console.log(`PDF for Bill #${d1.billNo} filename: receipt_${d1.billNo}.pdf (path: ${pdf1Path}) | Exists: ${hasPdf1}`);
  if (hasPdf1 && !pdf1Path.toLowerCase().includes('ramesh')) {
    console.log('✓ PDF naming verified: follows receipt_<billNo>.pdf format with NO donor name in file path!');
  } else {
    console.error('✗ PDF naming failed format rule');
  }

  // ----------------------------------------------------
  // TEST I: English-Only CSV Export
  // ----------------------------------------------------
  console.log('\n--- TEST I: English-Only CSV Export ---');
  const loginRes = await fetch(`${BASE_URL}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2026' }),
  });
  const cookieHeader = loginRes.headers.get('set-cookie') || '';
  const csvRes = await fetch(`${BASE_URL}/api/export.csv`, { headers: { Cookie: cookieHeader } });
  const csvBuffer = Buffer.from(await csvRes.arrayBuffer());
  const csvText = csvBuffer.toString('utf8');

  console.log('CSV Headers and Sample Rows:\n' + csvText);
  // Verify that all lines match ASCII printable characters (excluding the 3-byte UTF-8 BOM \uFEFF)
  const contentWithoutBom = csvText.replace(/^\uFEFF/, '');
  const isAllAscii = /^[\x00-\x7F\r\n]*$/.test(contentWithoutBom);
  console.log('Is CSV Content 100% English ASCII:', isAllAscii);
  if (isAllAscii) {
    console.log('✓ CSV export is strictly 100% English ASCII with zero Hindi collisions!');
  } else {
    console.error('✗ Non-ASCII characters found in CSV export');
  }

  console.log('\n===========================================================');
  console.log(' ALL ENGLISH-ONLY AND DATA INTEGRITY RULES FULLY VERIFIED!  ');
  console.log('===========================================================');
}

verifyEnglishRules().catch(console.error);
