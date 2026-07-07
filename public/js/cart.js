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
  const seen = new Set();
  const raw = Array.isArray(value)
    ? value
    : String(value || '')
        .split(/[\n;]+/)
        .flatMap(part => (part.includes('|') ? [part] : part.split(',')));

  return raw
    .map(item => {
      if (item && typeof item === 'object') {
        return {
          name: String(item.name || item.color || item.label || '').trim(),
          image: String(item.image || item.imageUrl || item.url || '').trim()
        };
      }
      const text = String(item || '').trim();
      const [name, ...imageParts] = text.split('|');
      return { name: String(name || text).trim(), image: imageParts.join('|').trim() };
    })
    .filter(item => item.name)
    .filter(item => {
      const key = item.name.toLowerCase();
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
      <select id="product-color-${escapeHtml(product.id)}" aria-label="Choose colour for ${escapeHtml(product.name)}" onchange="updateProductColorImage(this)">
        ${colors.map(color => `<option value="${escapeHtml(color.name)}" data-image="${escapeHtml(color.image || '')}">${escapeHtml(color.name)}</option>`).join('')}
      </select>
    </label>
  `;
}

function withSelectedColor(product, selectedColor = '') {
  const colors = normalizeColorOptions(product.colorOptions);
  const colorOption = colors.length
    ? (colors.find(item => item.name.toLowerCase() === String(selectedColor || '').trim().toLowerCase()) || colors[0])
    : null;
  const color = colorOption?.name || '';
  return {
    ...product,
    colorOptions: colors,
    selectedColor: color,
    color,
    image: colorOption?.image || defaultProductImage(product),
    cartKey: cartItemKey(product.id, color)
  };
}

function productGallery(product) {
  const seen = new Set();
  const gallery = Array.isArray(product.images) ? product.images : [];
  const urls = gallery
    .map(item => typeof item === 'string' ? item : item?.url || item?.image || item?.imageUrl || '')
    .concat(product.image || '')
    .map(url => String(url || '').trim())
    .filter(Boolean)
    .filter(url => {
      const key = url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return urls.length ? urls : ['https://via.placeholder.com/300?text=Art'];
}

function defaultProductImage(product) {
  const firstColor = normalizeColorOptions(product.colorOptions)[0];
  return firstColor?.image || productGallery(product)[0];
}

function productImageCarousel(product, detailUrl = '') {
  const images = productGallery(product);
  const safeName = escapeHtml(product.name);
  const image = `<img src="${escapeHtml(defaultProductImage(product))}" alt="${safeName}" class="product-img" loading="lazy">`;
  const imageContent = detailUrl
    ? `<a href="${detailUrl}" class="product-image-link" aria-label="View ${safeName}">${image}</a>`
    : image;
  const controls = images.length > 1
    ? `
      <button class="product-gallery-arrow prev" type="button" aria-label="Previous photo" onclick="advanceProductImage(event, '${escapeJsString(product.id)}', -1)">‹</button>
      <button class="product-gallery-arrow next" type="button" aria-label="Next photo" onclick="advanceProductImage(event, '${escapeJsString(product.id)}', 1)">›</button>
      <span class="product-gallery-count">1/${images.length}</span>
    `
    : '';
  return `<div class="product-image-frame" data-product-id="${escapeHtml(product.id)}" data-gallery-index="0">${imageContent}${controls}</div>`;
}

function advanceProductImage(event, productId, delta) {
  event?.preventDefault();
  event?.stopPropagation();
  const product = PRODUCTS.find(item => item.id === productId);
  if (!product) return;
  const images = productGallery(product);
  if (images.length <= 1) return;
  const frame = event?.target?.closest('.product-image-frame') || document.querySelector(`.product-image-frame[data-product-id="${CSS.escape(productId)}"]`);
  if (!frame) return;
  const current = Number(frame.dataset.galleryIndex || 0);
  const next = (current + delta + images.length) % images.length;
  frame.dataset.galleryIndex = String(next);
  const img = frame.querySelector('img');
  if (img) img.src = images[next];
  const count = frame.querySelector('.product-gallery-count');
  if (count) count.textContent = `${next + 1}/${images.length}`;
}

function updateProductColorImage(select) {
  const image = select.selectedOptions?.[0]?.dataset?.image || '';
  if (!image) return;
  const card = select.closest('.product-card');
  const cardImage = card?.querySelector('.product-img');
  if (cardImage) {
    cardImage.src = image;
    const frame = cardImage.closest('.product-image-frame');
    if (frame) frame.dataset.galleryIndex = '0';
    return;
  }
  const detailImage = document.querySelector('.product-detail-media img');
  if (detailImage) detailImage.src = image;
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

function productCategoryUrl(product) {
  const category = String(product.category || '').trim();
  return category ? `/shop?category=${encodeURIComponent(category.toLowerCase())}#products` : '/shop#products';
}

function productDetailUrl(product) {
  const category = String(product.category || '').trim();
  const params = new URLSearchParams({ id: product.id });
  if (category) params.set('category', category.toLowerCase());
  return `/product?${params.toString()}`;
}

// Generates the HTML for individual products (with our premium animations!)
// Inside public/js/cart.js
function productCard(product) {
  const safeName = escapeHtml(product.name);
  const safeCategory = escapeHtml(product.category);
  const safeDescription = escapeHtml(product.description || '');
  const isOut = Number(product.stock || 0) <= 0;
  const advance = prebookAdvanceAmount(product.price);
  const colors = normalizeColorOptions(product.colorOptions);
  const detailUrl = productDetailUrl(product);
  return `
    <div class="product-card reveal">
      ${productImageCarousel(product, detailUrl)}
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
        <a class="btn-outline" href="${detailUrl}">View</a>
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
        ? (colors.find(color => color.name.toLowerCase() === String(item.selectedColor || item.color || '').trim().toLowerCase())?.name || colors[0].name)
        : '';
      const colorImage = colors.find(color => color.name === selectedColor)?.image || defaultProductImage(latest);
      if (item.prebook) {
        if (latest.stock > 0) return null;
        return {
          id: latest.id,
          cartKey: cartItemKey(latest.id, selectedColor),
          name: latest.name,
          price: prebookAdvanceAmount(latest.price),
          fullPrice: latest.price,
          image: colorImage,
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
        image: colorImage,
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
    image: colorAwareProduct.image,
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
      removeFromCart(key);
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

const BOUQUET_BUILDER_STATE = {
  selected: new Map(),
  visualized: false
};

function isForeverFlowerProduct(product) {
  const category = String(product?.category || '').trim().toLowerCase();
  return category === 'forever flowers' || category === 'flowers';
}

function bouquetPaletteFor(productName) {
  const name = String(productName || '').toLowerCase();
  if (name.includes('sunflower')) return [{ name: 'Yellow', value: '#e4aa18' }];
  if (name.includes('tulip')) return [
    { name: 'White', value: '#f8f5ea' },
    { name: 'Orange', value: '#df7a2f' },
    { name: 'Blue', value: '#8fb8d7' }
  ];
  if (name.includes('rose')) return [
    { name: 'Red', value: '#b91c2f' },
    { name: 'Pink', value: '#e88aa9' },
    { name: 'Purple', value: '#8b5fbf' },
    { name: 'Yellow', value: '#e4b02d' },
    { name: 'Blue', value: '#75a9d6' }
  ];
  if (name.includes('daisy')) return [
    { name: 'White', value: '#fffaf0' },
    { name: 'Peach', value: '#f3b993' },
    { name: 'Pink', value: '#e9a6c4' },
    { name: 'Red', value: '#cf2435' },
    { name: 'Mint', value: '#9bd2c5' }
  ];
  if (name.includes('lily')) return [
    { name: 'Yellow', value: '#ead565' },
    { name: 'Purple', value: '#9b7ad3' },
    { name: 'Peach', value: '#efb79f' },
    { name: 'Red', value: '#cf2435' }
  ];
  if (name.includes('bunny')) return [
    { name: 'White', value: '#fffaf0' },
    { name: 'Cream', value: '#f3e6c8' }
  ];
  if (name.includes('pom')) return [
    { name: 'Cream', value: '#eadfc7' },
    { name: 'Peach', value: '#de946b' },
    { name: 'Lavender', value: '#b59ad1' }
  ];
  return [
    { name: 'Red', value: '#c5333f' },
    { name: 'Pink', value: '#e8a2bf' },
    { name: 'Yellow', value: '#dfad27' },
    { name: 'White', value: '#fffaf0' }
  ];
}

function bouquetFlowerProducts() {
  return PRODUCTS
    .filter(product => isForeverFlowerProduct(product) && /sticks/i.test(product.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function bouquetBaseImage() {
  return PRODUCTS.find(product => isForeverFlowerProduct(product) && /tulip daisy bouquet/i.test(product.name))?.image
    || PRODUCTS.find(product => isForeverFlowerProduct(product) && /mixed lily bouquet/i.test(product.name))?.image
    || PRODUCTS.find(product => isForeverFlowerProduct(product) && /bouquet/i.test(product.name))?.image
    || PRODUCTS.find(product => isForeverFlowerProduct(product))?.image
    || '';
}

function selectedBouquetItems() {
  return [...BOUQUET_BUILDER_STATE.selected.entries()].flatMap(([productId, colors]) => {
    const product = PRODUCTS.find(item => item.id === productId);
    if (!product) return [];
    const palette = bouquetPaletteFor(product.name);
    const chosenColors = colors.length ? colors : [palette[0]?.name].filter(Boolean);
    return chosenColors.map(colorName => {
      const color = palette.find(item => item.name === colorName) || palette[0] || { name: colorName, value: '#c9a227' };
      return { product, color };
    });
  });
}

function bouquetEstimate(items) {
  return items.reduce((sum, item) => sum + Number(item.product.price || 0), 0);
}

function initCustomBouquetBuilder() {
  const builder = document.getElementById('bouquet-builder');
  if (!builder) return;

  const flowers = bouquetFlowerProducts();
  if (!flowers.length) {
    builder.innerHTML = '<div class="bouquet-builder-empty">Flower stick options will appear here once they are added to inventory.</div>';
    return;
  }

  renderCustomBouquetBuilder();
}

function renderCustomBouquetBuilder() {
  const builder = document.getElementById('bouquet-builder');
  if (!builder) return;

  const flowers = bouquetFlowerProducts();
  const selectedItems = selectedBouquetItems();
  const estimate = bouquetEstimate(selectedItems);
  const baseImage = bouquetBaseImage();

  builder.innerHTML = `
    <div class="bouquet-builder-panel">
      <div class="bouquet-builder-step">
        <h3>1. Pick flower sticks</h3>
        <div class="bouquet-option-grid">
          ${flowers.map(product => {
            const active = BOUQUET_BUILDER_STATE.selected.has(product.id);
            return `<button type="button" class="bouquet-choice${active ? ' active' : ''}" onclick="toggleBouquetFlower('${escapeJsString(product.id)}')">
              <span>${escapeHtml(product.name)}</span>
              <small>${rupees(product.price)} each</small>
            </button>`;
          }).join('')}
        </div>
      </div>

      <div class="bouquet-builder-step">
        <h3>2. Choose colours</h3>
        <div class="bouquet-color-groups">
          ${flowers.filter(product => BOUQUET_BUILDER_STATE.selected.has(product.id)).map(product => bouquetColorGroup(product)).join('') || '<p class="bouquet-muted">Select a flower stick to view colour choices.</p>'}
        </div>
      </div>

      <div class="bouquet-actions">
        <button type="button" class="btn-primary" onclick="visualizeCustomBouquet()">Visualize bouquet</button>
        <button type="button" class="btn-outline" onclick="resetCustomBouquet()">Reset</button>
      </div>
    </div>

    <div class="bouquet-preview-card">
      <div class="bouquet-preview" aria-live="polite">
        ${baseImage ? `<img class="bouquet-base-image" src="${escapeHtml(baseImage)}" alt="Bouquet base reference"${BOUQUET_BUILDER_STATE.visualized && selectedItems.length ? ' style="opacity:0.35"' : ''}>` : ''}
        ${BOUQUET_BUILDER_STATE.visualized && selectedItems.length
          ? `<div class="bouquet-preview-ready">
               <div class="preview-icon">🌸</div>
               <p>Your bouquet preview is ready!</p>
               <small>${selectedItems.length} flower stick${selectedItems.length !== 1 ? 's' : ''} · ${rupees(estimate)} est.</small>
               <button type="button" class="btn-primary" onclick="openBouquetModal()" style="margin-top:0.25rem">View full preview →</button>
             </div>`
          : '<div class="bouquet-preview-placeholder">Pick flowers and colours, then visualize.</div>'}
      </div>
      <div class="bouquet-estimate">
        <span>Estimated bouquet cost</span>
        <strong>${selectedItems.length && BOUQUET_BUILDER_STATE.visualized ? rupees(estimate) : 'Select flowers'}</strong>
        <p>${selectedItems.length ? `${selectedItems.length} flower stick${selectedItems.length === 1 ? '' : 's'} selected. Estimate uses current product prices; final quote can be confirmed by the studio.` : 'Choose one or more flower sticks to build a custom bouquet.'}</p>
      </div>
    </div>
  `;
}

function bouquetColorGroup(product) {
  const selectedColors = BOUQUET_BUILDER_STATE.selected.get(product.id) || [];
  const palette = bouquetPaletteFor(product.name);
  return `
    <div class="bouquet-color-group">
      <p>${escapeHtml(product.name)}</p>
      <div class="bouquet-color-row">
        ${palette.map(color => {
          const active = selectedColors.includes(color.name);
          return `<button type="button" class="bouquet-color-chip${active ? ' active' : ''}" style="--chip-color: ${escapeHtml(color.value)}" onclick="toggleBouquetColor('${escapeJsString(product.id)}', '${escapeJsString(color.name)}')">
            <span></span>${escapeHtml(color.name)}
          </button>`;
        }).join('')}
      </div>
    </div>
  `;
}

// ── BOUQUET MODAL ────────────────────────────────────────────────────────

function visualizeCustomBouquet() {
  if (!selectedBouquetItems().length) {
    showToast('Choose at least one flower stick to visualize.', true);
    return;
  }
  BOUQUET_BUILDER_STATE.visualized = true;
  renderCustomBouquetBuilder();
  openBouquetModal();
}

function openBouquetModal() {
  const items = selectedBouquetItems();
  if (!items.length) return;
  const estimate = bouquetEstimate(items);

  let modal = document.getElementById('bouquet-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'bouquet-modal';
    modal.className = 'bouquet-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="bouquet-modal-backdrop" onclick="closeBouquetModal()"></div>
    <div class="bouquet-modal-card">
      <div class="bouquet-modal-header">
        <h3>Your Bouquet Preview</h3>
        <button class="bouquet-modal-close" onclick="closeBouquetModal()" aria-label="Close preview">&times;</button>
      </div>
      <div class="bouquet-stage">
        ${buildBouquetStageSVG(items)}
      </div>
      <div class="bouquet-modal-footer">
        <div class="bouquet-flower-chips">
          ${items.map(item => `
            <div class="bouquet-flower-chip">
              <span class="bouquet-flower-chip-dot" style="background:${escapeHtml(item.color.value)}"></span>
              ${escapeHtml(item.product.name.replace(/ sticks?/i, ''))} &middot; ${escapeHtml(item.color.name)}
            </div>
          `).join('')}
        </div>
        <div class="bouquet-modal-price-row">
          <div>
            <div class="bouquet-modal-price-label">Estimated total</div>
            <div class="bouquet-modal-price-amount">${rupees(estimate)}</div>
            <div class="bouquet-modal-price-note">${items.length} flower stick${items.length !== 1 ? 's' : ''} &middot; Final price confirmed by studio.</div>
          </div>
        </div>
        <div class="bouquet-modal-actions">
          <button class="btn-primary" onclick="enquireBouquet()">Request this bouquet</button>
          <button class="btn-outline" onclick="closeBouquetModal()">Edit selection</button>
        </div>
      </div>
    </div>
  `;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      modal.classList.add('bm-open');
      document.body.style.overflow = 'hidden';
    });
  });

  // Close on Escape key
  function onKeyDown(e) {
    if (e.key === 'Escape') { closeBouquetModal(); document.removeEventListener('keydown', onKeyDown); }
  }
  document.addEventListener('keydown', onKeyDown);
}

function closeBouquetModal() {
  const modal = document.getElementById('bouquet-modal');
  if (!modal) return;
  modal.classList.remove('bm-open');
  document.body.style.overflow = '';
  setTimeout(() => { if (modal.parentNode) modal.remove(); }, 420);
}

function enquireBouquet() {
  const items = selectedBouquetItems();
  const estimate = bouquetEstimate(items);
  const flowerList = items.map(i => `- ${i.product.name} (${i.color.name})`).join('\n');
  const subject = encodeURIComponent('Custom Bouquet Request — Nika Arts Studio');
  const body = encodeURIComponent(
    `Hi Nika Arts Studio,\n\nI'd love to order a custom bouquet with:\n${flowerList}\n\nEstimated cost: ${rupees(estimate)}\n\nCould you confirm availability and final pricing?\n\nThank you!`
  );
  const email = (typeof SITE_CONTENT !== 'undefined' && SITE_CONTENT?.contact?.email) || '';
  window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
  closeBouquetModal();
}

function buildBouquetStageSVG(items) {
  const W = 560;
  const H = 440;  // taller viewbox for more flower room
  const N = Math.min(items.length, 8);

  // Wrap geometry — kept compact at bottom
  const wrapCX    = W / 2;
  const wrapBotY  = H + 10;   // slightly below stage bottom (hidden)
  const wrapHeight = 160;
  const wrapTopY  = wrapBotY - wrapHeight;
  const wrapBotHW = 75;    // half-width at bottom
  const wrapTopHW = 50;    // half-width at wrap opening

  // Stem origin: from inside wrap opening
  const stemOX = wrapCX;
  const stemOY = wrapTopY + 8;

  // Spread angle (degrees total across all flowers) — wider for more bouquet feel
  const totalSpread = N <= 1 ? 0 : Math.min(90, 22 + N * 10);

  // Compute flower geometry
  const flowers = items.slice(0, 8).map((item, i) => {
    const t = N === 1 ? 0 : (i / (N - 1) - 0.5);   // -0.5 to +0.5
    const angleDeg = t * totalSpread;
    const angleRad = angleDeg * Math.PI / 180;
    const centrality = 1 - Math.abs(t) * 0.4;       // 1 = center, ~0.8 = edge
    const stemLen    = Math.round(230 * centrality);  // longer stems = flowers near top
    const r          = Math.round(62 * centrality + 40 * (1 - centrality)); // 62 center, 40 edge
    const cx = stemOX + Math.sin(angleRad) * stemLen;
    const cy = stemOY - Math.cos(angleRad) * stemLen;
    return { item, t, angleDeg, angleRad, stemLen, r, cx, cy, centrality, i };
  });

  // Z-order: center on top
  const byZ = [...flowers].sort((a, b) => a.centrality - b.centrality);

  // SVG defs
  const defs = `<defs>
    <linearGradient id="bmWrapGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"   stop-color="#F7E8D2"/>
      <stop offset="55%"  stop-color="#EDCFAD"/>
      <stop offset="100%" stop-color="#E4C49B"/>
    </linearGradient>
    <linearGradient id="bmWrapSheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="rgba(255,255,255,0.45)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.07)"/>
    </linearGradient>
    <filter id="bmPetalShadow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="5" stdDeviation="7" flood-color="rgba(20,12,4,0.25)"/>
    </filter>
    <filter id="bmWrapShadow" x="-15%" y="-5%" width="130%" height="120%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="rgba(20,12,4,0.2)"/>
    </filter>
    ${flowers.map(f => `<clipPath id="bmClip${f.i}"><circle cx="${f.cx.toFixed(1)}" cy="${f.cy.toFixed(1)}" r="${f.r}"/></clipPath>`).join('')}
  </defs>`;

  // Stems
  const stems = flowers.map(f => {
    const ex = (f.cx + stemOX * 0.15) / 1.15;  // slight inward curve at top
    const ey = (f.cy + stemOY * 0.15) / 1.15;
    return `<path d="M${stemOX.toFixed(1)},${stemOY} Q${ex.toFixed(1)},${((stemOY + f.cy)/2).toFixed(1)} ${f.cx.toFixed(1)},${f.cy.toFixed(1)}"
      fill="none" stroke="#4A6741" stroke-width="2.8" stroke-linecap="round" opacity="0.82"
      style="animation:stemGrow 0.55s ${(0.08 + f.i * 0.07).toFixed(2)}s ease both; stroke-dasharray:350; stroke-dashoffset:350"/>`;
  }).join('');

  // Flowers (sorted by z-order)
  const flowersSVG = byZ.map(f => {
    const delay = (0.32 + f.i * 0.09).toFixed(2);
    const txfOrigin = `transform-origin: ${f.cx.toFixed(1)}px ${f.cy.toFixed(1)}px`;
    const hasImg = f.item.product.image;
    return `<g style="animation:flowerPop 0.55s ${delay}s cubic-bezier(0.34,1.56,0.64,1) both; ${txfOrigin}" filter="url(#bmPetalShadow)">
      ${hasImg ? `<image href="${escapeHtml(f.item.product.image)}"
        x="${(f.cx - f.r).toFixed(1)}" y="${(f.cy - f.r).toFixed(1)}"
        width="${f.r * 2}" height="${f.r * 2}"
        clip-path="url(#bmClip${f.i})"
        preserveAspectRatio="xMidYMid slice"
        style="filter:saturate(1.15) contrast(1.05)"/>` : ''}
      <circle cx="${f.cx.toFixed(1)}" cy="${f.cy.toFixed(1)}" r="${f.r}"
        fill="${escapeHtml(f.item.color.value)}" opacity="${hasImg ? '0.42' : '0.9'}"
        ${hasImg ? 'style="mix-blend-mode:multiply"' : ''}/>
      <circle cx="${f.cx.toFixed(1)}" cy="${f.cy.toFixed(1)}" r="${f.r}"
        fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="2"/>
      <circle cx="${f.cx.toFixed(1)}" cy="${f.cy.toFixed(1)}" r="${Math.round(f.r*0.2)}"
        fill="rgba(255,255,255,0.72)"/>
    </g>`;
  }).join('');

  // Wrap shape
  const wTL = `${(wrapCX - wrapTopHW).toFixed(1)},${wrapTopY}`;
  const wTR = `${(wrapCX + wrapTopHW).toFixed(1)},${wrapTopY}`;
  const wBR = `${(wrapCX + wrapBotHW).toFixed(1)},${wrapBotY}`;
  const wBL = `${(wrapCX - wrapBotHW).toFixed(1)},${wrapBotY}`;
  const wrap = `<g style="animation:wrapSlideUp 0.45s 0.05s ease both" filter="url(#bmWrapShadow)">
    <polygon points="${wTL} ${wTR} ${wBR} ${wBL}" fill="url(#bmWrapGrad)"/>
    <polygon points="${wTL} ${wTR} ${wBR} ${wBL}" fill="url(#bmWrapSheen)" opacity="0.55"/>
    <line x1="${wrapCX}" y1="${wrapTopY}" x2="${wrapCX}" y2="${wrapBotY}" stroke="#C9A227" stroke-width="1.8" opacity="0.55"/>
    ${buildRibbonBow(wrapCX, wrapTopY + 6)}
  </g>`;

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    ${defs}${stems}${flowersSVG}${wrap}
  </svg>`;
}

function buildRibbonBow(cx, cy) {
  const r = 20;
  return `<g>
    <path d="M${cx},${cy} C${cx-r*1.6},${cy-r*1.3} ${cx-r*2.2},${cy+r*0.4} ${cx},${cy+r*0.25}" fill="#C9A227" opacity="0.88"/>
    <path d="M${cx},${cy} C${cx+r*1.6},${cy-r*1.3} ${cx+r*2.2},${cy+r*0.4} ${cx},${cy+r*0.25}" fill="#A8851E" opacity="0.88"/>
    <ellipse cx="${cx}" cy="${cy+r*0.12}" rx="${r*0.38}" ry="${r*0.28}" fill="#C9A227"/>
    <line x1="${(cx-r*0.35).toFixed(1)}" y1="${(cy+r*0.25).toFixed(1)}" x2="${(cx-r*0.9).toFixed(1)}" y2="${(cy+r*1.3).toFixed(1)}" stroke="#C9A227" stroke-width="3.5" stroke-linecap="round" opacity="0.82"/>
    <line x1="${(cx+r*0.35).toFixed(1)}" y1="${(cy+r*0.25).toFixed(1)}" x2="${(cx+r*0.9).toFixed(1)}" y2="${(cy+r*1.3).toFixed(1)}" stroke="#A8851E" stroke-width="3.5" stroke-linecap="round" opacity="0.82"/>
  </g>`;
}

function toggleBouquetFlower(productId) {
  if (BOUQUET_BUILDER_STATE.selected.has(productId)) {
    BOUQUET_BUILDER_STATE.selected.delete(productId);
  } else {
    const product = PRODUCTS.find(item => item.id === productId);
    const firstColor = bouquetPaletteFor(product?.name)[0]?.name;
    BOUQUET_BUILDER_STATE.selected.set(productId, firstColor ? [firstColor] : []);
  }
  BOUQUET_BUILDER_STATE.visualized = false;
  renderCustomBouquetBuilder();
}

function toggleBouquetColor(productId, colorName) {
  const colors = BOUQUET_BUILDER_STATE.selected.get(productId) || [];
  const nextColors = colors.includes(colorName)
    ? colors.filter(color => color !== colorName)
    : [...colors, colorName];
  BOUQUET_BUILDER_STATE.selected.set(productId, nextColors);
  BOUQUET_BUILDER_STATE.visualized = false;
  renderCustomBouquetBuilder();
}




function resetCustomBouquet() {
  BOUQUET_BUILDER_STATE.selected.clear();
  BOUQUET_BUILDER_STATE.visualized = false;
  renderCustomBouquetBuilder();
}

// Global listener: runs on every single page load
document.addEventListener('DOMContentLoaded', () => {
  updateCartCount(); // Keeps cart bubble accurate everywhere
  initShopPage();    // Draws the shop grid if we are on /shop
});
