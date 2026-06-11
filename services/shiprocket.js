const axios = require('axios');

const SHIPROCKET_BASE = 'https://apiv2.shiprocket.in/v1/external';

let cachedToken = null;
let tokenExpiry = null;

function getMode() {
  const configured = String(process.env.SHIPROCKET_MODE || '').trim().toLowerCase();
  if (['mock', 'test', 'sandbox'].includes(configured)) return 'mock';
  if (['live', 'prod', 'production'].includes(configured)) return 'live';
  return process.env.NODE_ENV === 'production' ? 'live' : 'mock';
}

function isMockMode() {
  return getMode() === 'mock';
}

function shiprocketError(err) {
  const status = err.response?.status || err.statusCode || 502;
  const message = err.response?.data?.message || err.response?.data?.error || err.message || 'Shiprocket request failed.';
  const wrapped = new Error(message);
  wrapped.statusCode = status;
  wrapped.shiprocket = err.response?.data || err.details;
  return wrapped;
}

async function getToken() {
  const { SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD } = process.env;
  if (!SHIPROCKET_EMAIL || !SHIPROCKET_PASSWORD) {
    const err = new Error('Shiprocket credentials are missing. Add SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in .env.');
    err.statusCode = 500;
    throw err;
  }
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;
  const res = await axios.post(`${SHIPROCKET_BASE}/auth/login`, { email: SHIPROCKET_EMAIL, password: SHIPROCKET_PASSWORD });
  cachedToken = res.data.token;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  return cachedToken;
}

function requireMockPincode(pincode) {
  const clean = String(pincode || '').trim();
  if (!/^[1-9][0-9]{5}$/.test(clean)) {
    const err = new Error('Enter a valid 6 digit Indian pincode.');
    err.statusCode = 400;
    throw err;
  }
  return clean;
}

function mockServiceability({ pincode, weight = 0.5, declaredValue = 500 }) {
  const deliveryPostcode = requireMockPincode(pincode);

  if (deliveryPostcode === '999999') {
    const err = new Error('Mock Shiprocket: delivery is not serviceable for this pincode.');
    err.statusCode = 422;
    err.details = { mode: 'mock', delivery_postcode: deliveryPostcode, available_courier_companies: [] };
    throw err;
  }

  const baseFreight = deliveryPostcode === '641004' ? 68 : 84;
  return {
    status: 200,
    mode: 'mock',
    pickup_postcode: Number(process.env.SHIPROCKET_PICKUP_PINCODE || 641001),
    delivery_postcode: Number(deliveryPostcode),
    weight: Number(weight),
    declared_value: Number(declaredValue),
    data: {
      available_courier_companies: [
        {
          courier_company_id: 101,
          courier_name: 'Mock Express Surface',
          freight_charge: baseFreight,
          etd: '2-4 Days',
          estimated_delivery_days: '3',
          rate: baseFreight,
          cod: 0
        },
        {
          courier_company_id: 102,
          courier_name: 'Mock Priority Air',
          freight_charge: baseFreight + 45,
          etd: '1-2 Days',
          estimated_delivery_days: '2',
          rate: baseFreight + 45,
          cod: 0
        }
      ],
      recommended_courier_company_id: 101
    }
  };
}

function mockCreateOrder(orderData) {
  const orderId = orderData.id || orderData.merchantTransactionId;
  const suffix = String(orderId || Date.now()).replace(/[^a-z0-9]/gi, '').slice(-10).toUpperCase();
  return {
    mock: true,
    mode: 'mock',
    order_id: `MOCK-SR-${suffix}`,
    shipment_id: `MOCK-SHIP-${suffix}`,
    awb_code: `MOCKAWB${suffix}`,
    courier_company_id: 101,
    courier_name: 'Mock Express Surface',
    status: 'CREATED',
    status_code: 1
  };
}

function mockTrackOrder(orderId) {
  const cleanId = String(orderId || '').trim();
  if (!cleanId) {
    const err = new Error('Shiprocket order id is required.');
    err.statusCode = 400;
    throw err;
  }
  if (cleanId.toUpperCase().includes('NOTFOUND')) {
    const err = new Error('Mock Shiprocket: order not found.');
    err.statusCode = 404;
    throw err;
  }
  return {
    mock: true,
    mode: 'mock',
    data: {
      id: cleanId,
      current_status: 'IN_TRANSIT',
      awb_code: `MOCKAWB${cleanId.replace(/[^a-z0-9]/gi, '').slice(-10).toUpperCase()}`,
      courier_name: 'Mock Express Surface',
      tracking_data: {
        shipment_track: [
          {
            current_status: 'IN_TRANSIT',
            delivered_date: '',
            destination: 'Customer pincode',
            origin: 'Pickup location'
          }
        ],
        shipment_track_activities: [
          { date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), activity: 'Shipment created' },
          { date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), activity: 'Picked up from seller' },
          { date: new Date().toISOString(), activity: 'In transit to destination hub' }
        ]
      }
    }
  };
}

async function createOrder(orderData) {
  if (isMockMode()) return mockCreateOrder(orderData);

  const token = await getToken();
  const { SHIPROCKET_PICKUP_LOCATION } = process.env;
  const { customer, items, shipping } = orderData;
  const merchantTransactionId = orderData.id || orderData.merchantTransactionId;

  const payload = {
    order_id: merchantTransactionId,
    order_date: new Date().toISOString().split('T')[0],
    pickup_location: SHIPROCKET_PICKUP_LOCATION || 'Primary',
    channel_id: '',
    comment: 'Order from Nika Arts Studio website',
    billing_customer_name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
    billing_last_name: customer.lastName || customer.firstName || 'Customer',
    billing_address: customer.address,
    billing_city: customer.city,
    billing_pincode: customer.pincode,
    billing_state: customer.state,
    billing_country: 'India',
    billing_email: customer.email,
    billing_phone: customer.phone,
    shipping_is_billing: true,
    order_items: items.map(item => ({
      name: item.selectedColor || item.color ? `${item.name} - ${item.selectedColor || item.color}` : item.name,
      sku: item.productId || item.id,
      units: item.qty,
      selling_price: item.price,
      discount: 0,
      tax: '',
      hsn: ''
    })),
    payment_method: 'Prepaid',
    shipping_charges: shipping || 0,
    giftwrap_charges: 0,
    transaction_charges: 0,
    total_discount: 0,
    sub_total: items.reduce((sum, item) => sum + item.price * item.qty, 0),
    length: 20,
    breadth: 15,
    height: 10,
    weight: 0.5
  };

  try {
    const response = await axios.post(`${SHIPROCKET_BASE}/orders/create/adhoc`, payload, { headers: { Authorization: `Bearer ${token}` } });
    return response.data;
  } catch (err) {
    throw shiprocketError(err);
  }
}

async function trackOrder(orderId) {
  if (isMockMode()) return mockTrackOrder(orderId);
  const token = await getToken();
  try {
    const response = await axios.get(`${SHIPROCKET_BASE}/orders/show/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
    return response.data;
  } catch (err) {
    throw shiprocketError(err);
  }
}

async function serviceability({ pincode, weight = 0.5, declaredValue = 500 }) {
  if (isMockMode()) return mockServiceability({ pincode, weight, declaredValue });

  const { SHIPROCKET_PICKUP_PINCODE } = process.env;
  if (!SHIPROCKET_PICKUP_PINCODE) {
    const err = new Error('Shiprocket pickup pincode is missing. Add SHIPROCKET_PICKUP_PINCODE in .env.');
    err.statusCode = 500;
    throw err;
  }

  const token = await getToken();
  try {
    const response = await axios.get(`${SHIPROCKET_BASE}/courier/serviceability/`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        pickup_postcode: Number(SHIPROCKET_PICKUP_PINCODE),
        delivery_postcode: Number(pincode),
        cod: 0,
        weight: Number(weight),
        declared_value: Number(declaredValue),
        is_return: 0
      }
    });
    if (Number(response.data?.status) >= 400) {
      const err = new Error(response.data.message || 'Shiprocket serviceability check failed.');
      err.statusCode = 422;
      err.details = response.data;
      throw err;
    }
    return response.data;
  } catch (err) {
    throw shiprocketError(err);
  }
}

module.exports = {
  createOrder,
  getMode,
  isMockMode,
  serviceability,
  shiprocketError,
  trackOrder
};
