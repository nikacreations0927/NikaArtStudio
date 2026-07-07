from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Flowable,
    Frame,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs"
OUT_DIR.mkdir(exist_ok=True)
PDF_PATH = OUT_DIR / "Nika_Arts_Studio_Project_Management_Dashboard.pdf"

INK = colors.HexColor("#19351f")
LEAF = colors.HexColor("#6d7f5f")
GOLD = colors.HexColor("#d0a520")
CREAM = colors.HexColor("#fbfaf4")
MIST = colors.HexColor("#eef4ec")
BORDER = colors.HexColor("#d9d2bf")
RED = colors.HexColor("#9f2d2d")
BLUE = colors.HexColor("#2d5f85")
GRAY = colors.HexColor("#6c6c6c")


def status_color(value: str):
    value = value.lower()
    if "done" in value:
        return colors.HexColor("#dcefe3")
    if "partial" in value or "active" in value:
        return colors.HexColor("#fff0c8")
    if "pending" in value:
        return colors.HexColor("#f8dddd")
    return colors.white


class SectionBand(Flowable):
    def __init__(self, title: str, subtitle: str = ""):
        super().__init__()
        self.title = title
        self.subtitle = subtitle
        self.height = 0.72 * inch if subtitle else 0.52 * inch

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        return availWidth, self.height

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(MIST)
        c.setStrokeColor(BORDER)
        c.roundRect(0, 0, self.width, self.height, 8, stroke=1, fill=1)
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 15)
        c.drawString(16, self.height - 24, self.title)
        if self.subtitle:
            c.setFont("Helvetica", 8.5)
            c.setFillColor(LEAF)
            c.drawString(16, self.height - 42, self.subtitle)
        c.restoreState()


class EffortBars(Flowable):
    def __init__(self, data):
        super().__init__()
        self.data = data
        self.height = 1.72 * inch

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        return availWidth, self.height

    def draw(self):
        c = self.canv
        max_value = max(v for _, v, _ in self.data)
        left = 12
        label_w = 132
        bar_w = self.width - label_w - 76
        y = self.height - 22
        palette = [INK, GOLD, BLUE, LEAF, RED]
        c.saveState()
        c.setFont("Helvetica-Bold", 10)
        c.setFillColor(INK)
        c.drawString(left, y + 12, "Estimated effort by work type")
        y -= 14
        for idx, (label, hours, share) in enumerate(self.data):
            c.setFont("Helvetica", 8.5)
            c.setFillColor(INK)
            c.drawString(left, y, label)
            c.setFillColor(colors.HexColor("#ede8dc"))
            c.roundRect(left + label_w, y - 3, bar_w, 9, 4, stroke=0, fill=1)
            c.setFillColor(palette[idx % len(palette)])
            c.roundRect(left + label_w, y - 3, bar_w * hours / max_value, 9, 4, stroke=0, fill=1)
            c.setFillColor(GRAY)
            c.drawRightString(self.width - 12, y, f"{hours}h / {share}")
            y -= 21
        c.restoreState()


class Timeline(Flowable):
    def __init__(self, items):
        super().__init__()
        self.items = items
        self.height = 2.55 * inch

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        return availWidth, self.height

    def draw(self):
        from datetime import date

        c = self.canv
        start = date(2026, 5, 24)
        end = date(2026, 6, 13)
        total = (end - start).days + 1
        left = 112
        right = self.width - 18
        top = self.height - 24
        usable = right - left
        c.saveState()
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(12, top + 10, "Delivery timeline: 24 May to 13 June 2026")
        c.setFont("Helvetica", 7.5)
        for d, label in [(date(2026, 5, 24), "24 May"), (date(2026, 5, 29), "29 May"), (date(2026, 6, 3), "03 Jun"), (date(2026, 6, 8), "08 Jun"), (date(2026, 6, 13), "13 Jun")]:
            x = left + usable * ((d - start).days / (total - 1))
            c.setStrokeColor(BORDER)
            c.line(x, 18, x, top)
            c.setFillColor(GRAY)
            c.drawCentredString(x, 8, label)

        palette = [INK, GOLD, BLUE, LEAF, RED]
        y = top - 18
        for idx, (label, s, dur, state) in enumerate(self.items):
            x = left + usable * ((s - start).days / (total - 1))
            w = max(18, usable * dur / total)
            c.setFont("Helvetica", 7.5)
            c.setFillColor(INK)
            c.drawRightString(left - 8, y, label[:28])
            c.setFillColor(status_color(state))
            c.setStrokeColor(BORDER)
            c.roundRect(x, y - 5, w, 10, 4, stroke=1, fill=1)
            c.setFillColor(palette[idx % len(palette)])
            c.roundRect(x, y - 5, min(w, w * 0.98), 10, 4, stroke=0, fill=1)
            y -= 14
        c.restoreState()


class ArchitectureDiagram(Flowable):
    def __init__(self):
        super().__init__()
        self.height = 2.45 * inch

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        return availWidth, self.height

    def box(self, c, x, y, w, h, text, fill):
        c.setFillColor(fill)
        c.setStrokeColor(BORDER)
        c.roundRect(x, y, w, h, 7, stroke=1, fill=1)
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 8.3)
        c.drawCentredString(x + w / 2, y + h / 2 - 3, text)

    def arrow(self, c, x1, y1, x2, y2):
        c.setStrokeColor(LEAF)
        c.setLineWidth(1)
        c.line(x1, y1, x2, y2)

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(12, self.height - 14, "Current production architecture")

        y1, y2, y3 = 110, 62, 14
        self.box(c, 18, y1, 105, 30, "Customer browser", CREAM)
        self.box(c, 18, y2, 105, 30, "Admin browser", CREAM)
        self.box(c, 158, y1, 108, 30, "Storefront UI", MIST)
        self.box(c, 158, y2, 108, 30, "Admin panel", MIST)
        self.box(c, 306, 86, 124, 34, "Express API", colors.HexColor("#fff7df"))
        self.box(c, 470, 120, 110, 28, "Supabase DB", colors.HexColor("#e8f2ff"))
        self.box(c, 470, 84, 110, 28, "Cloudinary", colors.HexColor("#eef4ec"))
        self.box(c, 470, 48, 110, 28, "Email service", colors.HexColor("#fff0c8"))
        self.box(c, 470, 12, 110, 28, "UPI/Shiprocket", colors.HexColor("#f8dddd"))

        for sy in [y1 + 15, y2 + 15]:
            self.arrow(c, 123, sy, 158, sy)
            self.arrow(c, 266, sy, 306, 103)
        for ty in [134, 98, 62, 26]:
            self.arrow(c, 430, 103, 470, ty)
        c.restoreState()


def p(text: str, style):
    return Paragraph(text, style)


def table(data, widths, style, repeat_rows=1):
    return Table(data, colWidths=widths, repeatRows=repeat_rows, hAlign="LEFT", style=style)


def make_styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle("TitleNika", fontName="Helvetica-Bold", fontSize=25, leading=29, textColor=INK, spaceAfter=8))
    ss.add(ParagraphStyle("SubtitleNika", fontName="Helvetica", fontSize=10.5, leading=14, textColor=LEAF, spaceAfter=12))
    ss.add(ParagraphStyle("H1Nika", fontName="Helvetica-Bold", fontSize=14.5, leading=18, textColor=INK, spaceBefore=12, spaceAfter=7))
    ss.add(ParagraphStyle("H2Nika", fontName="Helvetica-Bold", fontSize=11.5, leading=14, textColor=INK, spaceBefore=8, spaceAfter=5))
    ss.add(ParagraphStyle("BodyNika", fontName="Helvetica", fontSize=8.7, leading=11.5, textColor=colors.HexColor("#243626"), spaceAfter=5))
    ss.add(ParagraphStyle("SmallNika", fontName="Helvetica", fontSize=7.2, leading=9, textColor=colors.HexColor("#243626")))
    ss.add(ParagraphStyle("SmallCenter", fontName="Helvetica", fontSize=7.2, leading=9, textColor=colors.HexColor("#243626"), alignment=TA_CENTER))
    ss.add(ParagraphStyle("TableHead", fontName="Helvetica-Bold", fontSize=7.2, leading=8.5, textColor=INK, alignment=TA_LEFT))
    ss.add(ParagraphStyle("TableCell", fontName="Helvetica", fontSize=6.7, leading=8.2, textColor=colors.HexColor("#243626"), alignment=TA_LEFT))
    ss.add(ParagraphStyle("TableCellCenter", fontName="Helvetica", fontSize=6.7, leading=8.2, textColor=colors.HexColor("#243626"), alignment=TA_CENTER))
    ss.add(ParagraphStyle("TableCellRight", fontName="Helvetica", fontSize=6.7, leading=8.2, textColor=colors.HexColor("#243626"), alignment=TA_RIGHT))
    return ss


def para_table_rows(rows, styles, center_cols=(), right_cols=()):
    out = []
    for r, row in enumerate(rows):
        cells = []
        for i, value in enumerate(row):
            style = styles["TableHead"] if r == 0 else styles["TableCell"]
            if r > 0 and i in center_cols:
                style = styles["TableCellCenter"]
            if r > 0 and i in right_cols:
                style = styles["TableCellRight"]
            cells.append(p(str(value), style))
        out.append(cells)
    return out


def main():
    styles = make_styles()
    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=landscape(letter),
        leftMargin=0.42 * inch,
        rightMargin=0.42 * inch,
        topMargin=0.42 * inch,
        bottomMargin=0.42 * inch,
        title="Nika Arts Studio Project Management Dashboard",
        author="Nika Arts Studio / Codex",
    )

    base_table = TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.35, BORDER),
        ("BACKGROUND", (0, 0), (-1, 0), MIST),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ])
    story_table_style = TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.28, BORDER),
        ("BACKGROUND", (0, 0), (-1, 0), MIST),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ])

    story = []
    story.append(p("Nika Arts Studio", styles["TitleNika"]))
    story.append(p("Project Management Dashboard", styles["H1Nika"]))
    story.append(p("Project window: 24 May 2026 to 13 June 2026 &nbsp; | &nbsp; Delivery model: Codex-assisted build, test, deployment, and production support", styles["SubtitleNika"]))
    story.append(SectionBand("Executive Dashboard", "Current production status and business outcomes"))
    exec_rows = [
        ["Area", "Status", "Business outcome"],
        ["Customer storefront", "Done", "Browse products, view details, choose colors, build custom bouquets, add to cart, and place manual UPI orders."],
        ["Admin operations", "Done", "Manage products, stock, images, categories, orders, payment verification, dashboard metrics, and site content."],
        ["Cloud storage", "Done", "Product, logo, hero, and artist images moved from local storage to Cloudinary."],
        ["Database", "Done", "SQLite migrated to Supabase Postgres for production data."],
        ["Payments", "Partial", "Manual UPI implemented. PhonePe paused until business account approval."],
        ["Shipping", "Partial", "Shiprocket mock/test support implemented; live use pending final account/pickup verification."],
        ["Production hosting", "Done", "GitHub + Render + custom domain flow established."],
    ]
    story.append(table(para_table_rows(exec_rows, styles, center_cols=(1,)), [1.4 * inch, 0.75 * inch, 7.6 * inch], base_table))
    story.append(Spacer(1, 0.14 * inch))

    effort = [
        ("Coding/development", 62, "42%"),
        ("Environment setup", 24, "16%"),
        ("Testing/QA", 31, "21%"),
        ("Production maintenance", 20, "14%"),
        ("Documentation", 10, "7%"),
    ]
    story.append(EffortBars(effort))
    story.append(Spacer(1, 0.08 * inch))

    from datetime import date
    story.append(Timeline([
        ("Foundation fixes", date(2026, 5, 24), 2, "done"),
        ("Cloudinary + products", date(2026, 5, 25), 5, "done"),
        ("Admin auth", date(2026, 5, 27), 3, "done"),
        ("Customer auth", date(2026, 5, 28), 3, "done"),
        ("Manual UPI", date(2026, 5, 29), 4, "done"),
        ("Sales dashboard", date(2026, 5, 30), 3, "done"),
        ("Pre-booking", date(2026, 5, 31), 3, "done"),
        ("Supabase migration", date(2026, 6, 1), 4, "done"),
        ("Clean URLs/home polish", date(2026, 6, 4), 3, "done"),
        ("Order emails", date(2026, 6, 8), 3, "partial"),
        ("Product colors", date(2026, 6, 10), 3, "done"),
        ("Flowers/bouquet builder", date(2026, 6, 12), 2, "done"),
    ]))
    story.append(PageBreak())

    story.append(SectionBand("Architecture Snapshot", "How customer/admin experiences connect to services"))
    story.append(ArchitectureDiagram())
    epic_rows = [
        ["Epic", "Objective", "Status", "Key acceptance criteria"],
        ["E1. Storefront foundation", "Build customer-facing shopping website.", "Done", "Clean URLs, products from API, mobile-friendly browsing, cart and checkout available."],
        ["E2. Cloud image management", "Move product and site images to free cloud storage.", "Done", "Cloudinary uploads work and storefront/admin load cloud URLs."],
        ["E3. Admin inventory operations", "Give layman admin a clean catalog manager.", "Done", "Add, edit, hide, delete, search, filter, import/export, and stock update work."],
        ["E4. Authentication and security", "Secure admin/customer access.", "Done", "Login/logout/password reset/change work; passwords are hashed."],
        ["E5. Supabase migration", "Replace local SQLite with hosted Postgres.", "Done", "Products, customers, orders, sessions, categories, and settings persist in Supabase."],
        ["E6. Manual UPI order flow", "Enable payments before PhonePe approval.", "Done", "Customer submits UPI reference; admin confirms payment before paid status."],
        ["E7. Order communication", "Notify customer/admin by email.", "Partial", "Templates and confirmation links exist; production provider validation remains."],
        ["E8. Shipping/logistics", "Prepare Shiprocket integration.", "Partial", "Mock mode works; live credentials/pickup final verification pending."],
        ["E9. Admin dashboard/reporting", "Provide sales visibility.", "Done", "Overall/product-level sales, recent orders, and all-orders page available."],
        ["E10. Pre-booking", "Reserve out-of-stock products.", "Done", "Half-price advance, balance payment after stock restore, then shipping."],
        ["E11. Product variants", "Support color choices.", "Done", "Admin color/image setup and customer-selected image switching."],
        ["E12. Custom bouquet builder", "Let customers compose bouquets.", "Done", "Separate category, selectable flower sticks, realistic preview, reset, and estimate."],
        ["E13. Production operations", "Make deployment maintainable.", "Done", "GitHub/Render/domain/env documentation and branch flow established."],
    ]
    story.append(table(para_table_rows(epic_rows, styles, center_cols=(2,)), [1.6 * inch, 2.0 * inch, 0.65 * inch, 5.45 * inch], base_table))
    story.append(PageBreak())

    story.append(SectionBand("User Story Register", "Detailed story breakdown with effort and acceptance criteria"))
    stories = [
        ["US-001", "E1", "Home page introduces Nika Arts Studio and links to shop/about/contact.", "P1", "Dev + QA", "5", "Done", "Home loads with Cloudinary hero/logo assets and clear navigation."],
        ["US-002", "E1", "Browse all products and filter by category.", "P1", "Dev", "5", "Done", "Shop loads products from API; category filters work."],
        ["US-003", "E1", "Clean URLs without .html.", "P2", "Dev + prod", "3", "Done", "/, /shop, /admin, /track-order route correctly."],
        ["US-004", "E1", "Mobile-friendly product cards.", "P1", "QA + frontend", "3", "Done", "Buttons fit; detail back link returns to selected category."],
        ["US-005", "E2", "Store product images in Cloudinary.", "P1", "Env + dev", "8", "Done", "Uploads return URLs and images load in admin/storefront."],
        ["US-006", "E2", "Bulk upload Cloudinary products by CSV.", "P1", "Dev + QA", "8", "Done", "CSV template/import works; duplicate cleanup is possible."],
        ["US-007", "E2", "Load logo/artist images from Cloudinary.", "P2", "Dev", "3", "Done", "Site assets are configurable and cloud-hosted."],
        ["US-008", "E3", "Compact admin inventory view.", "P1", "Frontend + QA", "5", "Done", "Search, filters, sorting, aligned action buttons."],
        ["US-009", "E3", "Remove duplicate/old products.", "P1", "Backend + QA", "5", "Done", "Delete works for manual and CSV products with in-house confirmation."],
        ["US-010", "E3", "Smaller edit stock modal.", "P2", "Frontend QA", "2", "Done", "Save button reachable without relying on Enter key."],
        ["US-011", "E4", "Secure admin login/logout.", "P1", "Backend + security", "8", "Done", "Seeded admin, hashed password, server-side sessions."],
        ["US-012", "E4", "Admin password management.", "P1", "Backend + QA", "5", "Done", "Admin can change password; old password fails."],
        ["US-013", "E4", "Customer signup/login/logout.", "P1", "Backend + UI", "8", "Done", "Customer can register, login, logout, and view account/orders."],
        ["US-014", "E4", "Customer forgot/reset password.", "P1", "Backend + email", "8", "Done", "Tokenized reset links use BASE_URL."],
        ["US-015", "E5", "Cloud database storage.", "P1", "Env + backend", "13", "Done", "Supabase pooler works; data persists after deploy."],
        ["US-016", "E5", "Migration tests.", "P1", "QA", "5", "Done", "Smoke scripts validate products/auth/checkout initiation."],
        ["US-017", "E6", "Manual UPI checkout.", "P1", "Backend + UI", "8", "Done", "UPI ID/QR/reference captured; pending order created."],
        ["US-018", "E6", "Admin payment verification.", "P1", "Backend + admin", "8", "Done", "Confirmation screen updates payment/order status."],
        ["US-019", "E7", "Customer order emails.", "P1", "Email + QA", "5", "Partial", "Template exists; production provider validation remains."],
        ["US-020", "E7", "Admin order notification emails.", "P1", "Email + admin", "5", "Partial", "Admin email includes order details and confirm link."],
        ["US-021", "E8", "Shiprocket testing without live charges.", "P1", "Backend + test env", "5", "Done", "Mock serviceability/order/tracking responses available."],
        ["US-022", "E8", "Live Shiprocket fulfillment.", "P1", "Env + prod", "8", "Pending", "Live serviceability, AWB, and tracking verified."],
        ["US-023", "E9", "Overall sales dashboard.", "P1", "Dashboard dev", "5", "Done", "Overall sales separated from individual product sales."],
        ["US-024", "E9", "Product-level sales reports.", "P1", "Backend + UI", "5", "Done", "Dropdown filters metrics to selected product only."],
        ["US-025", "E9", "Recent orders and all-orders page.", "P2", "Full stack", "5", "Done", "Latest 5 on dashboard; full page retains admin actions."],
        ["US-026", "E10", "Pre-book out-of-stock products.", "P2", "Business logic", "8", "Done", "Half-price advance and pending balance recorded."],
        ["US-027", "E10", "Notify when stock returns.", "P2", "Email + status", "5", "Done", "Balance flow available after stock restore."],
        ["US-028", "E11", "Admin adds product colors.", "P1", "Data + admin UI", "8", "Done", "Multi-color flag, color names/images, default behavior."],
        ["US-029", "E11", "Customer image changes by color.", "P1", "Frontend QA", "5", "Done", "Selected color updates image; refresh returns to default."],
        ["US-030", "E12", "Build custom bouquet.", "P2", "Frontend + logic", "8", "Done", "Select, visualize, reset, and estimate from product prices."],
        ["US-031", "E12", "Realistic bouquet preview.", "P2", "Visual QA", "5", "Done", "Reference bouquet image and full-stick overlays used."],
        ["US-032", "E13", "GitHub source of truth.", "P1", "DevOps", "5", "Done", "Main branch contains production code; Render deploys from GitHub."],
        ["US-033", "E13", "Production env documentation.", "P1", "Docs", "3", "Done", "Required env vars listed in README."],
        ["US-034", "E13", "Admin/end-user guide.", "P2", "Docs", "5", "Done", "Guide covers operations, privileges, pending tasks, troubleshooting."],
    ]
    header = ["ID", "Epic", "Story", "Pri", "Effort", "Pts", "Status", "Acceptance criteria"]
    chunk_size = 12
    for i in range(0, len(stories), chunk_size):
        rows = [header] + stories[i:i + chunk_size]
        story.append(table(para_table_rows(rows, styles, center_cols=(0, 1, 3, 5, 6), right_cols=(5,)), [0.48 * inch, 0.42 * inch, 2.65 * inch, 0.34 * inch, 0.75 * inch, 0.34 * inch, 0.56 * inch, 4.16 * inch], story_table_style))
        if i + chunk_size < len(stories):
            story.append(PageBreak())
            story.append(SectionBand("User Story Register", "Continued"))
    story.append(PageBreak())

    story.append(SectionBand("Acceptance Criteria by Epic", "Definition of successful delivery"))
    epic_acceptance = {
        "E1. Storefront Foundation": ["Root domain opens the site.", "Shop/product/cart/checkout/success/account/track pages work without .html.", "Products are API-driven.", "Mobile and desktop layouts remain usable."],
        "E2. Cloud Image Management": ["Credentials stay in env variables.", "Product images upload to Cloudinary.", "Logo/hero/artist images load from cloud.", "Broken images degrade gracefully."],
        "E3. Admin Inventory Operations": ["Admin can create, edit, hide, delete, search, filter, import/export.", "Duplicate products can be removed.", "Inventory remains usable as catalog grows.", "Edit modal fits smaller screens."],
        "E4. Authentication and Security": ["Passwords are hashed.", "Sessions expire.", "Password reset uses tokenized BASE_URL links.", "Errors do not leak sensitive details."],
        "E5. Supabase Migration": ["Core tables exist in Postgres.", "Migration is repeatable and safe.", "Render uses Supabase pooler.", "Smoke tests prove data is available."],
        "E6. Manual UPI Order Flow": ["Guest/logged-in checkout works.", "No sensitive UPI PIN/card data collected.", "Order stays pending until admin verifies.", "Verification updates order/payment status."],
        "E7. Order Communication": ["Customer and admin templates include order details.", "Admin link can confirm payment.", "Provider failures are logged.", "Production sender/domain is validated."],
        "E8. Shipping and Logistics": ["Test uses mock mode.", "Production uses live mode only when configured.", "Admin can update fulfillment.", "Customer tracking reflects progress."],
        "E9. Admin Dashboard and Reporting": ["Overall and product sales are separate.", "Dropdown filters product metrics.", "Recent orders limited to 5.", "All-orders page keeps actions."],
        "E10. Pre-Booking": ["Out-of-stock shows pre-book.", "Advance is half price.", "Balance is payable after restock.", "Shipping waits for full payment."],
        "E11. Product Variants": ["Admin controls multi-color flag.", "Selector appears only for multi-color products.", "Image/cart/order respect selected color.", "Default color returns on fresh load."],
        "E12. Custom Bouquet Builder": ["Category appears separately.", "Selections are highlighted.", "Preview/reset can be repeated.", "Estimate uses selected flower prices.", "Preview looks bouquet-like."],
        "E13. Production Operations": ["Changes are pushed through GitHub.", "Render env vars are documented.", "DNS/domain setup is documented.", "Pending integrations are clearly tracked."],
    }
    acceptance_rows = [["Epic", "Acceptance criteria"]]
    for title, checks in epic_acceptance.items():
        acceptance_rows.append([title, "<br/>".join(f"- {item}" for item in checks)])
    story.append(table(para_table_rows(acceptance_rows, styles), [2.15 * inch, 7.55 * inch], base_table))
    story.append(PageBreak())

    story.append(SectionBand("Risks, Backlog, and Sprint Mapping", "Operational items that still need attention"))
    risk_rows = [
        ["Risk", "Probability", "Impact", "Mitigation"],
        ["Email delivery works in test but not production", "Medium", "High", "Validate Resend domain/sender, keep Gmail fallback optional, log provider failures."],
        ["Shiprocket live setup incomplete", "Medium", "High", "Keep mock mode in test; validate pickup and serviceability before live mode."],
        ["PhonePe business approval delayed", "High", "Medium", "Continue manual UPI until account and website verification are complete."],
        ["Supabase/provider account lockout", "Medium", "High", "Maintain recovery codes, backup owner access, and DB export routine."],
        ["Render free tier cold starts", "High", "Medium", "Accept early stage; upgrade when volume grows."],
    ]
    story.append(table(para_table_rows(risk_rows, styles, center_cols=(1, 2)), [3.0 * inch, 0.9 * inch, 0.75 * inch, 5.05 * inch], base_table))
    story.append(Spacer(1, 0.08 * inch))
    backlog_rows = [
        ["Backlog item", "Priority", "Acceptance criteria"],
        ["Complete Shiprocket live order creation", "P1", "Paid order creates shipment, stores AWB/tracking, and updates customer tracking."],
        ["Complete production email provider validation", "P1", "Customer/admin receive real production emails for order placed and payment confirmed."],
        ["PhonePe integration after business approval", "P2", "PhonePe verifies website and callbacks reconcile payment status."],
        ["Supabase backup/export process", "P1", "Weekly manual or automated export is documented and tested."],
        ["Admin audit log", "P2", "Product/order/payment changes show actor, timestamp, old/new values."],
        ["Bulk stock editor", "P2", "Admin updates stock for many products from one screen."],
    ]
    story.append(table(para_table_rows(backlog_rows, styles, center_cols=(1,)), [3.25 * inch, 0.7 * inch, 5.75 * inch], base_table))
    story.append(Spacer(1, 0.08 * inch))
    sprint_rows = [
        ["Sprint", "Dates", "Theme", "Main deliverables"],
        ["Sprint 1", "24-28 May", "Foundation and cloud migration", "Storefront review, Cloudinary image flow, admin inventory, admin auth."],
        ["Sprint 2", "29 May-02 Jun", "Commerce and database hardening", "Customer auth, manual UPI, order tracking, sales dashboard, Supabase migration."],
        ["Sprint 3", "03-08 Jun", "Production readiness", "GitHub/Render/domain recovery, clean URLs, README/admin guide, email templates."],
        ["Sprint 4", "09-13 Jun", "Catalog growth and advanced UX", "Product colors, flower category, custom bouquet builder, mobile/category fixes."],
    ]
    story.append(table(para_table_rows(sprint_rows, styles, center_cols=(0, 1)), [1.0 * inch, 1.05 * inch, 2.1 * inch, 5.55 * inch], base_table))
    story.append(Spacer(1, 0.08 * inch))
    story.append(p("<b>Definition of done:</b> code committed to correct branch, environment documented, UI previewed when visual, happy path and edge cases tested, production impact understood, and docs updated when operational behavior changes.", styles["BodyNika"]))

    def on_page(canvas, doc_obj):
        canvas.saveState()
        canvas.setFillColor(INK)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.drawString(doc_obj.leftMargin, 0.22 * inch, "Nika Arts Studio - Project Management Dashboard")
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(GRAY)
        canvas.drawRightString(landscape(letter)[0] - doc_obj.rightMargin, 0.22 * inch, f"Page {doc_obj.page}")
        canvas.setStrokeColor(GOLD)
        canvas.setLineWidth(0.7)
        canvas.line(doc_obj.leftMargin, 0.36 * inch, landscape(letter)[0] - doc_obj.rightMargin, 0.36 * inch)
        canvas.restoreState()

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(PDF_PATH)


if __name__ == "__main__":
    main()
