// public/js/admin.js

// --- Global State & Auth ---
const usernameInput = document.getElementById('admin-username');
const passwordInput = document.getElementById('admin-password');
let currentAdmin = null;
let ADMIN_CATEGORIES = [];
let ADMIN_ORDERS = [];
let ADMIN_PRODUCTS = [];
let currentSiteContent = {}; 
let adminConfirmResolver = null;
const INVENTORY_STATE = {
  page: 1,
  pageSize: 25,
  query: '',
  category: '',
  status: 'all',
  sort: 'newest',
  filtered: []
};
const SALES_DASHBOARD_STATE = {
  products: [],
  timeline: {},
  selectedProductId: '',
  period: 'daily'
};

function adminHeaders() {
  return { 'Content-Type': 'application/json' };
}

function setAdminAuthState(admin) {
  currentAdmin = admin || null;
  const status = document.getElementById('admin-session-status');
  const adminContent = document.getElementById('admin-content');

  if (currentAdmin) {
    if (usernameInput) usernameInput.value = currentAdmin.username || '';
    if (passwordInput) passwordInput.value = '';
    if (status) status.textContent = `Signed in as ${currentAdmin.displayName || currentAdmin.username}`;
  } else {
    if (status) status.textContent = 'Signed out';
    if (adminContent) {
      adminContent.innerHTML = '<p style="text-align: center; color: #666; margin-top: 2rem;">Please log in to manage store operations.</p>';
    }
  }
}

async function saveAdminLogin() {
  try {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) throw new Error('Enter admin username and password.');

    const data = await api('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    setAdminAuthState(data.admin);
    showMessage('Logged in. Admin session is active.');
    await switchTab('dashboard');
  } catch (err) {
    showMessage(err.message, true);
  }
}

async function clearAdminLogin() {
  try {
    await fetch('/api/auth/admin/logout', { method: 'POST' });
  } catch (err) {
    console.warn('Admin logout request failed.', err);
  }

  if (usernameInput) usernameInput.value = '';
  if (passwordInput) passwordInput.value = '';
  clearInterval(dashboardPollingInterval);
  setAdminAuthState(null);
  showMessage('Logged out.');
}

async function checkAdminSession() {
  try {
    const res = await fetch('/api/auth/admin/me');
    const data = await res.json();
    if (res.ok && data.success) {
      setAdminAuthState(data.admin);
      await switchTab('dashboard');
      return;
    }
  } catch (err) {
    console.warn('Could not check admin session.', err);
  }

  setAdminAuthState(null);
}

function showMessage(message, isError = false) {
  const el = document.getElementById('admin-message');
  const fallback = isError ? 'Something went wrong. Please refresh the admin page and try again.' : '';
  el.textContent = String(message || fallback);
  el.className = isError ? 'admin-message error-msg' : 'admin-message';
  if (!isError) setTimeout(() => { el.textContent = ''; }, 3000);
}

function closeAdminConfirm(result) {
  const modal = document.getElementById('admin-confirm-modal');
  if (modal) modal.hidden = true;

  if (adminConfirmResolver) {
    adminConfirmResolver(result);
    adminConfirmResolver = null;
  }
}

function showAdminConfirm({ title, body, confirmText = 'Remove' }) {
  const modal = document.getElementById('admin-confirm-modal');
  const titleEl = document.getElementById('admin-confirm-title');
  const bodyEl = document.getElementById('admin-confirm-body');
  const okBtn = document.getElementById('admin-confirm-ok');
  const cancelBtn = document.getElementById('admin-confirm-cancel');
  if (!modal || !titleEl || !bodyEl || !okBtn || !cancelBtn) return Promise.resolve(false);

  titleEl.textContent = title;
  bodyEl.textContent = body;
  okBtn.textContent = confirmText;
  modal.hidden = false;

  return new Promise(resolve => {
    adminConfirmResolver = resolve;
    cancelBtn.focus();
  });
}

document.getElementById('admin-confirm-cancel')?.addEventListener('click', () => closeAdminConfirm(false));
document.getElementById('admin-confirm-ok')?.addEventListener('click', () => closeAdminConfirm(true));
document.getElementById('admin-confirm-modal')?.addEventListener('click', event => {
  if (event.target.id === 'admin-confirm-modal') closeAdminConfirm(false);
});
document.addEventListener('keydown', event => {
  const modal = document.getElementById('admin-confirm-modal');
  const editor = document.getElementById('product-editor-modal');
  if (event.key === 'Escape' && modal && !modal.hidden) closeAdminConfirm(false);
  if (event.key === 'Escape' && editor && !editor.hidden) closeProductEditor();
});
document.getElementById('product-editor-modal')?.addEventListener('click', event => {
  if (event.target.id === 'product-editor-modal') closeProductEditor();
});
document.getElementById('edit-product-image-file')?.addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) {
    setProductEditorPreview(document.getElementById('edit-product-image-url')?.value || '');
    return;
  }
  const previewUrl = URL.createObjectURL(file);
  setProductEditorPreview(previewUrl);
});

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, { ...options, headers: { ...adminHeaders(), ...(options.headers || {}) } });
  } catch (err) {
    throw new Error(err.message || 'Network request failed. Check that the server is running.');
  }

  const rawText = await res.text();
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { success: false, message: rawText || `Request failed with status ${res.status}. Please refresh or restart the server.` };
  }
  if (!res.ok || data.success === false) {
    if (res.status === 401 && path !== '/api/auth/admin/login') {
      setAdminAuthState(null);
    }
    throw new Error(data.message || data.error || `Request failed with status ${res.status}.`);
  }
  return data;
}

function rupees(value) { return 'Rs. ' + Number(value || 0).toLocaleString('en-IN'); }

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

// --- Routing / Tab Switching ---
let dashboardPollingInterval; // Stores our heartbeat timer

async function switchTab(tabId) {
  try {
    if (!currentAdmin) {
      showMessage('Please log in to manage store operations.', true);
      return;
    }

    // 1. Clear the timer if we leave the dashboard (saves server resources!)
    clearInterval(dashboardPollingInterval);

    // 2. Fetch the HTML file for the panel
    const res = await fetch(`/admin-panels/${tabId}.html`);
    if (!res.ok) throw new Error(`Could not load ${tabId} panel.`);
    
    // 3. Inject it into the page
    document.getElementById('admin-content').innerHTML = await res.text();
    
    // 4. Update active tab styling
    document.querySelectorAll('.admin-tabs button').forEach(btn => btn.style.fontWeight = 'normal');
    const activeTabBtn = document.getElementById(`tab-${tabId}`);
    if (activeTabBtn) activeTabBtn.style.fontWeight = 'bold';

    // 5. Load the relevant data for that specific panel
    if (tabId === 'dashboard') {
      await loadDashboardData();
      await loadOrders();
      
      // LIVE DASHBOARD: Auto-refresh stats and orders every 5 seconds!
      dashboardPollingInterval = setInterval(async () => {
        await loadDashboardData();
        await loadOrders();
      }, 5000);

    } else if (tabId === 'inventory') {
      await loadCategoriesAdmin();
      await loadStorageStatus();
      await loadProductsAdmin();
    } else if (tabId === 'cms') {
      await loadSiteContent();
    } else if (tabId === 'settings') {
      document.getElementById('admin-current-password')?.focus();
    }
  } catch (err) {
    showMessage(err.message, true);
  }
}

// Fixes the "Refresh" button in your top toolbar
function loadAdminData() {
  const activeBtn = Array.from(document.querySelectorAll('.admin-tabs button')).find(btn => btn.style.fontWeight === 'bold');
  if (activeBtn) {
    const tabId = activeBtn.id.replace('tab-', '');
    switchTab(tabId);
    showMessage('Dashboard data refreshed.');
  } else {
    switchTab('dashboard');
  }
}


// --- Dashboard Logic ---
async function loadDashboardData() {
  const data = await api('/api/orders/sales/dashboard');
  SALES_DASHBOARD_STATE.products = data.dashboard.products || [];
  SALES_DASHBOARD_STATE.timeline = data.dashboard.timeline || {};

  const productSelect = document.getElementById('sales-product-select');
  if (productSelect) {
    const previousValue = productSelect.value || SALES_DASHBOARD_STATE.selectedProductId;
    productSelect.innerHTML = `<option value="">All products</option>${SALES_DASHBOARD_STATE.products.map(product => `
      <option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>
    `).join('')}`;
    if (SALES_DASHBOARD_STATE.products.some(product => product.id === previousValue)) {
      productSelect.value = previousValue;
      SALES_DASHBOARD_STATE.selectedProductId = previousValue;
    }
  }

  renderSalesSummaryCards();
  renderSelectedProductReport();
  renderSalesDashboardCharts();
  renderProductSalesTable();
}

function getSelectedProduct() {
  const select = document.getElementById('sales-product-select');
  SALES_DASHBOARD_STATE.selectedProductId = select?.value || '';
  return SALES_DASHBOARD_STATE.products.find(product => product.id === SALES_DASHBOARD_STATE.selectedProductId) || null;
}

function renderSalesSummaryCards() {
  const el = document.getElementById('admin-stats');
  if (!el) return;
  const products = SALES_DASHBOARD_STATE.products;
  const totalUnits = products.reduce((sum, product) => sum + product.unitsSold, 0);
  const totalRevenue = products.reduce((sum, product) => sum + product.revenue, 0);
  const lowStock = products.filter(product => product.stock > 0 && product.stock <= 3).length;
  const outOfStock = products.filter(product => product.stock <= 0).length;

  el.innerHTML = `
    <div><span>Products sold</span><strong>${totalUnits}</strong></div>
    <div><span>Total revenue</span><strong>${rupees(totalRevenue)}</strong></div>
    <div><span>Low stock</span><strong>${lowStock}</strong></div>
    <div><span>Out of stock</span><strong>${outOfStock}</strong></div>
  `;
}

function renderSelectedProductReport() {
  const product = getSelectedProduct();
  const title = document.getElementById('selected-product-title');
  const subtitle = document.getElementById('selected-product-subtitle');
  const report = document.getElementById('selected-product-report');
  if (!title || !subtitle || !report) return;

  const source = product || {
    name: 'All products',
    category: 'Complete catalog',
    unitsSold: SALES_DASHBOARD_STATE.products.reduce((sum, item) => sum + item.unitsSold, 0),
    revenue: SALES_DASHBOARD_STATE.products.reduce((sum, item) => sum + item.revenue, 0),
    stock: SALES_DASHBOARD_STATE.products.reduce((sum, item) => sum + item.stock, 0)
  };

  title.textContent = `${source.name} report`;
  subtitle.textContent = source.category || '';
  report.innerHTML = `
    <div><span>Products sold</span><strong>${source.unitsSold}</strong></div>
    <div><span>Total revenue</span><strong>${rupees(source.revenue)}</strong></div>
    <div><span>Stock sold</span><strong>${source.unitsSold}</strong></div>
    <div><span>Stock remaining</span><strong>${source.stock}</strong></div>
  `;
}

function periodLabel(period) {
  return ({ daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', annual: 'Annual' }[period] || 'Daily');
}

function renderSalesDashboardCharts() {
  const periodSelect = document.getElementById('sales-period-select');
  SALES_DASHBOARD_STATE.period = periodSelect?.value || SALES_DASHBOARD_STATE.period || 'daily';
  const period = SALES_DASHBOARD_STATE.period;
  const title = document.getElementById('sales-chart-title');
  const chart = document.getElementById('sales-chart');
  if (!chart) return;
  if (title) title.textContent = `${periodLabel(period)} sales by product`;

  const rows = SALES_DASHBOARD_STATE.timeline[period] || [];
  const selectedProduct = getSelectedProduct();
  const filteredRows = selectedProduct ? rows.filter(row => row.productId === selectedProduct.id) : rows;
  if (!filteredRows.length) {
    chart.innerHTML = '<p class="inventory-empty">No paid sales data for this view yet.</p>';
    return;
  }

  const grouped = new Map();
  for (const row of filteredRows) {
    const key = selectedProduct ? row.label : row.productName;
    const existing = grouped.get(key) || { label: key, units: 0, revenue: 0 };
    existing.units += Number(row.units || 0);
    existing.revenue += Number(row.revenue || 0);
    grouped.set(key, existing);
  }
  const graphRows = Array.from(grouped.values())
    .sort((a, b) => b.units - a.units || b.revenue - a.revenue || a.label.localeCompare(b.label))
    .slice(0, selectedProduct ? 18 : 14);
  const maxUnits = Math.max(1, ...graphRows.map(row => row.units));
  const maxRevenue = Math.max(1, ...graphRows.map(row => row.revenue));

  chart.innerHTML = `
    <div class="sales-chart-legend">
      <span><i class="units"></i>Units sold</span>
      <span><i class="revenue"></i>Revenue</span>
    </div>
    ${graphRows.map(row => `
      <div class="sales-chart-row">
        <div class="sales-chart-label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</div>
        <div class="sales-chart-bars">
          <div class="sales-bar units" style="width:${Math.max(3, (row.units / maxUnits) * 100)}%"><span>${row.units}</span></div>
          <div class="sales-bar revenue" style="width:${Math.max(3, (row.revenue / maxRevenue) * 100)}%"><span>${rupees(row.revenue)}</span></div>
        </div>
      </div>
    `).join('')}
  `;
}

function renderProductSalesTable() {
  const body = document.getElementById('product-sales-body');
  if (!body) return;
  const rows = [...SALES_DASHBOARD_STATE.products].sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue || a.name.localeCompare(b.name));
  body.innerHTML = rows.map(product => `
    <tr>
      <td><strong>${escapeHtml(product.name)}</strong></td>
      <td>${escapeHtml(product.category)}</td>
      <td>${product.unitsSold}</td>
      <td>${rupees(product.revenue)}</td>
      <td>${product.stock}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="inventory-empty">No products found.</td></tr>';
}

async function loadOrders() {
  const data = await api('/api/orders?limit=50');
  ADMIN_ORDERS = data.orders;
  document.getElementById('orders-body').innerHTML = data.orders.map(order => `
    <tr data-order="${order.id}">
      <td><strong>${order.id}</strong><br /><small>${order.customer.firstName || ''} ${order.customer.lastName || ''}</small></td>
      <td>${rupees(order.total)}</td>
      <td>
        <strong>${escapeHtml(order.paymentStatus)}</strong>
        ${order.providerTransactionId ? `<br /><small>Ref: ${escapeHtml(order.providerTransactionId)}</small>` : ''}
        ${order.paymentProvider ? `<br /><small>${escapeHtml(order.paymentProvider)}</small>` : ''}
      </td>
      <td>
        <select class="fulfillment-status">
          ${['PENDING','READY_FOR_SHIPPING','PACKED','SHIPPED','DELIVERED','CANCELLED'].map(status => `<option value="${status}" ${order.fulfillmentStatus === status ? 'selected' : ''}>${status}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="logistics-status">
          ${['NOT_CREATED','CREATED','PICKUP_SCHEDULED','IN_TRANSIT','DELIVERED','RETURNED','FAILED'].map(status => `<option value="${status}" ${order.logisticsStatus === status ? 'selected' : ''}>${status}</option>`).join('')}
        </select>
      </td>
      <td class="order-row-actions">
        ${order.paymentStatus === 'UPI_PENDING_VERIFICATION' ? `<button class="btn-outline small-btn" onclick="verifyManualPayment('${order.id}')">Verify payment</button>` : ''}
        <button class="btn-outline small-btn" onclick="saveOrderStatus('${order.id}')">Save</button>
      </td>
    </tr>
  `).join('');
}

function exportOrdersCsv() {
  if (!ADMIN_ORDERS.length) {
    showMessage('No orders loaded to export.', true);
    return;
  }

  const rows = [
    ['Order ID', 'Customer', 'Email', 'Total', 'Payment', 'Fulfillment', 'Logistics', 'Created At'],
    ...ADMIN_ORDERS.map(order => [
      order.id,
      `${order.customer.firstName || ''} ${order.customer.lastName || ''}`.trim(),
      order.customer.email || '',
      order.total,
      order.paymentStatus,
      order.fulfillmentStatus,
      order.logisticsStatus,
      order.createdAt
    ])
  ];
  downloadCsv('nika_orders.csv', rows);
}

async function saveOrderStatus(id) {
  const row = document.querySelector(`tr[data-order="${id}"]`);
  await api(`/api/orders/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({
      fulfillmentStatus: row.querySelector('.fulfillment-status').value,
      logisticsStatus: row.querySelector('.logistics-status').value
    })
  });
  showMessage('Order status updated.');
}

async function verifyManualPayment(id) {
  const order = ADMIN_ORDERS.find(item => item.id === id);
  const reference = order?.providerTransactionId || '';
  const confirmed = await showAdminConfirm({
    title: 'Verify UPI payment?',
    body: `Mark order ${id} as paid${reference ? ` using reference ${reference}` : ''}? This will reduce stock and move the order to ready for shipping.`,
    confirmText: 'Verify payment'
  });
  if (!confirmed) return;

  const data = await api(`/api/orders/${id}/payment`, {
    method: 'PATCH',
    body: JSON.stringify({ providerTransactionId: reference })
  });
  showMessage(data.message || 'Payment verified.');
  await loadDashboardData();
  await loadOrders();
}

// --- Inventory Logic ---
// --- Client-Side Search Filtering ---
function filterInventoryTable() {
  updateInventoryFilters();
}

// --- Bulk CSV Logic ---
function downloadCSVTemplate() {
  const headers = "Name,Category,Price,Stock,Image,Description\n";
  const sampleData = "Blue Ocean Resin Art,Resin,1299,5,https://res.cloudinary.com/demo/image/upload/sample.jpg,Hand poured resin on wood\nCrochet Sunflower,Crochet,449,15,,Handmade yarn flower";
  
  const blob = new Blob([headers + sampleData], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('hidden', '');
  a.setAttribute('href', url);
  a.setAttribute('download', 'nika_bulk_template.csv');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('hidden', '');
  a.setAttribute('href', url);
  a.setAttribute('download', filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

async function loadStorageStatus() {
  const el = document.getElementById('storage-status');
  if (!el) return;

  try {
    const data = await api('/api/products/storage/status');
    el.textContent = data.cloudinaryConfigured
      ? `Cloudinary active. Uploads go to ${data.folder}.`
      : 'Local fallback active. Add Cloudinary credentials in .env to store images in the cloud.';
  } catch (err) {
    el.textContent = err.message;
  }
}

async function handleBulkImages(event) {
  const files = Array.from(event.target.files || []);
  const resultsEl = document.getElementById('bulk-image-results');
  if (!files.length) return;
  if (files.length > 30) {
    showMessage('Upload up to 30 images at a time.', true);
    event.target.value = '';
    return;
  }

  try {
    showMessage(`Uploading ${files.length} image(s)...`);
    const payload = [];
    for (const file of files) {
      payload.push({ name: file.name.replace(/\.[^.]+$/, ''), imageData: await readFileAsDataUrl(file) });
    }

    const data = await api('/api/products/images/bulk', {
      method: 'POST',
      body: JSON.stringify({ files: payload })
    });

    resultsEl.innerHTML = `
      <h4>Uploaded images</h4>
      ${data.uploaded.map(item => `
        <div class="bulk-image-row">
          <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.name)}" />
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <input readonly value="${escapeHtml(item.url)}" onclick="this.select()" />
            <small>${escapeHtml(item.provider)}${item.publicId ? ` - ${escapeHtml(item.publicId)}` : ''}</small>
          </div>
        </div>
      `).join('')}
    `;
    showMessage(`Uploaded ${data.uploaded.length} image(s). Paste a URL into a product image field or upload directly on a product row.`);
  } catch (err) {
    showMessage(err.message, true);
  }
  event.target.value = '';
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

async function handleBulkCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const text = e.target.result;
      const rows = parseCsv(text);
      
      const headers = rows[0].map(header => header.trim().toLowerCase());
      const indexOf = (...names) => names.map(name => headers.indexOf(name)).find(index => index >= 0);
      const nameIndex = indexOf('name', 'product name') ?? 0;
      const categoryIndex = indexOf('category') ?? 1;
      const priceIndex = indexOf('price') ?? 2;
      const stockIndex = indexOf('stock', 'quantity') ?? 3;
      const imageIndex = indexOf('image', 'image url', 'image_url');
      const descriptionIndex = indexOf('description', 'desc') ?? (imageIndex === 4 ? 5 : 4);

      // Skip header row (index 0) and filter out empty rows
      const products = rows.slice(1).filter(row => row.length >= 4 && row[nameIndex] !== '').map(row => ({
        name: row[nameIndex],
        category: row[categoryIndex],
        price: parseInt(row[priceIndex], 10) || 0,
        stock: parseInt(row[stockIndex], 10) || 0,
        image: imageIndex === undefined ? '' : row[imageIndex] || '',
        description: row[descriptionIndex] || ''
      }));

      if (products.length === 0) throw new Error("No valid products found in CSV.");

      showMessage(`Processing ${products.length} products... please wait.`);
      
      const data = await api('/api/products/bulk', { 
        method: 'POST', 
        body: JSON.stringify({ products }) 
      });
      
      showMessage(data.message);
      await loadCategoriesAdmin();
      await loadProductsAdmin();
    } catch (err) {
      showMessage(`CSV Error: ${err.message}`, true);
    }
    // Reset file input so you can upload the same file again if needed
    event.target.value = ''; 
  };
  
  reader.readAsText(file);
}

function categoryOptions(selected = '') {
  return ADMIN_CATEGORIES.map(category => `<option value="${escapeHtml(category.name)}" ${category.name === selected ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('');
}

function categoryFilterOptions() {
  return ADMIN_CATEGORIES.map(category => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`).join('');
}

function stockBadge(product) {
  if (product.stock <= 0) return '<span class="inventory-badge danger">Out</span>';
  if (product.stock <= 3) return '<span class="inventory-badge warn">Low</span>';
  return '<span class="inventory-badge ok">In stock</span>';
}

function statusBadge(product) {
  return product.isActive
    ? '<span class="inventory-badge ok">Live</span>'
    : '<span class="inventory-badge muted">Hidden</span>';
}

function productMatchesInventoryFilters(product) {
  const query = INVENTORY_STATE.query;
  const matchesQuery = !query || `${product.name} ${product.category} ${product.description || ''}`.toLowerCase().includes(query);
  const matchesCategory = !INVENTORY_STATE.category || product.category === INVENTORY_STATE.category;
  const matchesStatus = INVENTORY_STATE.status === 'all'
    || (INVENTORY_STATE.status === 'active' && product.isActive)
    || (INVENTORY_STATE.status === 'hidden' && !product.isActive)
    || (INVENTORY_STATE.status === 'low' && product.stock > 0 && product.stock <= 3)
    || (INVENTORY_STATE.status === 'out' && product.stock <= 0);

  return matchesQuery && matchesCategory && matchesStatus;
}

function sortInventoryProducts(products) {
  return [...products].sort((a, b) => {
    if (INVENTORY_STATE.sort === 'name') return a.name.localeCompare(b.name);
    if (INVENTORY_STATE.sort === 'stock-low') return a.stock - b.stock || a.name.localeCompare(b.name);
    if (INVENTORY_STATE.sort === 'price-high') return b.price - a.price || a.name.localeCompare(b.name);
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
}

function renderInventorySummary() {
  const el = document.getElementById('inventory-summary');
  if (!el) return;
  const total = ADMIN_PRODUCTS.length;
  const live = ADMIN_PRODUCTS.filter(product => product.isActive).length;
  const hidden = total - live;
  const low = ADMIN_PRODUCTS.filter(product => product.stock > 0 && product.stock <= 3).length;
  const out = ADMIN_PRODUCTS.filter(product => product.stock <= 0).length;

  el.innerHTML = `
    <div><span>Total products</span><strong>${total}</strong></div>
    <div><span>Live</span><strong>${live}</strong></div>
    <div><span>Hidden</span><strong>${hidden}</strong></div>
    <div><span>Low stock</span><strong>${low}</strong></div>
    <div><span>Out of stock</span><strong>${out}</strong></div>
  `;
}

function renderInventoryFilters() {
  const categoryFilter = document.getElementById('inventory-category-filter');
  if (categoryFilter) {
    categoryFilter.innerHTML = `<option value="">All categories</option>${categoryFilterOptions()}`;
    categoryFilter.value = INVENTORY_STATE.category;
  }
}

function renderInventoryTable() {
  const body = document.getElementById('products-body');
  if (!body) return;

  const filtered = sortInventoryProducts(ADMIN_PRODUCTS.filter(productMatchesInventoryFilters));
  INVENTORY_STATE.filtered = filtered;

  const totalPages = Math.max(1, Math.ceil(filtered.length / INVENTORY_STATE.pageSize));
  if (INVENTORY_STATE.page > totalPages) INVENTORY_STATE.page = totalPages;

  const start = (INVENTORY_STATE.page - 1) * INVENTORY_STATE.pageSize;
  const pageProducts = filtered.slice(start, start + INVENTORY_STATE.pageSize);

  body.innerHTML = pageProducts.map(product => `
    <tr data-id="${product.id}">
      <td>
        ${product.image
          ? `<img class="admin-product-photo compact" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" />`
          : `<div class="admin-product-photo compact empty">No photo</div>`}
      </td>
      <td>
        <strong class="product-row-name">${escapeHtml(product.name)}</strong>
        <small>${escapeHtml(product.description || 'No description')}</small>
      </td>
      <td>${escapeHtml(product.category)}</td>
      <td>${rupees(product.price)}</td>
      <td><strong>${product.stock}</strong> ${stockBadge(product)}</td>
      <td>${statusBadge(product)}</td>
      <td class="inventory-row-actions">
        <button class="btn-outline small-btn" onclick="openProductEditor('${product.id}')">Edit</button>
        <button class="btn-outline small-btn" onclick="hideProduct('${product.id}')">Hide</button>
        <button class="btn-outline danger small-btn remove-product-btn" onclick="removeProduct('${product.id}')">Remove</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="7" class="inventory-empty">No products match these filters.</td></tr>`;

  const pageInfo = document.getElementById('inventory-page-info');
  const prevBtn = document.getElementById('inventory-prev');
  const nextBtn = document.getElementById('inventory-next');
  if (pageInfo) {
    const shownStart = filtered.length ? start + 1 : 0;
    const shownEnd = Math.min(start + INVENTORY_STATE.pageSize, filtered.length);
    pageInfo.textContent = `Showing ${shownStart}-${shownEnd} of ${filtered.length}`;
  }
  if (prevBtn) prevBtn.disabled = INVENTORY_STATE.page <= 1;
  if (nextBtn) nextBtn.disabled = INVENTORY_STATE.page >= totalPages;
}

function updateInventoryFilters() {
  INVENTORY_STATE.query = (document.getElementById('inventory-search')?.value || '').trim().toLowerCase();
  INVENTORY_STATE.category = document.getElementById('inventory-category-filter')?.value || '';
  INVENTORY_STATE.status = document.getElementById('inventory-status-filter')?.value || 'all';
  INVENTORY_STATE.sort = document.getElementById('inventory-sort')?.value || 'newest';
  INVENTORY_STATE.page = 1;
  renderInventoryTable();
}

function changeInventoryPage(delta) {
  INVENTORY_STATE.page += delta;
  renderInventoryTable();
}

function showAddProductPanel() {
  const panel = document.getElementById('add-single-product-panel');
  if (panel) panel.hidden = false;
}

function hideAddProductPanel() {
  const panel = document.getElementById('add-single-product-panel');
  if (panel) panel.hidden = true;
}

async function loadCategoriesAdmin() {
  const data = await api('/api/categories?includeInactive=true');
  ADMIN_CATEGORIES = data.categories.filter(category => category.isActive);
  const catSelect = document.getElementById('new-category');
  if (catSelect) catSelect.innerHTML = `<option value="">Select category</option>${categoryOptions()}`;
  renderInventoryFilters();
}

async function loadProductsAdmin() {
  const data = await api('/api/products?includeInactive=true');
  ADMIN_PRODUCTS = data.products;
  renderInventorySummary();
  renderInventoryTable();
}

function exportProductsCsv() {
  if (!ADMIN_PRODUCTS.length) {
    showMessage('No products loaded to export.', true);
    return;
  }
  const rows = [
    ['ID', 'Name', 'Category', 'Price', 'Stock', 'Active', 'Image', 'Description'],
    ...ADMIN_PRODUCTS.map(product => [
      product.id,
      product.name,
      product.category,
      product.price,
      product.stock,
      product.isActive ? 'yes' : 'no',
      product.image,
      product.description
    ])
  ];
  downloadCsv('nika_products.csv', rows);
}

async function addCategory(event) {
  event.preventDefault();
  try {
    await api('/api/categories', { method: 'POST', body: JSON.stringify({ name: document.getElementById('new-category-name').value }) });
    event.target.reset();
    showMessage('Category added.');
    await loadCategoriesAdmin();
    await loadProductsAdmin(); // Refresh dropdowns
  } catch (err) { showMessage(err.message, true); }
}

async function addProduct(event) {
  event.preventDefault();
  try {
    const selectedCategory = document.getElementById('new-category').value;
    const typedCategory = document.getElementById('new-category-name').value.trim();
    const category = typedCategory || selectedCategory;
    if (!category) throw new Error('Choose or type a category.');

    await api('/api/products', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('new-name').value,
        category,
        price: Number(document.getElementById('new-price').value),
        stock: Number(document.getElementById('new-stock').value),
        description: document.getElementById('new-description').value
      })
    });
    event.target.reset();
    showMessage('Product added.');
    await loadProductsAdmin();
  } catch (err) { showMessage(err.message, true); }
}

function setProductEditorPreview(imageUrl) {
  const preview = document.getElementById('edit-product-image-preview');
  const empty = document.getElementById('edit-product-image-empty');
  if (!preview || !empty) return;

  if (imageUrl) {
    preview.src = imageUrl;
    preview.hidden = false;
    empty.hidden = true;
  } else {
    preview.removeAttribute('src');
    preview.hidden = true;
    empty.hidden = false;
  }
}

function openProductEditor(id) {
  const product = ADMIN_PRODUCTS.find(item => item.id === id);
  if (!product) return showMessage('Product not found in the current inventory list.', true);

  document.getElementById('edit-product-id').value = product.id;
  document.getElementById('edit-product-name').value = product.name;
  document.getElementById('edit-product-category').innerHTML = categoryOptions(product.category);
  document.getElementById('edit-product-description').value = product.description || '';
  document.getElementById('edit-product-price').value = product.price;
  document.getElementById('edit-product-stock').value = product.stock;
  document.getElementById('edit-product-active').value = String(Boolean(product.isActive));
  document.getElementById('edit-product-image-url').value = product.image || '';
  document.getElementById('edit-product-image-file').value = '';
  setProductEditorPreview(product.image);

  const modal = document.getElementById('product-editor-modal');
  if (modal) modal.hidden = false;
}

function closeProductEditor() {
  const modal = document.getElementById('product-editor-modal');
  if (modal) modal.hidden = true;
}

async function saveProductFromEditor(event) {
  event.preventDefault();
  const id = document.getElementById('edit-product-id').value;
  const imageFile = document.getElementById('edit-product-image-file').files[0];

  await api(`/api/products/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: document.getElementById('edit-product-name').value,
      category: document.getElementById('edit-product-category').value,
      description: document.getElementById('edit-product-description').value,
      price: Number(document.getElementById('edit-product-price').value),
      stock: Number(document.getElementById('edit-product-stock').value),
      isActive: document.getElementById('edit-product-active').value === 'true',
      image: document.getElementById('edit-product-image-url').value
    })
  });

  if (imageFile) {
    const imageData = await readFileAsDataUrl(imageFile);
    await api(`/api/products/${id}/image`, { method: 'POST', body: JSON.stringify({ imageData }) });
  }

  showMessage('Product updated.');
  closeProductEditor();
  await loadProductsAdmin();
}

async function hideProduct(id) {
  await api(`/api/products/${id}`, { method: 'DELETE' });
  showMessage('Product hidden from storefront.');
  await loadProductsAdmin();
}

async function removeProduct(id) {
  const row = document.querySelector(`tr[data-id="${id}"]`);
  const product = ADMIN_PRODUCTS.find(item => item.id === id);
  const name = product?.name || row?.querySelector('.product-row-name')?.textContent || 'this product';
  const removeButton = row?.querySelector('.remove-product-btn');
  const confirmed = await showAdminConfirm({
    title: 'Remove product?',
    body: `Permanently remove "${name}"? Use this only for duplicate or accidental uploads. This cannot be undone.`,
    confirmText: 'Remove'
  });
  if (!confirmed) return;

  try {
    if (removeButton) {
      removeButton.disabled = true;
      removeButton.textContent = 'Removing...';
    }
    showMessage(`Removing ${name}...`);
    const data = await api(`/api/products/permanent/${id}`, { method: 'DELETE' });
    const cleanupNote = data.imageCleanup?.error ? ' Image cleanup needs manual review.' : '';
    showMessage(`${data.message || 'Product removed.'}${cleanupNote}`);
    row?.remove();
    await loadProductsAdmin();
  } catch (err) {
    showMessage(err.message, true);
    if (removeButton) {
      removeButton.disabled = false;
      removeButton.textContent = 'Remove';
    }
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

async function uploadProductImage(id) {
  try {
    const file = document.getElementById('edit-product-image-file')?.files[0]
      || document.querySelector(`tr[data-id="${id}"] .admin-photo-input`)?.files[0];
    if (!file) throw new Error('Choose a product photo first.');
    const imageData = await readFileAsDataUrl(file);
    await api(`/api/products/${id}/image`, { method: 'POST', body: JSON.stringify({ imageData }) });
    showMessage('Product photo updated.');
    await loadProductsAdmin();
  } catch (err) { showMessage(err.message, true); }
}

// --- CMS Logic ---
async function loadSiteContent() {
  try {
    const res = await fetch('/api/content'); 
    const data = await res.json();
    if (data.success && data.content) {
      currentSiteContent = data.content;
      const assets = currentSiteContent.assets || {};
      document.getElementById('edit-hero-eyebrow').value = currentSiteContent.hero.eyebrow || '';
      document.getElementById('edit-hero-title').value = currentSiteContent.hero.title || '';
      document.getElementById('edit-hero-subtitle').value = currentSiteContent.hero.subtitle || '';
      document.getElementById('edit-about-eyebrow').value = currentSiteContent.about.eyebrow || '';
      document.getElementById('edit-about-title').value = currentSiteContent.about.title || '';
      document.getElementById('edit-about-p1').value = currentSiteContent.about.paragraph1 || '';
      document.getElementById('edit-about-p2').value = currentSiteContent.about.paragraph2 || '';
      document.getElementById('edit-contact-email').value = currentSiteContent.contact.email || '';
      document.getElementById('edit-contact-phone-display').value = currentSiteContent.contact.phoneDisplay || '';
      document.getElementById('edit-contact-phone-link').value = currentSiteContent.contact.phoneLink || '';
      setAssetPreview('cms-logo-preview', assets.logoImage);
      setAssetPreview('cms-hero-preview', assets.heroImage);
      setAssetPreview('cms-artist-preview', assets.artistImage);
    }
  } catch (err) { console.warn("Could not load site content", err); }
}

function setAssetPreview(elementId, src) {
  const preview = document.getElementById(elementId);
  if (!preview) return;
  if (src) {
    preview.src = src;
    preview.style.display = '';
  } else {
    preview.removeAttribute('src');
    preview.style.display = 'none';
  }
}

async function uploadSiteAsset(assetKey, inputId) {
  try {
    const input = document.getElementById(inputId);
    const file = input?.files?.[0];
    if (!file) throw new Error('Choose an image first.');

    const imageData = await readFileAsDataUrl(file);
    const data = await api(`/api/content/assets/${assetKey}`, {
      method: 'POST',
      body: JSON.stringify({ imageData })
    });

    currentSiteContent = data.content;
    input.value = '';
    await loadSiteContent();
    showMessage('Website image uploaded to Cloudinary.');
  } catch (err) {
    showMessage(err.message, true);
  }
}

async function saveCms(event) {
  event.preventDefault();
  const updatedContent = {
    hero: { eyebrow: document.getElementById('edit-hero-eyebrow').value, title: document.getElementById('edit-hero-title').value, subtitle: document.getElementById('edit-hero-subtitle').value },
    about: { eyebrow: document.getElementById('edit-about-eyebrow').value, title: document.getElementById('edit-about-title').value, paragraph1: document.getElementById('edit-about-p1').value, paragraph2: document.getElementById('edit-about-p2').value },
    contact: { email: document.getElementById('edit-contact-email').value, phoneDisplay: document.getElementById('edit-contact-phone-display').value, phoneLink: document.getElementById('edit-contact-phone-link').value, description: currentSiteContent.contact?.description, title: currentSiteContent.contact?.title },
    assets: currentSiteContent.assets || {}
  };
  try {
    await api('/api/content', { method: 'PUT', body: JSON.stringify({ content: updatedContent }) });
    showMessage('Site content saved! Your storefront is updated.');
  } catch (err) { showMessage(err.message, true); }
}

async function changeAdminPassword(event) {
  event.preventDefault();

  const currentPasswordInput = document.getElementById('admin-current-password');
  const newPasswordInput = document.getElementById('admin-new-password');
  const confirmPasswordInput = document.getElementById('admin-confirm-password');

  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  try {
    if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
    if (newPassword !== confirmPassword) throw new Error('New passwords do not match.');

    await api('/api/auth/admin/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });

    currentPasswordInput.value = '';
    newPasswordInput.value = '';
    confirmPasswordInput.value = '';
    showMessage('Admin password updated. Other admin sessions were signed out.');
  } catch (err) {
    showMessage(err.message, true);
  }
}

// Initialization check
checkAdminSession();
