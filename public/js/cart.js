/* ─────────────────────────────────────────────────────────
   cart.js — Shared cart logic + product data
   ─────────────────────────────────────────────────────────

   HOW TO ADD YOUR PRODUCTS:
   Fill in the PRODUCTS array below. Each product needs:
     id       – unique string (no spaces)
     name     – product name
     price    – price in INR (number, no ₹ symbol)
     category – used for filter buttons
     image    – path to your image, e.g. "images/painting1.jpg"
                Leave as "" if you don't have the image yet.
───────────────────────────────────────────────────────── */

let PRODUCTS = [];
let CATEGORIES = [];

const FALLBACK_PRODUCTS = [
  {
    id: "p001",
    name: "Lily",
    price: 449,
    category: "Crochet",
    image: "",          // e.g. "images/monsoon-reverie.jpg"
    description: "Original acrylic on canvas",
    stock: 10
  },
  {
    id: "p002",
    name: "Sunflower",
    price: 549,
    category: "Crochet",
    image: "",
    description: "Fine art giclée print, A4 size, archival paper.",
    stock: 10
  },
  {
    id: "p003",
    name: "Rose",
    price: 349,
    category: "Crochet",
    image: "",
    description: "Original watercolour, 8×10 inches.",
    stock: 10
  },
  {
    id: "p004",
    name: "Flower Bouquet",
    price: 349,
    category: "Keychains",
    image: "",
    description: "Hand-illustrated A5 sketchbook, 120 pages.",
    stock: 10
  },
  {
    id: "p005",
    name: "Long Neck",
    price: 549,
    category: "Keychains",
    image: "",
    description: "Original oil on canvas, 18×24 inches.",
    stock: 10
  },
  {
    id: "p006",
    name: "Bee Happy",
    price: 449,
    category: "Keychains",
    image: "",
    description: "Set of 3 A5 botanical prints, unframed.",
    stock: 10
  },
];

const FALLBACK_CATEGORIES = [
  { id: 1, name: 'Crochet', isActive: true },
  { id: 2, name: 'Keychains', isActive: true }
];

async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error('Product API unavailable');
    const data = await res.json();
    PRODUCTS = data.products || [];
  } catch (err) {
    console.warn('Using fallback products:', err.message);
    PRODUCTS = FALLBACK_PRODUCTS;
  }
  return PRODUCTS;
}

async function loadCategories() {
  try {
    const res = await fetch('/api/categories');
    if (!res.ok) throw new Error('Category API unavailable');
    const data = await res.json();
    CATEGORIES = data.categories || [];
  } catch (err) {
    console.warn('Using fallback categories:', err.message);
    CATEGORIES = FALLBACK_CATEGORIES;
  }
  return CATEGORIES;
}

/* ──── Cart helpers (localStorage) ──── */

function getCart() {
  try {
    return JSON.parse(localStorage.getItem('nika_cart') || '[]');
  } catch { return []; }
}

function saveCart(cart) {
  localStorage.setItem('nika_cart', JSON.stringify(cart));
}

function syncCartWithProducts() {
  if (!PRODUCTS.length) return getCart();

  const cart = getCart()
    .map(item => {
      const product = PRODUCTS.find(p => p.id === item.id);
      if (!product || product.stock <= 0) return null;
      return {
        id: product.id,
        name: product.name,
        price: product.price,
        image: product.image,
        qty: Math.min(item.qty, product.stock)
      };
    })
    .filter(Boolean);

  saveCart(cart);
  return cart;
}

function addToCart(productId) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return;
  if (product.stock <= 0) {
    alert('This item is currently out of stock.');
    return;
  }
  const cart = getCart();
  const existing = cart.find(i => i.id === productId);
  if (existing) {
    if (existing.qty >= product.stock) {
      alert(`Only ${product.stock} left in stock.`);
      return;
    }
    existing.qty += 1;
  } else {
    cart.push({ id: product.id, name: product.name, price: product.price, image: product.image, qty: 1 });
  }
  saveCart(cart);
  updateCartCount();
}

function removeFromCart(productId) {
  const cart = getCart().filter(i => i.id !== productId);
  saveCart(cart);
  updateCartCount();
  if (typeof renderCart === 'function') renderCart();
}

function updateCartCount() {
  const cart = getCart();
  const total = cart.reduce((s, i) => s + i.qty, 0);
  document.querySelectorAll('#cart-count').forEach(el => {
    el.textContent = total > 0 ? total : '';
    el.style.display = total > 0 ? 'flex' : 'none';
  });
}

/* ──── Render a product card HTML ──── */
function productCard(product) {
  const imgHtml = product.image
    ? `<img class="product-img" src="${product.image}" alt="${product.name}" loading="lazy" />`
    : `<div class="product-img-placeholder">Image coming soon</div>`;
  const isOut = product.stock <= 0;
  return `
    <div class="product-card">
      ${imgHtml}
      <div class="product-info">
        <p class="product-category">${product.category}</p>
        <p class="product-name">${product.name}</p>
        <p class="product-price">₹${product.price.toLocaleString('en-IN')}</p>
        <p class="product-stock">${isOut ? 'Out of stock' : `${product.stock} in stock`}</p>
        <button class="add-to-cart-btn" id="btn-${product.id}" onclick="handleAddToCart('${product.id}', this)" ${isOut ? 'disabled' : ''}>
          ${isOut ? 'Out of stock' : 'Add to cart'}
        </button>
      </div>
    </div>`;
}

/* ──── Add-to-cart button feedback ──── */
function handleAddToCart(id, btn) {
  addToCart(id);
  btn.textContent = '✓ Added';
  btn.classList.add('added');
  setTimeout(() => {
    btn.textContent = 'Add to cart';
    btn.classList.remove('added');
  }, 1500);
}
