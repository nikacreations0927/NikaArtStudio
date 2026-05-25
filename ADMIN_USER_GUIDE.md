# Nika Arts Studio Admin and End-User Guide

This guide is written for the business admin who will manage Nika Arts Studio day to day. It explains what the website does, how the admin panel works, what has been completed so far, and what still needs attention before full production use.

## 1. Website Architecture

Nika Arts Studio is a full-stack e-commerce website. The same Node.js application serves both the customer website and the admin website.

### Customer Website

Customer-facing pages use clean URLs:

| Page | URL | Purpose |
|---|---|---|
| Home | `/` | Brand introduction, hero image, featured products, about, contact |
| Shop | `/shop` | Product listing and category filtering |
| Product detail | `/product?id=PRODUCT_ID` | Single product view |
| Cart | `/cart` | Cart review and quantity updates |
| Checkout | `/checkout` | Customer details, shipping, payment start |
| Success | `/success` | Order confirmation after payment |
| Track order | `/track-order` | Order tracking by login or order details |
| Account | `/account` | Customer login, registration, password management |
| Policy pages | `/privacy`, `/shipping`, `/returns` | Static customer information |

Old `.html` URLs redirect to the clean URLs, so customers should normally see links like `https://nikaartscreations.com/shop` instead of `products.html`.

### Admin Website

The admin site is available at:

```text
/admin
```

It is protected by admin login. After login, the admin can manage products, product images, stock, categories, orders, sales summary, fulfillment/logistics status, homepage content, logo/artist images, and admin password.

### Backend and Data Flow

The backend is an Express server in `server.js`.

| Area | API path | Used for |
|---|---|---|
| Authentication | `/api/auth` | Admin login, customer login, password reset, sessions |
| Products | `/api/products` | Product CRUD, image upload, bulk upload |
| Categories | `/api/categories` | Category list and creation |
| Orders | `/api/orders` | Checkout, order list, order tracking, status updates |
| Content/CMS | `/api/content` | Homepage text and site images |
| Payment | `/api/payment` | PhonePe payment initiation and callback |
| Logistics | `/api/shiprocket` | Shiprocket serviceability, tracking, order creation |
| Config | `/api/config` | Public config such as shipping rules |

### Storage

| Data type | Stored in |
|---|---|
| Products, orders, customers, sessions, stock events | Supabase Postgres |
| Product images | Cloudinary, when Cloudinary credentials are configured |
| Logo and artist image | Cloudinary, through the CMS upload |
| Code | GitHub |
| Live hosting | Render |
| Domain | GoDaddy DNS pointing to Render |

The important separation is: code lives in GitHub, product/order data lives in Supabase, images/files live in Cloudinary, and Render runs the live application.

## 2. Admin Login and Logout

### Login

1. Open `/admin`.
2. Enter admin username.
3. Enter admin password.
4. Click **Log in**.
5. Once logged in, the admin tabs become usable.

Admin login uses a secure server-side session cookie. The password is stored as a hash in Supabase, not as plain text.

### Logout

1. Open `/admin`.
2. Click **Log out**.
3. The current admin session is cleared.

### Change Admin Password

1. Log in to `/admin`.
2. Open **Settings**.
3. Enter current password.
4. Enter new password.
5. Confirm new password.
6. Click **Update Password**.

After password change, the current session remains active and other admin sessions are signed out.

Recommended password rule: use at least 12 characters with a mix of words, numbers, and symbols.

## 3. Admin Dashboard and Orders

Open:

```text
/admin -> Dashboard & Sales
```

The dashboard shows paid order count, revenue, product sales, low-stock count, top products, low-stock products, and recent orders.

### Export Orders CSV

1. Open **Dashboard & Sales**.
2. Click **Export orders CSV**.
3. A CSV file downloads with order ID, customer, email, total, payment, fulfillment, logistics, and created date.

Use this for offline reconciliation, manual reporting, or customer support.

### Update Fulfillment Status

For each order, the admin can choose:

- `PENDING`
- `READY_FOR_SHIPPING`
- `PACKED`
- `SHIPPED`
- `DELIVERED`
- `CANCELLED`

Steps:

1. Open **Dashboard & Sales**.
2. Find the order.
3. Change the **Fulfillment** dropdown.
4. Click **Save**.

### Update Logistics Status

For each order, the admin can choose:

- `NOT_CREATED`
- `CREATED`
- `PICKUP_SCHEDULED`
- `IN_TRANSIT`
- `DELIVERED`
- `RETURNED`
- `FAILED`

Steps:

1. Open **Dashboard & Sales**.
2. Find the order.
3. Change the **Logistics** dropdown.
4. Click **Save**.

## 4. Inventory Management

Open:

```text
/admin -> Inventory Management
```

The inventory screen is meant for daily business use. It is compact, searchable, sortable, filterable, and paginated.

The summary cards show total products, live products, hidden products, low-stock products, and out-of-stock products.

Search works across product name, category, and description.

Available filters:

- Category
- All products
- Live products
- Hidden products
- Low stock
- Out of stock

Available sort options:

- Newest first
- Name A-Z
- Stock low-high
- Price high-low

Use **Previous** and **Next** at the bottom of the inventory table to move through product pages.

## 5. Add a Single Product with Image

Best day-to-day workflow:

1. Open `/admin`.
2. Go to **Inventory Management**.
3. Click **Add Product**.
4. Fill product name, category, price, stock, and short description.
5. Click **Save Product**.
6. Find the newly added product in the Product Manager table.
7. Click **Edit**.
8. Select the product image file in the editor.
9. Click **Save Changes**.

When Cloudinary credentials are configured, the image is uploaded to Cloudinary and the Cloudinary URL is stored against the product in Supabase.

Supported image types:

- JPEG
- PNG
- WEBP

Current image size limit:

```text
4 MB per image
```

Tip: for faster website loading, keep product images compressed and clear. A good target is usually below 1 MB per image.

## 6. Upload Many Images to Cloudinary

Use this when you have a folder of product images and want cloud URLs first.

1. Open `/admin`.
2. Go to **Inventory Management**.
3. In **Cloud Image Library**, click **Upload Images**.
4. Select up to 30 images at a time.
5. Wait for upload to complete.
6. Copy the generated Cloudinary URL for each image.
7. Use those URLs in a product CSV or product image field.

The admin panel will show whether Cloudinary is active. If Cloudinary is not configured, it will warn that local fallback is active.

## 7. Bulk Product Upload with CSV

Use CSV upload when adding many products.

### Download Template

1. Open `/admin`.
2. Go to **Inventory Management**.
3. Click **Download CSV Template**.

CSV columns:

```csv
Name,Category,Price,Stock,Image,Description
```

Example:

```csv
Bee Couple Keychains,Keychains,499,5,https://res.cloudinary.com/.../bee-couple.jpg,Handmade crochet bee couple keychains.
```

### Upload CSV

1. Prepare the CSV.
2. Make sure every product has name, category, price, stock, image URL if available, and description.
3. Open `/admin`.
4. Go to **Inventory Management**.
5. Click **Upload CSV**.
6. Select the CSV file.
7. Wait for success message.
8. Review the products in the table.

### Important Duplicate Note

Bulk CSV upload adds new products. It does not automatically merge duplicates. If duplicates are uploaded, search for the duplicate product, confirm which one should be removed, and click **Remove** on the unwanted duplicate.

Use **Remove** only for accidental or duplicate products.

## 8. Edit Product Details

1. Open **Inventory Management**.
2. Find the product.
3. Click **Edit**.
4. Update name, category, description, price, stock, status, or image file.
5. Click **Save Changes**.

If stock is changed, the backend records an inventory event for audit/history.

## 9. Hide Product vs Remove Product

### Hide

Use **Hide** when a product should not be visible to customers, but may be reused later.

Behavior:

- Product stays in admin.
- Product is hidden from storefront.
- Data is preserved.

Typical use cases:

- Temporarily out of sale
- Seasonal item
- Product needs better image/description before launch

### Remove

Use **Remove** for duplicates or accidental uploads.

Behavior:

- If the product has no order history, it is permanently removed.
- If the product has order history, it is archived so past orders remain safe.
- If possible, unused Cloudinary image cleanup is attempted.

Typical use cases:

- Duplicate created by CSV upload
- Wrong product added accidentally
- Test product created by mistake

## 10. Export Products CSV

1. Open **Inventory Management**.
2. Click **Export CSV**.
3. A product CSV downloads.

Export includes ID, name, category, price, stock, active status, image URL, and description. Use this before major inventory changes as a quick backup.

## 11. Site Content CMS

Open:

```text
/admin -> Site Content (CMS)
```

The CMS controls public homepage content.

### Hero Section

Admin can update eyebrow text, main title, and subtitle.

The main title allows simple HTML. For example, the current design uses `<em>` for highlighted italic text. Use HTML carefully and avoid complex tags.

### Website Images

Admin can upload:

- Logo image
- Artist image

Steps:

1. Open **Site Content (CMS)**.
2. Choose file under **Logo image** or **Artist image**.
3. Click the relevant upload button.
4. The image is uploaded to Cloudinary.
5. The storefront uses the Cloudinary URL automatically.

### About Section

Admin can update about eyebrow, title, paragraph 1, and paragraph 2.

### Contact Details

Admin can update contact email, display phone number, and phone link.

Phone link should normally use the format:

```text
+91XXXXXXXXXX
```

Example:

```text
+919876543210
```

After editing content, click **Save Content**.

## 12. Customer Experience

Customers can browse products, filter by category, view product details, add products to cart, update cart quantity, checkout, pay through PhonePe when configured, create account, log in, log out, change password, request password reset, and track orders.

Customer account is available at:

```text
/account
```

Order tracking is available at:

```text
/track-order
```

### Password Reset Email

Password reset emails require:

```text
EMAIL_USER
EMAIL_PASS
BASE_URL
```

In local development, if email is not configured, the app can return a reset link for testing. In production, email credentials and `BASE_URL` must be correct.

After the final domain is live, `BASE_URL` should be:

```text
https://nikaartscreations.com
```

## 13. Shipping Rule

Shipping is calculated by backend code, not hardcoded inside a single page.

Default values:

```text
SHIPPING_FEE=99
FREE_SHIPPING_MINIMUM=2000
```

Rule:

- Order subtotal below Rs. 2,000: Rs. 99 shipping
- Order subtotal Rs. 2,000 or above: free shipping

These values are environment variables, so they can be changed later without rewriting checkout logic.

## 14. Admin Privileges

Current admin privileges:

- Log in to admin panel
- View sales dashboard
- View recent orders
- Export order CSV
- Update fulfillment status
- Update logistics status
- View product inventory
- Search/filter/sort/paginate products
- Add products
- Edit product details
- Upload product images to Cloudinary
- Bulk upload images
- Bulk upload products using CSV
- Hide products from storefront
- Remove duplicate/accidental products
- Export product CSV
- Edit homepage content
- Upload logo and artist images
- Update admin password

Current admin limitations:

- No multi-admin user management screen yet.
- No role-based permissions yet.
- No refund management yet.
- No direct Shiprocket label generation screen yet.
- No in-admin Cloudinary folder browser yet; the current flow uploads and displays generated URLs.
- No audit screen for every admin action yet, though stock events are recorded.

## 15. Mild Technical Details for Testing

After deployment, test:

1. Home page loads at `/`.
2. Shop page loads at `/shop`.
3. Product images load from Cloudinary.
4. Add to cart works.
5. Cart quantity update works.
6. Checkout page shows correct shipping.
7. Admin login works.
8. Inventory products load.
9. Add/edit/hide/remove product works.
10. CMS logo/artist image upload works.
11. Customer register/login/logout works.
12. Password reset email works after `BASE_URL` and email settings are configured.
13. Order tracking loads the correct order.

Useful URLs:

```text
/api/health
/api/products
/api/content
/api/config
```

`/api/products?includeInactive=true` requires admin authentication.

Important Render environment variables:

```text
NODE_ENV=production
BASE_URL=https://nikaartscreations.com
DATABASE_URL=Supabase pooler connection string
PGSSLMODE=require
ADMIN_USERNAME=...
ADMIN_PASSWORD=...
JWT_SECRET=...
EMAIL_USER=...
EMAIL_PASS=...
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
PHONEPE_MERCHANT_ID=...
PHONEPE_SALT_KEY=...
PHONEPE_SALT_INDEX=...
PHONEPE_ENV=production
SHIPROCKET_EMAIL=...
SHIPROCKET_PASSWORD=...
SHIPROCKET_PICKUP_LOCATION=...
SHIPROCKET_PICKUP_PINCODE=...
```

Do not commit `.env` to GitHub.

## 16. What Has Been Done So Far

From scratch, the project now includes:

- Customer-facing storefront
- Clean customer URLs without `.html`
- Product listing and category filter
- Product detail page
- Cart
- Checkout
- Shipping fee rule
- Customer registration/login/logout
- Customer password change
- Customer forgot/reset password
- Order tracking
- Admin login/logout
- Admin password change
- Admin dashboard
- Sales summary
- Order listing
- Fulfillment/logistics status updates
- Product inventory manager
- Product search/filter/sort/pagination
- Add/edit/hide/remove product
- Bulk image upload
- Bulk CSV product upload
- Product CSV export
- Order CSV export
- Cloudinary product image storage
- Cloudinary logo/artist image storage
- CMS for homepage/about/contact content
- Supabase Postgres migration from local SQLite
- Render deployment setup
- GoDaddy custom domain setup guidance
- PhonePe integration routes
- Shiprocket integration routes
- Email reset support
- GitHub repository setup and push flow

## 17. What Still Needs To Be Completed or Verified

Recommended pending items before calling the store fully production-ready:

1. PhonePe production onboarding and live payment verification.
2. Shiprocket live order creation verification with actual pickup location.
3. Final custom domain verification and `BASE_URL` update.
4. Password reset email test on live domain.
5. Full checkout test with a real low-value and high-value order.
6. Confirm cancellation/refund business process.
7. Decide whether GST details need to be displayed based on business registration and tax advice.
8. Add formal privacy, shipping, cancellation, and returns text reviewed by the business owner.
9. Add a backup/export routine for Supabase data.
10. Add multi-admin user management if more than one person will manage operations.
11. Add audit log screen if admin actions need traceability.
12. Add product image optimization guidelines for consistent storefront appearance.
13. Add analytics such as Google Analytics or privacy-friendly analytics if desired.
14. Add SEO metadata for product pages.
15. Add automated deployment smoke tests.

## 18. Operational Best Practices

Before bulk upload:

- Upload images to Cloudinary first.
- Keep a product CSV backup.
- Use consistent product names.
- Use consistent category names.
- Check prices and stock before upload.

After bulk upload:

- Filter by newest products.
- Check images.
- Check spelling.
- Remove duplicates.
- Hide any product that should not be visible yet.

Before festival or sale periods:

- Export products CSV.
- Review low stock.
- Update descriptions and prices.
- Test checkout.
- Test payment.
- Confirm Shiprocket pickup settings.

Security:

- Do not share admin password in chat or email.
- Change admin password if shared accidentally.
- Do not share Render, Supabase, Cloudinary, PhonePe, or Shiprocket credentials.
- Keep `.env` local and private.

## 19. Quick Troubleshooting

### Product image is not visible

Check product image URL, direct Cloudinary URL, product live status, category filter, and browser cache.

### Product appears twice

Likely duplicate CSV upload. Use **Remove** for the accidental duplicate.

### Product not visible on shop page

Check product status, selected category filter, and whether the product is hidden.

### Admin login fails

Check username/password, Render environment variables, Supabase connectivity, and whether the admin user exists in `admin_users`.

### Password reset email does not arrive

Check `EMAIL_USER`, `EMAIL_PASS`, `BASE_URL`, Gmail app password settings if Gmail is used, and spam folder.

### Cloudinary upload falls back to local

Check `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, Render environment variables, and whether the service redeployed.

### Supabase connection fails

Use Supabase pooler connection string, not a direct IPv6-only host if Render cannot reach it.

Recommended host:

```text
aws-0-ap-south-1.pooler.supabase.com
```

Also set:

```text
PGSSLMODE=require
```

## 20. Recommended Admin Routine

Daily:

- Check new orders.
- Update fulfillment/logistics status.
- Check low stock.

When adding products:

- Upload images.
- Add product or CSV upload.
- Review product display on `/shop`.
- Test one product detail page.

Weekly:

- Export products CSV.
- Export orders CSV.
- Review hidden/duplicate products.
- Check Cloudinary storage usage.

Monthly:

- Change admin password if needed.
- Review policy pages.
- Review pending integrations and payment/logistics reports.
