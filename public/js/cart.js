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

function calculateCartTotals(cart) {
  const subtotal = (cart || []).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
  const shippingConfig = getShippingConfig();
  const shipping = subtotal >= shippingConfig.freeShippingMinimum ? 0 : shippingConfig.fee;
  return {
    subtotal,
    shipping,
    total: subtotal + shipping,
    freeShippingMinimum: shippingConfig.freeShippingMinimum
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

// Generates the HTML for individual products (with our premium animations!)
// Inside public/js/cart.js
function productCard(product) {
  const imgSrc = product.image || 'https://via.placeholder.com/300?text=Art';
  const safeName = escapeHtml(product.name);
  const safeCategory = escapeHtml(product.category);
  const safeImage = escapeHtml(imgSrc);
  const safeDescription = escapeHtml(product.description || '');
  const isOut = Number(product.stock || 0) <= 0;
  return `
    <div class="product-card reveal">
      <a href="product.html?id=${encodeURIComponent(product.id)}" class="product-image-link" aria-label="View ${safeName}">
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
      <div class="product-card-actions">
        <a class="btn-outline" href="product.html?id=${encodeURIComponent(product.id)}">View</a>
        <button class="btn-primary" ${isOut ? 'disabled' : ''} onclick="addToCart({id: '${escapeJsString(product.id)}', name: '${escapeJsString(product.name)}', price: ${Number(product.price)}, image: '${escapeJsString(product.image)}', stock: ${Number(product.stock)}})">
          ${isOut ? 'Out of stock' : 'Add to cart'}
        </button>
      </div>
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
      if (!latest || !latest.isActive || latest.stock <= 0) return null;
      return {
        id: latest.id,
        name: latest.name,
        price: latest.price,
        image: latest.image,
        stock: latest.stock,
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
  const existing = cart.find(item => item.id === product.id);
  
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
    cart.push({ ...product, qty: 1 });
  }
  
  saveCart(cart);
  // Replaced the alert() with our new sleek floater!
  showToast(`${product.name} added to cart!`);
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
        <a href="products.html" class="btn-primary">Continue Shopping</a>
      </div>
    `;
    return;
  }

  let subtotal = 0;
  const itemsHtml = cart.map(item => {
    const itemTotal = item.price * item.qty;
    subtotal += itemTotal;
    const imgSrc = item.image || 'https://via.placeholder.com/90?text=Art';
    
    return `
      <div class="cart-item">
        <img src="${imgSrc}" alt="${item.name}">
        <div class="cart-item-details">
          <h4 class="cart-item-title">${item.name}</h4>
          <p style="margin: 0; color: #666;">${rupees(item.price)} each</p>
          <button class="remove-btn" onclick="removeFromCart('${item.id}')">Remove</button>
        </div>
        <div style="text-align: right; min-width: 100px;">
          <p style="font-weight: 600; margin: 0; font-size: 1.1rem;">${rupees(itemTotal)}</p>
          <div class="qty-controls">
            <button class="qty-btn" onclick="changeQty('${item.id}', -1)">-</button>
            <span style="min-width: 20px; text-align: center;">${item.qty}</span>
            <button class="qty-btn" onclick="changeQty('${item.id}', 1)">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const { shipping, total } = calculateCartTotals(cart);

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
        <span>Subtotal</span>
        <span style="font-weight: 500;">${rupees(subtotal)}</span>
      </div>
      <div class="summary-row">
        <span>Shipping</span>
        <span style="font-weight: 500;">${shipping === 0 ? 'Free' : rupees(shipping)}</span>
      </div>
      <p class="cart-note">${shippingPolicyText()}</p>
      <div class="summary-row summary-total">
        <span>Total</span>
        <span>${rupees(total)}</span>
      </div>

      <a href="checkout.html" class="btn-primary" style="width: 100%; margin-top: 1rem; text-align: center;" id="checkout-btn">
        Proceed to Secure Checkout
      </a>

      <div class="trust-badge">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        <span>Payments are secure and encrypted</span>
      </div>
    </div>
  `;
}

function changeQty(id, delta) {
  const cart = getCart();
  const item = cart.find(i => i.id === id);
  if (item) {
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

function removeFromCart(id) {
  let cart = getCart();
  cart = cart.filter(item => item.id !== id);
  saveCart(cart);
  renderCartPage();
}

async function processCheckout(event) {
  event.preventDefault();
  window.location.href = 'checkout.html';
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
  initShopPage();    // Draws the shop grid if we are on products.html
});
