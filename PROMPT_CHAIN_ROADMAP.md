# Nika Arts Studio Prompt Chain Roadmap

This file documents the suggested prompt sequence to rebuild the Nika Arts Studio website from scratch using Codex or another AI coding assistant.

The idea is to avoid asking for the whole production site in one giant prompt. Instead, each prompt builds one business capability, verifies it, and then moves to the next layer.

## How To Use This File

Use Prompt 1 first to create the initial MVP. After the MVP works locally, continue with the follow-up prompts in order.

For best results:

- Ask for one major feature at a time.
- Include both customer behavior and admin behavior.
- Mention what should not break.
- Ask for local testing before commit.
- Ask for a preview before committing visual UI changes.
- Commit and push after each stable milestone.

## Prompt 1: MVP Website Foundation

```text
I want to build an e-commerce website for my handmade crochet and arts business called Nika Arts Studio.

Business context:
- We sell handmade crochet products such as keychains, flowers, bouquets, photo magnets, and custom products.
- Customers should be able to browse products, view details, add to cart, checkout, and place orders.
- Admin/business user should be able to manage products and orders without technical knowledge.

Build the first MVP version with:

1. Public customer website
- Home page with brand/logo, hero section, featured products, and navigation
- Product listing page with category filters
- Product detail page
- Cart page
- Checkout page

2. Product data model
- Product name
- Category
- Description
- Price
- Stock
- Product image URL
- Active/hidden status

3. Admin area
- Secure admin login
- Product inventory page
- Add product
- Edit product
- Hide/show product
- Delete product
- Basic order list

4. Backend
- Node.js + Express
- Database-backed product and order storage
- REST APIs for products, cart/order placement, and admin actions

5. UI/UX
- Clean, simple, mobile-friendly design
- Brand feel: handmade, warm, premium, soft colors
- Admin UI should be layman-friendly and easy to scan

6. Security basics
- Password hashing
- Admin-only APIs protected
- Environment variables for secrets
- No hardcoded credentials

Deliverables:
- Working local app
- Clear file structure
- Setup instructions
- Basic test/smoke checklist
```

Acceptance criteria:

- Customer can open the home page and browse products.
- Customer can add a product to cart and reach checkout.
- Admin can log in and manage products.
- Product and order data are stored in a database.
- No secret values are hardcoded in source code.

## Prompt 2: Cloud Image Storage

```text
Move product images away from local storage. Integrate Cloudinary so admin can upload product images to Cloudinary and save only Cloudinary URLs in the database.

Update product display pages to load images from Cloudinary.

Add CSV bulk upload support for products with Cloudinary image URLs.

Make sure existing products still display correctly.
```

Acceptance criteria:

- Admin can upload an image and get a Cloudinary-backed product image.
- Products render using Cloudinary URLs.
- CSV import can create multiple products with image URLs.
- Local image dependency is removed from normal product display.

## Prompt 3: Admin Inventory Improvements

```text
Improve the admin inventory page for a non-technical business user.

Add:
- Search
- Category filter
- Status filter
- Sort
- Compact product table
- Edit/delete/hide actions
- CSV import/export
- Clear success/error messages without browser alert popups

Keep the page easy for a layman business user to operate daily.
```

Acceptance criteria:

- Admin can quickly find products.
- Admin can remove duplicates or hide products.
- Admin can import/export products by CSV.
- UI feedback appears inside the app, not as JavaScript alert popups.

## Prompt 4: Authentication

```text
Rework authentication.

Add:
- Secure admin login/logout with session handling
- Customer signup
- Customer login/logout
- Password reset using email
- Protected account and order pages

Use current production security standards and environment variables for email/base URL configuration.
```

Acceptance criteria:

- Admin routes are protected.
- Customer account routes are protected.
- Passwords are hashed.
- Password reset flow works locally and supports production email settings.
- Logout clears the user session.

## Prompt 5: Orders And Manual UPI

```text
Add checkout and order placement using manual UPI payment flow.

Customer flow:
- Customer enters contact details and delivery address.
- Customer sees UPI ID, QR code, and payable amount.
- Customer enters UPI transaction/reference ID.
- Order is created with payment pending status.

Admin flow:
- Admin receives order details.
- Admin can verify payment from admin panel.
- Once payment is verified, order status updates.

Email flow:
- Send order email to customer and admin before payment confirmation.
- Send confirmation email to customer after admin verifies payment.
```

Acceptance criteria:

- Guest and logged-in customers can place orders.
- Manual UPI reference is saved.
- Admin can verify payment.
- Customer order tracking reflects current payment status.
- Customer and admin email templates are consistent with the brand.

## Prompt 6: Shipping Logic

```text
Update checkout shipping logic.

Rules:
- Shipping fee is Rs. 99 when order value is below Rs. 2000.
- Shipping is free when order value is Rs. 2000 or above.
- Shipping fee should not be hardcoded in many places.

Add a small note on the checkout page explaining the free shipping threshold.
```

Acceptance criteria:

- Cart and checkout totals calculate shipping consistently.
- Rs. 99 shipping applies below Rs. 2000.
- Free shipping applies at Rs. 2000 and above.
- Checkout page clearly explains the rule.

## Prompt 7: Supabase Migration

```text
Migrate the app from SQLite/local database to Supabase Postgres.

Update:
- Database connection
- Schema initialization
- Query layer
- Product APIs
- User APIs
- Order APIs
- Session/password reset storage
- Admin login flow

Use environment variables for Supabase/Postgres connection strings.

Verify that products, users, orders, sessions, password reset, and admin login work with Supabase.
```

Acceptance criteria:

- App starts with Supabase database connection.
- Tables are created or migrated correctly.
- Existing product/order/user flows work.
- Admin login works without ID type errors.
- Production deployment can connect to Supabase pooler URL.

## Prompt 8: Admin Sales Dashboard

```text
Create an admin dashboard for sales and business tracking.

Add:
- Overall sales summary
- Product-level sales summary
- Product dropdown
- Daily/weekly/monthly/yearly sales graphs
- Recent 5 orders
- Logistics status summary
- Stock sold
- Stock remaining
- Revenue

Keep Inventory Management, Site Content, and Settings sections intact.

Recent orders and logistics should show only the latest 5 on the dashboard. Add a separate page/button to view all orders while retaining actions like verify manual UPI payment and update fulfillment status.
```

Acceptance criteria:

- Dashboard separates overall sales from individual product sales.
- Product dropdown filters only that product's data.
- All-orders page exists for full order management.
- Recent dashboard list is limited to 5 records.
- Admin can still verify payments and update fulfillment status.

## Prompt 9: Shiprocket Mock And Production Split

```text
Add logistics support with Shiprocket.

For test/dev:
- Use mock Shiprocket responses.
- Admin can manually update shipping status.
- Support happy path and edge cases for logistics testing.

For production:
- Use real Shiprocket API credentials and live responses.
- Keep mock behavior disabled in production.

Make sure test mock logic does not break production logistics integration.
```

Acceptance criteria:

- Test environment can simulate serviceability, shipment creation, tracking, and failures.
- Production environment is controlled by real credentials/config.
- Admin can see and update logistics status.
- No mock response is used in production unless explicitly configured.

## Prompt 10: Product Color Variants

```text
Add product color variants.

Admin behavior:
- Admin can decide whether a product has multiple colors.
- For each color, admin can set label, stock, and image.
- If product has no color variants, it should display as before.

Customer behavior:
- Customer sees color options on the product tile/detail page.
- Selecting a color updates the product image.
- Cart stores the selected color.
- On refresh/new session, default product color should display first.
```

Acceptance criteria:

- Products without colors are unaffected.
- Products with colors show a selector.
- Selected color image appears immediately.
- Cart and order preserve selected color.

## Prompt 11: Multiple Product Photos

```text
Add support for multiple photos per product.

Admin behavior:
- Admin can upload multiple photos for a product.
- Admin can paste multiple Cloudinary image URLs.
- Admin can choose which photo should be the default cover photo.
- Admin can remove photos from a product gallery.

Customer behavior:
- If a product has multiple photos, customer can swipe or click arrows to move between images.
- Multiple photos should appear under the same product tile and product detail page.
- Existing single-image products should continue to work as before.
```

Acceptance criteria:

- Product model supports multiple image URLs.
- Admin can manage gallery images.
- Customer can navigate product images.
- Default image is used first on fresh page load.

## Prompt 12: Custom Bouquet Builder

```text
Create a custom bouquet builder.

Customer behavior:
- Customer can select flower sticks and colors.
- Flower/color choices should be selectable highlighted buttons.
- Customer can preview a bouquet arrangement.
- Customer can reset and try again.
- Customer can get an estimated price based on selected flower prices.

Visual expectation:
- Use a realistic bouquet-style preview based on uploaded bouquet references.
- Show flower sticks with stems, not just flower heads.
- Add this as a separate category/section alongside Keychains and Flowers.
```

Acceptance criteria:

- Bouquet builder appears as its own section/category.
- Customer can select, preview, estimate, and reset.
- Estimate uses existing product prices.
- Preview is more realistic than abstract icons.

## Prompt 13: Prebooking Out-Of-Stock Products

```text
When a product is out of stock, allow customers to prebook it.

Flow:
- Customer pays 50% advance amount.
- Order is marked as prebooked/advance paid.
- Once admin marks stock available, notify the customer.
- Customer pays remaining balance.
- After full payment, continue normal fulfillment and shipping flow.
```

Acceptance criteria:

- Out-of-stock products show prebook option.
- Advance amount is calculated as 50%.
- Admin can identify prebooked orders.
- Customer gets notified when balance payment is required.
- Order moves to normal processing after balance payment confirmation.

## Prompt 14: Photo Magnets

```text
Add a new product category called Photo Magnets.

Products:
- 9 x 6 cm photo magnet at Rs. 140 each for bulk quantity
- 10 x 7.5 cm photo magnet at Rs. 165 each for bulk quantity
- 8 x 8 cm photo magnet at Rs. 165 each for bulk quantity

Use provided sample magnet photos as references.

Prepare clean product images:
- Remove distracting/unwanted elements from the frame where possible.
- Replace sample personal photos with realistic generic photos such as vacation, family, friends, or baby photos.
- Avoid animated-looking images.
- Avoid black stripes or opaque overlays on the photos.

Create three product tiles and connect them to the existing order/payment flow.
```

Acceptance criteria:

- Photo Magnets category appears beside other categories.
- Three magnet products appear with correct sizes and prices.
- Product images are clean and realistic.
- Products use the existing cart and checkout flow.

## Prompt 15: Deployment And Clean URLs

```text
Prepare the app for production deployment.

Requirements:
- Deploy on Render.
- Use Supabase for database.
- Use Cloudinary for images.
- Use environment variables for all secrets.
- Configure BASE_URL for production.
- Add custom domain support.
- Remove visible .html extensions from customer/admin routes.

Expected URLs:
- https://nikaartscreations.com/
- https://nikaartscreations.com/shop
- https://nikaartscreations.com/admin
- https://nikaartscreations.com/track-order
- https://nikaartscreations.com/account

Run smoke tests after deployment.
```

Acceptance criteria:

- Production app starts successfully.
- Clean URLs work without .html extension.
- Domain points to the correct service.
- Products and Cloudinary images load in production.
- Admin login works in production.

## Prompt 16: Documentation And Handover

```text
Create clear documentation for the business admin/end user.

Include:
- Website architecture
- Customer website overview
- Admin website overview
- Product upload process
- Cloudinary image upload process
- CSV bulk upload process
- Order management process
- Manual UPI payment verification process
- Sales dashboard usage
- Shipping/logistics workflow
- Customer account/password reset flow
- Environment variable reference
- What has been completed
- What is still pending

Make it visual where possible using diagrams, workflows, tables, and short step-by-step instructions instead of long paragraphs.
```

Acceptance criteria:

- Admin can understand daily operations without developer help.
- Technical details are mild but useful.
- Documentation matches the current production flow.
- Outdated local-storage/old-code instructions are removed.

## Prompt 17: Production Maintenance And Smoke Testing

```text
Run a production smoke test and report anomalies.

Test:
- Home page
- Product listing
- Product images from Cloudinary
- Category filters
- Product detail page
- Cart
- Checkout
- Manual UPI order placement
- Admin login
- Admin inventory
- Payment verification
- Order tracking
- Email notification path

Do not make major code changes unless a defect is found. If defects are found, fix them with minimal scoped changes and explain the cause.
```

Acceptance criteria:

- Important customer and admin flows are checked.
- Any anomaly is listed with impact and suggested fix.
- Critical issues are fixed before production use.

## Suggested Commit Strategy

Use one commit per stable milestone:

1. MVP website foundation
2. Cloudinary media upload
3. Admin inventory improvements
4. Authentication and password reset
5. Manual UPI checkout and emails
6. Supabase migration
7. Dashboard and reporting
8. Shiprocket mock/live split
9. Product color variants
10. Multiple product photos
11. Custom bouquet builder
12. Prebooking
13. Photo magnets
14. Clean URLs and deployment
15. Documentation

## Prompting Checklist

Before sending any new prompt, include:

- Business goal
- Customer behavior
- Admin behavior
- Data that should be stored
- UI expectations
- Edge cases
- What should not break
- Testing expectation
- Whether a preview is needed before commit
- Whether to commit to `dev`, `main`, or both

