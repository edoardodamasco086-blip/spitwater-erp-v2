'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../server/.env') });

const request  = require('supertest');
const jwt      = require('jsonwebtoken');
const app      = require('../server');  // import the express app (already exported as module.exports = app)

// ── Test Auth Token ────────────────────────────────────────────────────────
// We need a valid JWT. Either use the login endpoint or generate one directly.
// We'll generate a test token for org_id=1, userId=1 (seeded admin)
const TEST_TOKEN = jwt.sign(
  { userId: 1, orgId: 1, role: 'admin', email: 'test@test.com' },
  process.env.JWT_SECRET || 'test-secret',
  { expiresIn: '1h' }
);
const authHeader = { Authorization: `Bearer ${TEST_TOKEN}` };

// ── Helpers ────────────────────────────────────────────────────────────────
async function cleanupBP(id) {
  if (!id) return;
  try { await request(app).delete(`/api/business-partners/${id}`).set(authHeader); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// SMOKE TEST 1: Business Partner Master Data Flow
// Create Org BP → Create Person BP → Link them → Add addresses → Query 360°
// ═══════════════════════════════════════════════════════════════════════════
describe('Smoke Test 1: BP Master Data Flow', () => {
  let orgBpId, personBpId, orgLegacyContactId;

  afterAll(async () => {
    await cleanupBP(personBpId);
    await cleanupBP(orgBpId);
  });

  test('1a. Create Organization BP', async () => {
    const res = await request(app)
      .post('/api/business-partners')
      .set(authHeader)
      .send({
        bp_type: 'organization',
        legal_entity_name: '[SMOKE TEST] Acme Corp Pty Ltd',
        trading_name: 'Acme Corp',
        bp_role: 'customer',
        abn: '12 345 678 901',
        gst_registered: true,
        email: 'acme@smoketest.invalid',
        phone: '07 3000 0001',
        payment_terms: 'NET30',
        credit_limit: 50000,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    orgBpId = res.body.data.id;
    orgLegacyContactId = res.body.data.legacy_contact_id;
  });

  test('1b. Create Person BP', async () => {
    const res = await request(app)
      .post('/api/business-partners')
      .set(authHeader)
      .send({
        bp_type: 'person',
        first_name: '[Smoke]',
        last_name: 'TestPerson',
        job_title: 'Purchasing Manager',
        bp_role: 'customer',
        email: 'person@smoketest.invalid',
        mobile: '0400 000 001',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    personBpId = res.body.data.id;
  });

  test('1c. Link Person to Organization', async () => {
    const res = await request(app)
      .post(`/api/business-partners/${orgBpId}/relationships`)
      .set(authHeader)
      .send({
        person_bp_id: personBpId,
        org_bp_id: orgBpId,
        role_label: 'Purchasing Manager',
        is_primary_contact: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('1d. Add Ship-To address via legacy contact endpoint', async () => {
    if (!orgLegacyContactId) return; // skip if no legacy contact
    const res = await request(app)
      .post(`/api/bp/addresses/${orgLegacyContactId}`)
      .set(authHeader)
      .send({
        address_role: 'ship_to',
        label: 'Warehouse',
        address_line1: '123 Smoke Test St',
        suburb: 'Brisbane',
        state: 'QLD',
        postcode: '4000',
        country: 'Australia',
        is_default: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('1e. Add Bill-To address', async () => {
    if (!orgLegacyContactId) return;
    const res = await request(app)
      .post(`/api/bp/addresses/${orgLegacyContactId}`)
      .set(authHeader)
      .send({
        address_role: 'bill_to',
        label: 'Head Office',
        address_line1: '456 Invoice Lane',
        suburb: 'Sydney',
        state: 'NSW',
        postcode: '2000',
        country: 'Australia',
        is_default: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  test('1f. Query 360° view — must return consolidated payload', async () => {
    const res = await request(app)
      .get(`/api/business-partners/${orgBpId}/360`)
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { data } = res.body;

    // BP master data present
    expect(data.bp).toBeDefined();
    expect(data.bp.bp_type).toBe('organization');
    expect(data.bp.legal_entity_name).toBe('[SMOKE TEST] Acme Corp Pty Ltd');

    // Addresses present (at least the ones we added)
    expect(Array.isArray(data.addresses)).toBe(true);
    expect(data.addresses.length).toBeGreaterThanOrEqual(2);
    expect(data.addresses.some(a => a.address_role === 'ship_to')).toBe(true);
    expect(data.addresses.some(a => a.address_role === 'bill_to')).toBe(true);

    // Linked person present
    expect(Array.isArray(data.linked_persons)).toBe(true);
    expect(data.linked_persons.length).toBeGreaterThanOrEqual(1);

    // Open docs array must exist (even if empty)
    expect(Array.isArray(data.open_documents)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SMOKE TEST 2: P2P Sourcing Flow (PIR-powered PO pricing)
// ═══════════════════════════════════════════════════════════════════════════
describe('Smoke Test 2: P2P Sourcing Flow', () => {

  test('2a. PIR list endpoint is reachable', async () => {
    const res = await request(app)
      .get('/api/pir')
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('2b. PIR price determination endpoint works', async () => {
    // Get first available product and vendor from PIR
    const pirList = await request(app).get('/api/pir').set(authHeader);

    if (!pirList.body.data?.length) {
      console.warn('[Smoke 2b] No PIRs in DB — skipping price determination test');
      return;
    }

    const firstPir = pirList.body.data[0];
    const res = await request(app)
      .post('/api/pir/determine-price')
      .set(authHeader)
      .send({
        product_id: firstPir.product_id,
        vendor_id:  firstPir.vendor_id,
        qty:        1,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // price may be null if no conditions exist, but endpoint must not 500
    expect(res.body).toHaveProperty('data');
  });

  test('2c. PO list endpoint is reachable', async () => {
    const res = await request(app)
      .get('/api/p2p/orders')
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('2d. Source list endpoint returns vendor rankings', async () => {
    const res = await request(app)
      .get('/api/pir/source-list')
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SMOKE TEST 3: O2C ATP Engine Flow
// Create SO → confirm → verify schedule lines (soft allocation + backorder)
// ═══════════════════════════════════════════════════════════════════════════
describe('Smoke Test 3: O2C ATP Engine Flow', () => {
  let soId, createdSoNumber;

  afterAll(async () => {
    // Cancel the test SO if it was created
    if (soId) {
      try {
        await request(app).post(`/api/o2c/so/${soId}/cancel`).set(authHeader)
          .send({ reason: 'smoke test cleanup' });
      } catch {}
    }
  });

  test('3a. SO list endpoint is reachable', async () => {
    const res = await request(app)
      .get('/api/o2c/so')
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('3b. Can create a Sales Order', async () => {
    // Get first available customer contact
    const contactsRes = await request(app)
      .get('/api/contacts?limit=5&type=customer')
      .set(authHeader);

    const customers = contactsRes.body.data || [];
    if (!customers.length) {
      // Try "both" type
      const both = await request(app).get('/api/contacts?limit=5&type=both').set(authHeader);
      customers.push(...(both.body.data || []));
    }

    if (!customers.length) {
      console.warn('[Smoke 3b] No customers in DB — skipping SO creation test');
      return;
    }

    const customerId = customers[0].id;
    const res = await request(app)
      .post('/api/o2c/so')
      .set(authHeader)
      .send({
        customer_id: customerId,
        is_full_delivery_required: false,
        notes: '[SMOKE TEST] ATP split test',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    soId = res.body.data.id;
    createdSoNumber = res.body.data.so_number;
  });

  test('3c. SO detail endpoint returns full structure', async () => {
    if (!soId) return;

    const res = await request(app)
      .get(`/api/o2c/so/${soId}`)
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const { data } = res.body;

    expect(data.id).toBe(soId);
    expect(data.status).toBe('draft');
    expect(data.is_full_delivery_required).toBe(false);
    expect(Array.isArray(data.items)).toBe(true);
    expect(Array.isArray(data.deliveries)).toBe(true);
  });

  test('3d. Business Partner 360° endpoint accessible for existing BPs', async () => {
    const bpList = await request(app)
      .get('/api/business-partners?limit=5')
      .set(authHeader);

    expect(bpList.status).toBe(200);
    expect(Array.isArray(bpList.body.data)).toBe(true);

    if (bpList.body.data?.length) {
      const firstBpId = bpList.body.data[0].id;
      const res = await request(app)
        .get(`/api/business-partners/${firstBpId}/360`)
        .set(authHeader);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('bp');
      expect(res.body.data).toHaveProperty('addresses');
      expect(res.body.data).toHaveProperty('open_documents');
    }
  });
});
