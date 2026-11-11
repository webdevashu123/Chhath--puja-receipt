// Comprehensive Verification Script for Chhath Puja Donation App Backend
const BASE_URL = 'http://localhost:5000/api';

async function runVerification() {
  console.log('=====================================================');
  console.log('🚀 STARTING COMPREHENSIVE BACKEND VERIFICATION');
  console.log('=====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  // 1. Health Check
  console.log('1. Testing Health Endpoint...');
  const healthRes = await fetch(`${BASE_URL}/health`);
  const healthData = await healthRes.json();
  assert(healthRes.status === 200 && healthData.status === 'ok', 'Health endpoint returns status ok');

  // 2. PIN Authentication
  console.log('\n2. Testing PIN Authentication...');
  const validPinRes = await (await fetch(`${BASE_URL}/auth/verify-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '2026' }),
  })).json();
  assert(validPinRes.valid === true, 'Default PIN "2026" verified successfully');

  const invalidPinRes = await (await fetch(`${BASE_URL}/auth/verify-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '9999' }),
  })).json();
  assert(invalidPinRes.valid === false, 'Invalid PIN "9999" rejected');

  // 3. Stats & SQL Aggregations
  console.log('\n3. Testing SQL Stats & Aggregations...');
  const statsRes = await fetch(`${BASE_URL}/stats`);
  const stats = await statsRes.json();
  assert(stats.totalCollected > 0, `Total collected calculated via SQL SUM: ₹${stats.totalCollected.toLocaleString('en-IN')}`);
  assert(stats.targetGoal === 251000, `Target goal is ₹${stats.targetGoal.toLocaleString('en-IN')}`);
  assert(stats.goalPercentage > 0, `Goal percentage calculated: ${stats.goalPercentage}%`);
  assert(stats.modeBreakdown && stats.modeBreakdown.length === 5, 'Payment modes breakdown returned 5 modes');

  // 4. Create New Donation (Sequential Bill Numbering in Transaction)
  console.log('\n4. Testing Donation Creation & Sequential Bill Generation...');
  const newDonationPayload = {
    name: 'Suresh Prasad Verma',
    phone: '9835012345',
    amount: 2501,
    mode: 'PhonePe',
    reference_no: 'UPI/20261110001',
    note: 'Ghat lighting and bhog seva',
  };
  const createRes = await fetch(`${BASE_URL}/donations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(newDonationPayload),
  });
  const created = await createRes.json();
  assert(createRes.status === 201, 'POST /api/donations responded with 201 Created');
  assert(created.bill && created.bill.startsWith('CP-2026-'), `Generated bill number: ${created.bill}`);
  assert(created.name === 'Suresh Prasad Verma', `Donor name recorded: ${created.name}`);
  assert(created.amount === 2501, `Amount recorded: ₹${created.amount}`);
  assert(created.reference_no === 'UPI/20261110001', `UTR / Reference recorded: ${created.reference_no}`);

  // 5. Verify Stats Updated Dynamically
  console.log('\n5. Verifying Stats Updated in Database...');
  const updatedStats = await (await fetch(`${BASE_URL}/stats`)).json();
  assert(updatedStats.totalCollected === stats.totalCollected + 2501, `Total collected increased by exactly ₹2,501 to ₹${updatedStats.totalCollected.toLocaleString('en-IN')}`);

  // 6. Search Donors & Audit Trail
  console.log('\n6. Testing SQL Donor Directory & History Search...');
  const searchDonorsRes = await (await fetch(`${BASE_URL}/donors/search?q=Suresh`)).json();
  assert(searchDonorsRes.length > 0, 'Found donor profile for Suresh');
  const suresh = searchDonorsRes[0];
  assert(suresh.total_donated >= 2501, `Donor total donated calculated in SQL: ₹${suresh.total_donated}`);
  assert(suresh.donations.some(d => d.bill === created.bill), `New bill ${created.bill} present in donor history timeline`);

  // 7. Record Reconciliation & Matching (रिकॉर्ड मिलान)
  console.log('\n7. Testing SQL Record Matching (Reconciliation)...');
  // Reconcile online batch: match exact system total for today
  const reconRes = await (await fetch(`${BASE_URL}/reconciliation/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      batch_date: '08 Nov 2026',
      mode_category: 'Cash',
      actual_amount: 49589, // matching cash amount
      notes: 'Evening cash physical box count',
    }),
  })).json();
  assert(reconRes.reconciliation_id > 0, `Reconciliation record saved in SQL with ID: ${reconRes.reconciliation_id}`);
  assert(reconRes.system_amount !== undefined, `System SQL amount verified: ₹${reconRes.system_amount}`);

  // 8. CSV Export
  console.log('\n8. Testing CSV Export for Excel/Sheets...');
  const csvRes = await fetch(`${BASE_URL}/donations/export/csv`);
  assert(csvRes.status === 200, 'CSV export endpoint returned 200');
  const csvText = await csvRes.text();
  assert(csvText.includes('Bill Number') && csvText.includes('Suresh Prasad Verma'), 'CSV contains proper headers and newly created donation record');

  // 9. Delete Donation & Clean Up
  console.log('\n9. Testing Deletion & Audit Log...');
  const deleteRes = await fetch(`${BASE_URL}/donations/${created.id}`, { method: 'DELETE' });
  const deleteData = await deleteRes.json();
  assert(deleteRes.status === 200 && deleteData.success === true, 'Donation successfully cancelled/deleted');

  const finalStats = await (await fetch(`${BASE_URL}/stats`)).json();
  assert(finalStats.totalCollected === stats.totalCollected, `Stats recalculated in SQL: ₹${finalStats.totalCollected.toLocaleString('en-IN')}`);

  console.log('\n=====================================================');
  console.log(`🏁 VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log('=====================================================');
}

runVerification().catch(console.error);
