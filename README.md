# Nika Arts Studio E-Commerce Website

Nika Arts Studio is a full-stack e-commerce website for selling handcrafted products online. The current production flow uses GitHub for code, Render for hosting, Supabase Postgres for database storage, Cloudinary for images, PhonePe for payments, and Shiprocket for shipping/logistics.

For business-admin operating instructions, product upload workflows, admin privileges, troubleshooting, and pending production tasks, read:

[ADMIN_USER_GUIDE.md](ADMIN_USER_GUIDE.md)

## Current Production Architecture

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | HTML, CSS, vanilla JavaScript | Customer storefront and admin UI |
| Backend | Node.js, Express | APIs, auth, products, orders, payments, logistics |
| Database | Supabase Postgres | Products, categories, orders, customers, sessions, settings |
| Image storage | Cloudinary | Product images, logo image, artist image |
| Hosting | Render Web Service | Runs the Node/Express app |
| Source control | GitHub | Stores code and triggers Render deploys |
| Domain | GoDaddy DNS + Render custom domain | Public website URL |
| Payments | PhonePe | Payment initiation, callbacks, payment status |
| Shipping | Shiprocket | Serviceability, order creation, tracking integration |
| Email | Nodemailer/Gmail app password | Customer password reset emails |

## Main URLs

Production customer URLs:

```text
https://nikaartscreations.com/
https://nikaartscreations.com/shop
https://nikaartscreations.com/product?id=PRODUCT_ID
https://nikaartscreations.com/cart
https://nikaartscreations.com/checkout
https://nikaartscreations.com/success
https://nikaartscreations.com/track-order
https://nikaartscreations.com/account
```

Admin URL:

```text
https://nikaartscreations.com/admin
```

Legacy `.html` URLs redirect to clean URLs. For example, `/products.html` redirects to `/shop`.

## Feature Status

| Feature | Status |
|---|---|
| Homepage with Cloudinary logo/hero image | Done |
| Shop page with categories | Done |
| Product detail page | Done |
| Cart | Done |
| Checkout | Done |
| Dynamic shipping rule | Done |
| Customer register/login/logout | Done |
| Customer password change | Done |
| Customer forgot/reset password | Done |
| Order tracking | Done |
| Admin login/logout | Done |
| Admin password change | Done |
| Admin dashboard and sales summary | Done |
| Admin inventory manager | Done |
| Product add/edit/hide/remove | Done |
| Product CSV bulk upload | Done |
| Product CSV export | Done |
| Order CSV export | Done |
| Cloudinary product image upload | Done |
| Cloudinary logo/artist image upload | Done |
| Supabase Postgres migration | Done |
| Render deployment | Done |
| Custom domain setup | In progress / DNS dependent |
| PhonePe production verification | Pending business onboarding |
| Shiprocket live order verification | Pending live credentials and pickup setup |

## Project Structure

```text
nika-arts-studio/
|-- public/
|   |-- index.html              # Homepage
|   |-- products.html           # Shop page, served as /shop
|   |-- product.html            # Product detail page
|   |-- cart.html               # Cart
|   |-- checkout.html           # Checkout
|   |-- success.html            # Payment/order success page
|   |-- track.html              # Order tracking, served as /track-order
|   |-- account.html            # Customer account page
|   |-- admin.html              # Admin shell
|   |-- admin-panels/           # Admin dashboard, inventory, CMS, settings
|   |-- css/style.css           # Shared styling
|   |-- js/cart.js              # Customer storefront/cart logic
|   |-- js/admin.js             # Admin panel logic
|   `-- js/site-assets.js       # Cloudinary site asset loader
|-- routes/
|   |-- auth.js                 # Admin/customer auth and password reset
|   |-- products.js             # Product APIs and image upload
|   |-- categories.js           # Category APIs
|   |-- orders.js               # Checkout/order APIs
|   |-- payment.js              # PhonePe APIs
|   |-- shiprocket.js           # Shiprocket APIs
|   |-- content.js              # CMS/site content APIs
|   `-- config.js               # Public config APIs
|-- db/
|   |-- connection.js           # Supabase/Postgres schema and seed logic
|   `-- queries.js              # Database query helpers
|-- services/
|   |-- storage.js              # Cloudinary/local image storage
|   |-- shipping.js             # Shipping fee calculation
|   `-- email.js                # Password reset email
|-- scripts/
|   |-- migrate-sqlite-to-postgres.js
|   |-- migrate-sqlite-to-supabase-safe.js
|   |-- smoke-e2e.js
|   |-- upload-keychain-images.js
|   |-- upload-site-assets.js
|   `-- seed-admin-user.js
|-- ADMIN_USER_GUIDE.md
|-- .env.example
|-- package.json
`-- server.js
```

## Local Development Setup

Requirements:

- Node.js 24 or newer
- Supabase Postgres connection string
- Cloudinary credentials if testing cloud image upload

Install dependencies:

```bash
npm install
```

Create local environment file:

```bash
copy .env.example .env
```

On macOS/Linux:

```bash
cp .env.example .env
```

Edit `.env` with local or production-like credentials.

Start the app:

```bash
npm start
```

Open:

```text
http://localhost:3000
http://localhost:3000/admin
```

## Environment Variables

The live Render service must have these values configured.

### Core

```bash
NODE_ENV=production
PORT=3000
BASE_URL=https://nikaartscreations.com
DATABASE_URL=postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
PGSSLMODE=require
PG_POOL_MAX=5
JWT_SECRET=change-this-secret
```

Use the Supabase pooler connection string for Render. Avoid direct IPv6-only database hosts if Render cannot reach them.

### Admin

```bash
ADMIN_USERNAME=admin_username
ADMIN_PASSWORD=strong_initial_password
ADMIN_DISPLAY_NAME=Business Admin
ADMIN_API_KEY=optional-api-key-for-scripts
ADMIN_SESSION_HOURS=12
```

`ADMIN_USERNAME` and `ADMIN_PASSWORD` seed the first admin user only when the database has no admin user yet. After that, change the password from `/admin -> Settings`.

### Customer Auth and Email

```bash
CUSTOMER_SESSION_DAYS=30
PASSWORD_RESET_MINUTES=30
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-gmail-app-password
```

Password reset emails require `EMAIL_USER`, `EMAIL_PASS`, and `BASE_URL`.

### Shipping

```bash
SHIPPING_FEE=99
FREE_SHIPPING_MINIMUM=2000
```

Default rule:

- Cart subtotal below Rs. 2,000: Rs. 99 shipping
- Cart subtotal Rs. 2,000 or above: free shipping

### Cloudinary

```bash
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_PRODUCT_FOLDER=nika-arts/products
CLOUDINARY_SITE_FOLDER=nika-arts/site
```

When these values are present, product and site image uploads use Cloudinary. If they are missing in local development, image upload can fall back to local file storage.

### PhonePe

```bash
PHONEPE_MERCHANT_ID=your_merchant_id
PHONEPE_SALT_KEY=your_salt_key
PHONEPE_SALT_INDEX=1
PHONEPE_ENV=sandbox
```

Use `PHONEPE_ENV=production` only after PhonePe production onboarding is complete.

### Shiprocket

```bash
SHIPROCKET_EMAIL=your_shiprocket_email
SHIPROCKET_PASSWORD=your_shiprocket_password
SHIPROCKET_PICKUP_LOCATION=Primary
SHIPROCKET_PICKUP_PINCODE=641004
```

`SHIPROCKET_PICKUP_LOCATION` must exactly match the pickup location configured in Shiprocket.

## Admin Operations

Admin operations are performed from:

```text
/admin
```

Use the admin panel for product and content work. Do not edit `public/js/cart.js` to add products; products now come from Supabase through `/api/products`.

Common admin actions:

- Add one product
- Upload product image to Cloudinary
- Upload many images to Cloudinary
- Bulk upload products through CSV
- Edit product name/category/price/stock/status
- Hide a product from storefront
- Remove duplicate/accidental products
- Export products CSV
- View sales dashboard
- Export orders CSV
- Update fulfillment/logistics status
- Upload logo and artist image
- Edit homepage/about/contact content
- Change admin password

Detailed steps are in [ADMIN_USER_GUIDE.md](ADMIN_USER_GUIDE.md).

## Product and Image Flow

Recommended product upload flow:

1. Upload product images from `/admin -> Inventory Management -> Cloud Image Library`.
2. Copy Cloudinary URLs.
3. Add products manually or through CSV.
4. Confirm product images and details in the inventory table.
5. Check the public `/shop` page.
6. Remove duplicates if a CSV upload created any.

CSV format:

```csv
Name,Category,Price,Stock,Image,Description
Bee Couple Keychains,Keychains,499,5,https://res.cloudinary.com/.../bee-couple.jpg,Handmade crochet bee couple keychains.
```

## Database

The app initializes required tables automatically on server startup.

Main tables include:

- `products`
- `categories`
- `orders`
- `order_items`
- `customers`
- `customer_sessions`
- `customer_password_resets`
- `admin_users`
- `admin_sessions`
- `inventory_events`
- `payments`
- `logistics_events`
- `settings`

To migrate from the old SQLite database:

```bash
npm run db:migrate:sqlite
```

Safer Supabase migration script:

```bash
npm run db:migrate:supabase-safe
```

Use migration scripts carefully and only when you intentionally want to copy old local data into Supabase.

## Useful Scripts

```bash
npm start
npm run dev
npm run test:e2e:smoke
npm run db:migrate:sqlite
npm run db:migrate:supabase-safe
npm run admin:seed
npm run upload:keychains
npm run upload:site-assets
```

Smoke test:

```bash
npm run test:e2e:smoke
```

The smoke test checks health, products, customer auth basics, password change, logout/login, and payment initiation up to the configured payment response.

## Deployment Flow

Current deployment flow:

1. Make code changes locally.
2. Test locally.
3. Commit changes.
4. Push to GitHub `main`.
5. Render auto-deploys from GitHub.
6. Verify the Render URL or custom domain.

Render build command:

```bash
npm install
```

Render start command:

```bash
npm start
```

After custom domain is fully verified, production `BASE_URL` should be:

```text
https://nikaartscreations.com
```

## Production Verification Checklist

After each important deployment:

1. Open `/`.
2. Open `/shop`.
3. Confirm Cloudinary images load.
4. Add product to cart.
5. Confirm shipping fee rule in cart/checkout.
6. Open `/admin` and log in.
7. Confirm inventory loads.
8. Confirm dashboard loads.
9. Open `/account`.
10. Test customer login/logout if needed.
11. Test password reset after `BASE_URL` and email are configured.
12. Run a payment test in the correct PhonePe environment.
13. Verify Shiprocket serviceability for a known pincode.

## Known Pending Production Items

- Complete PhonePe production business onboarding and live payment verification.
- Complete Shiprocket live order creation verification.
- Finalize custom domain DNS and `BASE_URL`.
- Verify password reset emails on the live domain.
- Review policy pages with final business/legal wording.
- Decide GST display requirements based on business registration and tax advice.
- Add backups/export strategy for Supabase.
- Add multi-admin or role-based permissions if more operators are added.
- Add admin audit log screen if operational traceability becomes important.

## Security Notes

- Never commit `.env`.
- Never share Supabase, Cloudinary, PhonePe, Shiprocket, Render, or email credentials.
- Use strong admin password and rotate it if shared accidentally.
- Keep `JWT_SECRET` private and strong.
- Prefer Render environment variables for production secrets.

## More Documentation

Admin/business guide:

[ADMIN_USER_GUIDE.md](ADMIN_USER_GUIDE.md)

Environment variable template:

[.env.example](.env.example)
