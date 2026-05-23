# Nika Arts Studio — E-commerce Website

Full-stack e-commerce website with PhonePe/UPI payments and Shiprocket logistics.

---

## What's included

| Feature | Status |
|---|---|
| Homepage with hero + featured products | ✅ |
| Product listing page with category filter | ✅ |
| Shopping cart (add, remove, update qty) | ✅ |
| Checkout form with address validation | ✅ |
| PhonePe / UPI payment integration | ✅ |
| Shiprocket order creation on payment success | ✅ |
| Shiprocket serviceability check API | ✅ |
| Order confirmation page | ✅ |
| Mobile responsive design | ✅ |

---

## Project structure

```
nika-arts-studio/
├── public/                  ← Frontend (HTML/CSS/JS)
│   ├── index.html           ← Homepage
│   ├── products.html        ← Shop / product listing
│   ├── cart.html            ← Cart page
│   ├── checkout.html        ← Checkout + payment
│   ├── success.html         ← Order confirmation
│   ├── css/style.css        ← All styles
│   ├── js/cart.js           ← Cart logic + PRODUCTS data
│   └── images/              ← Put your product photos here
├── routes/
│   ├── payment.js           ← PhonePe payment gateway
│   ├── shiprocket.js        ← Shiprocket logistics
│   └── orders.js            ← Order management
├── server.js                ← Express server (entry point)
├── package.json
├── .env.example             ← Copy to .env and fill in keys
└── README.md
```

---

## Step 1 — Install and run locally

```bash
# 1. Install Node.js from https://nodejs.org (version 18+)

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your keys (see Step 2 below)

# 4. Start the server
npm start
# OR for auto-restart during development:
npm run dev

# 5. Open in browser
# http://localhost:3000
```

---

## Step 2 — Add your API keys (`.env`)

### PhonePe Payment Gateway
1. Sign up at https://dashboard.phonepe.com
2. Go to **Integrations → API Keys**
3. Copy your **Merchant ID**, **Salt Key**, and **Salt Index** into `.env`
4. Use `PHONEPE_ENV=sandbox` for testing, `production` when live

### Shiprocket
1. Sign up at https://app.shiprocket.in
2. Go to **Settings → API** → generate credentials
3. Add your pickup address under **Settings → Manage Pickup Addresses**
4. Copy the pickup location name exactly into `SHIPROCKET_PICKUP_LOCATION`

---

## Step 3 — Add your products

Open `public/js/cart.js` and edit the `PRODUCTS` array at the top of the file.

```js
const PRODUCTS = [
  {
    id: "p001",                        // unique ID, no spaces
    name: "Monsoon Reverie",           // product name
    price: 2499,                       // price in INR (number only)
    category: "Paintings",             // used for the filter buttons
    image: "images/monsoon.jpg",       // put your photo in public/images/
    description: "Original acrylic, 12×16 inches."
  },
  // ... add as many as you like
];
```

Put your product photos in the `public/images/` folder and reference them in the `image` field.

---

## Step 4 — Add your hero image

In `public/index.html`, find:
```html
<div class="hero-img-placeholder">Your hero image here</div>
```
Replace with:
```html
<img src="images/hero.jpg" alt="Nika Arts Studio" style="width:100%;height:100%;object-fit:cover;" />
```

---

## Step 5 — Update your contact email

In `public/index.html`, replace:
```html
hello@nikaartsstudio.com
```
with your actual email address.

---

## Step 6 — Deploy to the internet

### Option A — Free / low-cost (recommended to start)

**Frontend + Backend together on Railway:**
1. Push this folder to a GitHub repository
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add all your `.env` variables in Railway's dashboard
4. Railway gives you a public URL automatically

**Or use Render (also free tier):**
1. https://render.com → New Web Service → connect GitHub
2. Build command: `npm install`
3. Start command: `npm start`

### Option B — After buying your domain
1. Deploy as above
2. In Railway/Render, add your custom domain
3. Point your domain's DNS to Railway/Render (they give you the records)
4. Update `BASE_URL` in `.env` to `https://yourdomain.com`

---

## Shipping logic

Free shipping is set at ₹999+ orders. To change this, edit `public/checkout.html`:
```js
const shipping = subtotal >= 999 ? 0 : 99;
```

Update the package dimensions and weight in `routes/shiprocket.js` to match your actual packaging:
```js
length: 20,    // cm
breadth: 15,   // cm
height: 10,    // cm
weight: 0.5    // kg
```

---

## Testing payments (sandbox)

Use PhonePe's test credentials (from their dashboard) with `PHONEPE_ENV=sandbox`.
No real money is charged in sandbox mode.

---

## Questions?

For PhonePe integration issues: https://developer.phonepe.com/v1/docs
For Shiprocket issues: https://apidocs.shiprocket.in

---

## Database and admin dashboard

This project now includes a free local SQLite database. It stores:

- products
- stock levels
- orders
- order items
- payment events
- sales inventory events
- logistics events

Default database file:

```bash
SQLITE_DB_PATH=./data/store.sqlite
```

Admin page:

```text
http://localhost:3000/admin.html
```

Set this in `.env` to protect admin product/order APIs:

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
ADMIN_API_KEY=change-this-secret
```

Use the admin page to add products, update product names/categories/prices/stock, hide products, view sales totals, and update fulfillment/logistics status.

### Adding categories

Open:

```text
http://localhost:3000/admin.html
```

Use **Add category** before adding products. New categories are stored in SQLite and appear:

- in the **Add product** category dropdown
- in each existing product's category dropdown
- on the public shop page category filter

The shop page shows all active categories, including newly added categories.

### Uploading and replacing product photos

Open:

```text
http://localhost:3000/admin.html
```

For each product row:

1. Click **Choose file**
2. Select a JPEG, PNG, or WEBP image
3. Click **Upload photo**

The image is saved under:

```text
public/images/products/
```

The product record is updated in SQLite automatically. To replace a photo later, upload a new file for the same product; the storefront will use the newest uploaded image path.

The storefront loads products from `/api/products`; products are no longer managed by editing the frontend JavaScript array.

Important: the database integration uses Node's built-in SQLite support, so run this project on Node 24+.

### Free cloud image storage

Product image uploads can use Cloudinary instead of local disk storage.

1. Create a free Cloudinary account.
2. In Cloudinary, open Dashboard / API keys.
3. Add these values to `.env`:

```bash
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_PRODUCT_FOLDER=nika-arts/products
```

After these are set, admin product image uploads are sent to Cloudinary and the product stores the Cloudinary CDN URL in SQLite. If the variables are missing, uploads fall back to `public/images/products/` for local development.

The admin Inventory screen also includes a **Cloud Image Library** uploader where you can upload multiple JPEG, PNG, or WEBP files at once and copy the resulting cloud URLs.

### Opening the database directly

SQLite is a file database, so it does not have its own database username/password login. Your admin username/password protects the backend/admin APIs. The database file itself is:

```text
data/store.sqlite
```

Recommended free SQL tools:

- DB Browser for SQLite
- DBeaver Community Edition
- SQLite Viewer / SQLite extension for VS Code

In those tools, open the file at `data/store.sqlite`. If the server is running, you may also see `store.sqlite-wal` and `store.sqlite-shm`; those are normal SQLite write-ahead-log files.
