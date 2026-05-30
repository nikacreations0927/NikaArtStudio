process.env.SHIPROCKET_MODE = 'mock';
process.env.SHIPROCKET_PICKUP_PINCODE = process.env.SHIPROCKET_PICKUP_PINCODE || '641004';

const assert = require('assert/strict');
const shiprocket = require('../services/shiprocket');

async function expectError(label, fn, expectedStatus) {
  try {
    await fn();
  } catch (err) {
    assert.equal(err.statusCode, expectedStatus, `${label}: expected status ${expectedStatus}, got ${err.statusCode}`);
    console.log(`ok - ${label}`);
    return;
  }
  throw new Error(`${label}: expected an error`);
}

async function main() {
  assert.equal(shiprocket.getMode(), 'mock');

  const serviceable = await shiprocket.serviceability({ pincode: '641004', weight: 0.5, declaredValue: 499 });
  assert.equal(serviceable.mode, 'mock');
  assert.ok(serviceable.data.available_courier_companies.length >= 1);
  console.log('ok - serviceability happy path');

  await expectError('serviceability rejects malformed pincode', () => shiprocket.serviceability({ pincode: '123' }), 400);
  await expectError('serviceability handles unserviceable pincode', () => shiprocket.serviceability({ pincode: '999999' }), 422);

  const created = await shiprocket.createOrder({
    id: 'ORDMOCK123',
    customer: {
      firstName: 'Mock',
      lastName: 'Customer',
      address: 'Mock address',
      city: 'Coimbatore',
      pincode: '641004',
      state: 'Tamil Nadu',
      email: 'mock@example.com',
      phone: '9999999999'
    },
    items: [{ productId: 'PROD1', name: 'Mock Product', price: 499, qty: 2 }],
    shipping: 99
  });
  assert.equal(created.mode, 'mock');
  assert.match(created.order_id, /^MOCK-SR-/);
  assert.match(created.shipment_id, /^MOCK-SHIP-/);
  assert.match(created.awb_code, /^MOCKAWB/);
  console.log('ok - create order happy path');

  const tracked = await shiprocket.trackOrder(created.order_id);
  assert.equal(tracked.mode, 'mock');
  assert.equal(tracked.data.current_status, 'IN_TRANSIT');
  assert.ok(tracked.data.tracking_data.shipment_track_activities.length >= 1);
  console.log('ok - tracking happy path');

  await expectError('tracking handles missing order', () => shiprocket.trackOrder('NOTFOUND'), 404);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
