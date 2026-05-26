require('dotenv').config();

const baseUrl = (process.env.SMOKE_BASE_URL || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const runId = Date.now();
const email = `smoke-${runId}@example.com`;
const initialPassword = `SmokePass-${runId}`;
const nextPassword = `SmokePassNew-${runId}`;

const jar = new Map();

function storeCookies(response) {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return;

  for (const cookiePart of setCookie.split(/,(?=[^;]+?=)/)) {
    const [pair] = cookiePart.split(';');
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
}

function cookieHeader() {
  return Array.from(jar.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  storeCookies(response);

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log(`Running smoke e2e against ${baseUrl}`);

  const health = await request('/api/health');
  assert(health.response.ok, 'Health check failed');

  const productsResult = await request('/api/products');
  assert(productsResult.response.ok, 'Products API failed');
  assert(Array.isArray(productsResult.body.products), 'Products API did not return an array');
  assert(productsResult.body.products.length > 0, 'Products API returned no products');
  const product = productsResult.body.products.find(item => Number(item.stock) > 0) || productsResult.body.products[0];

  const register = await request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      firstName: 'Smoke',
      lastName: 'Test',
      email,
      mobile: '9999999999',
      password: initialPassword
    })
  });
  assert(register.response.status === 201, `Customer registration failed: ${register.body?.message || register.response.status}`);

  const me = await request('/api/auth/me');
  assert(me.response.ok && me.body.customer?.email === email, 'Customer session check failed after registration');

  const password = await request('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: initialPassword, newPassword: nextPassword })
  });
  assert(password.response.ok, `Customer password update failed: ${password.body?.message || password.response.status}`);

  const logout = await request('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  assert(logout.response.ok, 'Customer logout failed');

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: nextPassword })
  });
  assert(login.response.ok, `Customer login with new password failed: ${login.body?.message || login.response.status}`);

  const payment = await request('/api/payment/initiate', {
    method: 'POST',
    body: JSON.stringify({
      customer: {
        firstName: 'Smoke',
        lastName: 'Test',
        email,
        phone: '9999999999',
        address: 'Smoke test address',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pincode: '641004'
      },
      cart: [{ productId: product.id, qty: 1 }],
      upiReference: `SMOKE-UPI-${runId}`
    })
  });

  assert(payment.response.ok, `Manual UPI order failed: ${payment.body?.message || payment.response.status}`);
  assert(payment.body?.status === 'UPI_PENDING_VERIFICATION', 'Manual UPI order did not enter pending verification state');
  console.log('Manual UPI order response:', payment.response.status, payment.body?.orderId, payment.body?.status);
  console.log('Smoke e2e completed.');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
