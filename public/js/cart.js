// public/js/cart.js

// ==========================================
// 1. STOREFRONT LOGIC (The missing piece!)
// ==========================================
let PRODUCTS = [];
let CATEGORIES = [];
let STORE_CONFIG = null;

async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    if (data.success) {
      // Only show active products to customers
      PRODUCTS = data.products.filter(p => p.isActive); 
    }
  } catch (err) {
    console.error("Failed to load products:", err);
  }
}

async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    const data = await res.json();
    CATEGORIES = data.success ? data.categories.filter(c => c.isActive) : [];
  } catch (err) {
    console.error("Failed to load categories:", err);
    CATEGORIES = [];
  }
}

async function loadStoreConfig() {
  if (STORE_CONFIG) return STORE_CONFIG;
  try {
    const res = await fetch('/api/config/store');
    const data = await res.json();
    if (data.success) {
      STORE_CONFIG = data.config;
    }
  } catch (err) {
    console.error("Failed to load store config:", err);
  }
  return STORE_CONFIG;
}

function getShippingConfig() {
  return STORE_CONFIG?.shipping || { fee: 0, freeShippingMinimum: Number.POSITIVE_INFINITY };
}

function prebookAdvanceAmount(price, qty = 1) {
  return Math.ceil(Number(price || 0) * Number(qty || 1) * 0.5);
}

function isPrebookCart(cart) {
  return (cart || []).some(item => item.prebook === true || item.orderType === 'PREBOOK');
}

function calculateCartTotals(cart) {
  const prebook = isPrebookCart(cart);
  const fullSubtotal = (cart || []).reduce((sum, item) => {
    const itemPrice = item.prebook ? Number(item.fullPrice || item.price || 0) : Number(item.price || 0);
    return sum + itemPrice * Number(item.qty || 0);
  }, 0);
  const payableSubtotal = (cart || []).reduce((sum, item) => {
    if (item.prebook) return sum + prebookAdvanceAmount(item.fullPrice || item.price, item.qty);
    return sum + Number(item.price || 0) * Number(item.qty || 0);
  }, 0);
  const shippingConfig = getShippingConfig();
  const shipping = fullSubtotal >= shippingConfig.freeShippingMinimum ? 0 : shippingConfig.fee;
  const fullTotal = fullSubtotal + shipping;
  const total = prebook ? payableSubtotal : fullTotal;
  return {
    subtotal: payableSubtotal,
    fullSubtotal,
    shipping,
    total,
    fullTotal,
    advanceDue: prebook ? payableSubtotal : 0,
    balanceDue: prebook ? fullTotal - payableSubtotal : 0,
    freeShippingMinimum: shippingConfig.freeShippingMinimum,
    prebook
  };
}

function shippingPolicyText() {
  const { fee, freeShippingMinimum } = getShippingConfig();
  if (!Number.isFinite(freeShippingMinimum) || !fee) return 'Shipping is calculated securely at checkout.';
  return `Free shipping on orders ${rupees(freeShippingMinimum)} and above. Orders below ${rupees(freeShippingMinimum)} have a ${rupees(fee)} shipping fee.`;
}

function rupees(value) {
  return '₹' + Number(value || 0).toLocaleString('en-IN');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function escapeJsString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function normalizeColorOptions(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,\n|]/);
  const seen = new Set();
  return raw
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .filter(item => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function cartItemKey(productId, color = '') {
  return `${productId}::${String(color || '').trim().toLowerCase()}`;
}

function selectedColorFromControl(productId) {
  return document.getElementById(`product-color-${productId}`)?.value || '';
}

function productColorSelector(product) {
  const colors = normalizeColorOptions(product.colorOptions);
  if (!colors.length) return '';
  return `
    <label class="product-color-picker">
      <span>Colour</span>
      <select id="product-color-${escapeHtml(product.id)}" aria-label="Choose colour for ${escapeHtml(product.name)}">
        ${colors.map(color => `<option value="${escapeHtml(color)}">${escapeHtml(color)}</option>`).join('')}
      </select>
    </label>
  `;
}

function withSelectedColor(product, selectedColor = '') {
  const colors = normalizeColorOptions(product.colorOptions);
  const color = colors.length ? (selectedColor || colors[0] || '') : '';
  return {
    ...product,
    colorOptions: colors,
    selectedColor: color,
    color,
    cartKey: cartItemKey(product.id, color)
  };
}

function addProductCardToCart(productId, prebook = false) {
  const product = PRODUCTS.find(item => item.id === productId);
  if (!product) {
    showToast('Product is unavailable. Please refresh the page.', true);
    return;
  }
  const selectedColor = selectedColorFromControl(productId);
  const cartProduct = withSelectedColor(product, selectedColor);
  if (normalizeColorOptions(product.colorOptions).length && !cartProduct.selectedColor) {
    showToast(`Please choose a colour for ${product.name}.`, true);
    return;
  }
  if (prebook) addPrebookToCart(cartProduct);
  else addToCart(cartProduct);
}

// Generates the HTML for individual products (with our premium animations!)
// Inside public/js/cart.js
function productCard(product) {
  const imgSrc = product.image || 'https://via.placeholder.com/300?text=Art';
  const safeName = escapeHtml(product.name);
  const safeCategory = escapeHtml(product.category);
  const safeImage = escapeHtml(imgSrc);
  const safeDescription = escapeHtml(product.description || '');
  const isOut = Number(product.stock || 0) <= 0;
  const advance = prebookAdvanceAmount(product.price);
  const colors = normalizeColorOptions(product.colorOptions);
  return `
    <div class="product-card reveal">
      <a href="/product?id=${encodeURIComponent(product.id)}" class="product-image-link" aria-label="View ${safeName}">
        <img src="${safeImage}" alt="${safeName}" class="product-img" loading="lazy">
      </a>
      <div class="product-card-meta">
        <div>
          <h3 style="margin: 0 0 0.2rem 0; font-family: var(--font-heading); font-size: 1.2rem;">${safeName}</h3>
          <p style="color: #666; margin: 0 0 0.5rem 0; font-size: 0.9rem;">${safeCategory}</p>
        </div>
        <p style="font-weight: 600; margin: 0;">${rupees(product.price)}</p>
      </div>
      ${safeDescription ? `<p class="product-card-desc">${safeDescription}</p>` : ''}
      ${colors.length ? productColorSelector(product) : ''}
      <div class="product-card-actions">
        <a class="btn-outline" href="/product?id=${encodeURIComponent(product.id)}">View</a>
        <button class="btn-primary" onclick="addProductCardToCart('${escapeJsString(product.id)}', ${isOut ? 'true' : 'false'})">
          ${isOut ? `Pre-book ${rupees(advance)}` : 'Add to cart'}
        </button>
      </div>
      ${isOut ? '<p class="prebook-note">Out of stock. Reserve now with 50% advance.</p>' : ''}
    </div>
  `;
}

// ==========================================
// 2. CORE CART LOGIC
// ==========================================
function getCart() {
  return JSON.parse(localStorage.getItem('nika_cart')) || [];
}

function saveCart(cart) {
  localStorage.setItem('nika_cart', JSON.stringify(cart));
  updateCartCount();
}

function syncCartWithProducts() {
  if (!Array.isArray(PRODUCTS) || PRODUCTS.length === 0) return getCart();

  const synced = getCart()
    .map(item => {
      const latest = PRODUCTS.find(product => product.id === item.id);
      if (!latest || !latest.isActive) return null;
      const colors = normalizeColorOptions(latest.colorOptions);
      const selectedColor = colors.length
        ? (colors.find(color => color.toLowerCase() === String(item.selectedColor || item.color || '').trim().toLowerCase()) || colors[0])
        : '';
      if (item.prebook) {
        if (latest.stock > 0) return null;
        return {
          id: latest.id,
          cartKey: cartItemKey(latest.id, selectedColor),
          name: latest.name,
          price: prebookAdvanceAmount(latest.price),
          fullPrice: latest.price,
          image: latest.image,
          stock: latest.stock,
          colorOptions: colors,
          selectedColor,
          color: selectedColor,
          qty: 1,
          prebook: true,
          orderType: 'PREBOOK'
        };
      }
      if (latest.stock <= 0) return null;
      return {
        id: latest.id,
        cartKey: cartItemKey(latest.id, selectedColor),
        name: latest.name,
        price: latest.price,
        image: latest.image,
        stock: latest.stock,
        colorOptions: colors,
        selectedColor,
        color: selectedColor,
        qty: Math.min(Number(item.qty) || 1, latest.stock)
      };
    })
    .filter(Boolean);

  saveCart(synced);
  return synced;
}

function updateCartCount() {
  const cart = getCart();
  const count = cart.reduce((total, item) => total + item.qty, 0);
  const countEl = document.getElementById('cart-count');
  if (countEl) countEl.textContent = count;
}

function addToCart(product) {
  const cart = getCart();
  if (isPrebookCart(cart)) {
    showToast('Please checkout or remove your pre-book before adding in-stock products.', true);
    return;
  }
  const colorAwareProduct = withSelectedColor(product, product.selectedColor || product.color);
  const key = colorAwareProduct.cartKey;
  const existing = cart.find(item => (item.cartKey || cartItemKey(item.id, item.selectedColor || item.color)) === key);
  
  if (existing) {
    if (existing.qty < product.stock) {
      existing.qty += 1;
    } else {
      showToast(`Sorry, only ${product.stock} left in stock!`, true);
      return;
    }
  } else {
    if (product.stock <= 0) {
      showToast("Sorry, this item is currently out of stock!", true);
      return;
    }
    cart.push({ ...colorAwareProduct, qty: 1 });
  }
  
  saveCart(cart);
  // Replaced the alert() with our new sleek floater!
  showToast(`${product.name}${colorAwareProduct.selectedColor ? ` - ${colorAwareProduct.selectedColor}` : ''} added to cart!`);
}

function addPrebookToCart(product) {
  const cart = getCart();
  if (cart.length && !isPrebookCart(cart)) {
    showToast('Pre-book products must be checked out separately. Please clear your cart first.', true);
    return;
  }
  const colorAwareProduct = withSelectedColor(product, product.selectedColor || product.color);
  if (cart.length && (cart[0].cartKey || cartItemKey(cart[0].id, cart[0].selectedColor || cart[0].color)) !== colorAwareProduct.cartKey) {
    showToast('Please checkout or remove your current pre-book before selecting another.', true);
    return;
  }
  const advance = prebookAdvanceAmount(product.price);
  saveCart([{
    id: product.id,
    cartKey: colorAwareProduct.cartKey,
    name: product.name,
    price: advance,
    fullPrice: Number(product.price),
    image: product.image,
    stock: Number(product.stock || 0),
    colorOptions: colorAwareProduct.colorOptions,
    selectedColor: colorAwareProduct.selectedColor,
    color: colorAwareProduct.selectedColor,
    qty: 1,
    prebook: true,
    orderType: 'PREBOOK'
  }]);
  showToast(`${product.name}${colorAwareProduct.selectedColor ? ` - ${colorAwareProduct.selectedColor}` : ''} reserved for pre-book. Advance due: ${rupees(advance)}.`);
}

// --- Premium Toast Notification System ---
function showToast(message, isError = false) {
  // 1. Create the container if it doesn't exist yet
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  // 2. Create the toast card
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  
  // Optional: Make error messages (like out-of-stock) red
  if (isError) {
    toast.style.backgroundColor = '#dc3545';
  }

  container.appendChild(toast);

  // 3. Automatically remove it from the DOM after the 3-second CSS animation finishes
  setTimeout(() => {
    toast.remove();
    if (container.childNodes.length === 0) {
      container.remove();
    }
  }, 3000); 
}


// ==========================================
// 3. CART PAGE RENDERING & CHECKOUT
// ==========================================
function renderCartPage() {
  const main = document.getElementById('cart-main');
  if (!main) return; 

  const cart = getCart();
  
  if (cart.length === 0) {
    main.innerHTML = `
      <div class="empty-cart-msg">
        <h2>Your cart is empty</h2>
        <p>Looks like you haven't added any art to your cart yet.</p>
        <br>
        <a href="/shop" class="btn-primary">Continue Shopping</a>
      </div>
    `;
    return;
  }

  let subtotal = 0;
  const itemsHtml = cart.map(item => {
    const itemTotal = item.price * item.qty;
    subtotal += itemTotal;
    const imgSrc = item.image || 'https://via.placeholder.com/90?text=Art';
    const key = item.cartKey || cartItemKey(item.id, item.selectedColor || item.color);
    const colorLine = item.selectedColor || item.color
      ? `<p class="cart-item-option">Colour: ${escapeHtml(item.selectedColor || item.color)}</p>`
      : '';
    
    return `
      <div class="cart-item">
        <img src="${imgSrc}" alt="${item.name}">
        <div class="cart-item-details">
          <h4 class="cart-item-title">${item.name}</h4>
          ${colorLine}
          <p style="margin: 0; color: #666;">${item.prebook ? `${rupees(item.fullPrice)} full price | ${rupees(item.price)} advance` : `${rupees(item.price)} each`}</p>
          ${item.prebook ? '<p class="cart-note prebook-inline-note">Pre-book item. Balance is requested after stock is ready.</p>' : ''}
          <button class="remove-btn" onclick="removeFromCart('${escapeJsString(key)}')">Remove</button>
        </div>
        <div style="text-align: right; min-width: 100px;">
          <p style="font-weight: 600; margin: 0; font-size: 1.1rem;">${rupees(itemTotal)}</p>
          <div class="qty-controls">
            <button class="qty-btn" onclick="changeQty('${escapeJsString(key)}', -1)">-</button>
            <span style="min-width: 20px; text-align: center;">${item.qty}</span>
            <button class="qty-btn" ${item.prebook ? 'disabled' : ''} onclick="changeQty('${escapeJsString(key)}', 1)">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const { shipping, total, fullSubtotal, fullTotal, balanceDue, prebook } = calculateCartTotals(cart);

  main.innerHTML = `
    <div class="cart-items-section">
      <h2 class="section-heading">Your Items</h2>
      <div style="margin-bottom: 3rem;">
        ${itemsHtml}
      </div>

      <p class="cart-note">Shipping details and payment are completed on the secure checkout page.</p>
    </div>
    
    <div class="checkout-section">
      <h2 class="section-heading">Order Summary</h2>
      
      <div class="summary-row">
        <span>${prebook ? 'Advance due today' : 'Subtotal'}</span>
        <span style="font-weight: 500;">${rupees(total)}</span>
      </div>
      ${prebook ? `
        <div class="summary-row"><span>Full product value</span><span style="font-weight: 500;">${rupees(fullSubtotal)}</span></div>
      ` : ''}
      <div class="summary-row">
        <span>Shipping</span>
        <span style="font-weight: 500;">${shipping === 0 ? 'Free' : rupees(shipping)}</span>
      </div>
      <p class="cart-note">${shippingPolicyText()}</p>
      ${prebook ? `<p class="cart-note">Shipping and remaining balance are paid after stock is ready. Balance later: ${rupees(balanceDue)}.</p>` : ''}
      <div class="summary-row summary-total">
        <span>${prebook ? 'Pay now' : 'Total'}</span>
        <span>${rupees(total)}</span>
      </div>

      <a href="/checkout" class="btn-primary" style="width: 100%; margin-top: 1rem; text-align: center;" id="checkout-btn">
        ${prebook ? 'Proceed to Pre-book Checkout' : 'Proceed to Secure Checkout'}
      </a>

      <div class="trust-badge">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        <span>Payments are secure and encrypted</span>
      </div>
    </div>
  `;
}

function changeQty(key, delta) {
  const cart = getCart();
  const item = cart.find(i => (i.cartKey || cartItemKey(i.id, i.selectedColor || i.color)) === key);
  if (item) {
    if (item.prebook && delta > 0) {
      showToast('Pre-book quantity is limited to 1 per checkout.', true);
      return;
    }
    item.qty += delta;
    if (item.qty <= 0) {
      removeFromCart(id);
      return;
    }
    if (item.qty > item.stock) {
      alert(`Sorry, we only have ${item.stock} of ${item.name} in stock.`);
      item.qty = item.stock;
    }
    saveCart(cart);
    renderCartPage();
  }
}

function removeFromCart(key) {
  let cart = getCart();
  cart = cart.filter(item => (item.cartKey || cartItemKey(item.id, item.selectedColor || item.color)) !== key);
  saveCart(cart);
  renderCartPage();
}

async function processCheckout(event) {
  event.preventDefault();
  window.location.href = '/checkout';
}

// ==========================================
// 4. SHOP PAGE RENDERING
// ==========================================
async function initShopPage() {
  // Check if we are actually on the Shop page
  const grid = document.getElementById('products-grid') || document.querySelector('.product-grid:not(#featured-grid)');
  if (!grid) return; 

  // Make sure products are loaded
  if (PRODUCTS.length === 0) {
    await loadProducts();
  }

  // Draw the products
  renderProducts(PRODUCTS, grid);

  // Set up the category filters
  const filtersDiv = document.getElementById('category-filters') || document.querySelector('.category-filters');
  if (filtersDiv) {
    const categories = [...new Set(PRODUCTS.map(p => p.category))];
    filtersDiv.innerHTML = `
      <button class="btn-outline active" style="margin-right: 0.5rem;" onclick="filterCategory('All', this)">All</button>
      ${categories.map(cat => `<button class="btn-outline" style="margin-right: 0.5rem;" onclick="filterCategory('${cat}', this)">${cat}</button>`).join('')}
    `;
  }
}

function renderProducts(productsToDisplay, gridElement) {
  const grid = gridElement || document.getElementById('products-grid') || document.querySelector('.product-grid:not(#featured-grid)');
  if (!grid) return;

  if (productsToDisplay.length === 0) {
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #666; padding: 4rem 0;">No products available.</p>';
  } else {
    grid.innerHTML = productsToDisplay.map(productCard).join('');
  }

  // Re-trigger your premium scroll animations for the newly drawn cards!
  if (window.IntersectionObserver) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('active');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -50px 0px" });

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  }
}

function filterCategory(category, buttonElement) {
  // Update button styles
  const filtersDiv = buttonElement.parentElement;
  filtersDiv.querySelectorAll('button').forEach(btn => {
    btn.classList.remove('active');
    btn.style.backgroundColor = 'transparent';
    btn.style.color = 'var(--text)';
  });
  
  // Make clicked button active
  buttonElement.classList.add('active');
  buttonElement.style.backgroundColor = 'var(--text)';
  buttonElement.style.color = 'var(--surface)';

  // Filter and redraw
  if (category === 'All') {
    renderProducts(PRODUCTS);
  } else {
    const filtered = PRODUCTS.filter(p => p.category === category);
    renderProducts(filtered);
  }
}

// Global listener: runs on every single page load
document.addEventListener('DOMContentLoaded', () => {
  updateCartCount(); // Keeps cart bubble accurate everywhere
  initShopPage();    // Draws the shop grid if we are on /shop
});
