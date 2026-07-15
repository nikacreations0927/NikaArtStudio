const nodemailer = require('nodemailer');
const { nextDiscountMessage } = require('./discounts');

const BRAND = {
  green: '#1A2E1A',
  muted: '#6B7A5E',
  gold: '#C9A227',
  goldDark: '#A8851E',
  cream: '#FAFAF5',
  creamAlt: '#F2F0E8',
  border: '#DDD9C8',
  white: '#FFFFFF'
};
const EMAIL_SEND_TIMEOUT_MS = Number(process.env.EMAIL_SEND_TIMEOUT_MS || 30000);
const RESEND_API_URL = 'https://api.resend.com/emails';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  connectionTimeout: EMAIL_SEND_TIMEOUT_MS,
  greetingTimeout: EMAIL_SEND_TIMEOUT_MS,
  socketTimeout: EMAIL_SEND_TIMEOUT_MS,
  auth: {
    user: process.env.EMAIL_USER || 'your.nika.arts.email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-16-digit-app-password'
  }
});

function hasEmailConfig() {
  return hasResendConfig() || hasSmtpConfig();
}

function hasSmtpConfig() {
  return Boolean(
    process.env.EMAIL_USER &&
    process.env.EMAIL_PASS &&
    !String(process.env.EMAIL_USER).startsWith('your.') &&
    !String(process.env.EMAIL_PASS).startsWith('your-')
  );
}

function hasResendConfig() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

function emailProviderStatus() {
  return {
    configured: hasEmailConfig(),
    primaryProvider: hasResendConfig() ? 'resend' : hasSmtpConfig() ? 'gmail_smtp' : 'none',
    resendConfigured: hasResendConfig(),
    smtpConfigured: hasSmtpConfig(),
    emailUserPresent: Boolean(process.env.EMAIL_USER),
    emailPassPresent: Boolean(process.env.EMAIL_PASS),
    resendApiKeyPresent: Boolean(process.env.RESEND_API_KEY),
    resendFromEmailPresent: Boolean(process.env.RESEND_FROM_EMAIL),
    fromDomain: process.env.RESEND_FROM_EMAIL
      ? String(process.env.RESEND_FROM_EMAIL).split('@').pop().replace(/[>]/g, '')
      : String(process.env.EMAIL_USER || '').includes('@')
        ? String(process.env.EMAIL_USER).split('@').pop()
        : '',
    notificationEmail: adminNotificationEmail()
  };
}

function rupees(value) {
  return 'Rs. ' + Number(value || 0).toLocaleString('en-IN');
}

function siteUrl(path = '') {
  return `${String(process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')}${path}`;
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

function customerName(customer = {}) {
  return `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Customer';
}

function trackingLink(orderId) {
  return siteUrl(`/track-order?order=${encodeURIComponent(orderId)}`);
}

function adminConfirmLink(orderId) {
  return siteUrl(`/admin/confirm-payment?order=${encodeURIComponent(orderId)}`);
}

function adminNotificationEmail() {
  return process.env.ORDER_NOTIFICATION_EMAIL || 'nika.creations0927@gmail.com';
}

function orderItemsTable(order = {}) {
  const rows = (order.items || []).map(item => `
    <tr>
      <td style="padding: 12px 10px; border-bottom: 1px solid ${BRAND.border};">
        <strong style="color:${BRAND.green};">${escapeHtml(item.name)}</strong><br>
        ${item.selectedColor || item.color ? `<span style="color:${BRAND.muted}; font-size: 13px;">Colour: ${escapeHtml(item.selectedColor || item.color)}</span><br>` : ''}
        <span style="color:${BRAND.muted}; font-size: 13px;">Qty ${Number(item.qty || 0)} x ${rupees(item.price)}</span>
      </td>
      <td style="padding: 12px 10px; border-bottom: 1px solid ${BRAND.border}; text-align: right; color:${BRAND.green}; font-weight:700;">
        ${rupees(item.lineTotal || (Number(item.price || 0) * Number(item.qty || 0)))}
      </td>
    </tr>
  `).join('');

  return `
    <table role="presentation" style="width:100%; border-collapse:collapse; margin: 16px 0;">
      <thead>
        <tr>
          <th align="left" style="padding: 10px; background:${BRAND.creamAlt}; color:${BRAND.muted}; font-size: 12px; text-transform: uppercase; letter-spacing: .06em;">Product</th>
          <th align="right" style="padding: 10px; background:${BRAND.creamAlt}; color:${BRAND.muted}; font-size: 12px; text-transform: uppercase; letter-spacing: .06em;">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function totalsTable(order = {}, options = {}) {
  const rows = [
    ['Subtotal', rupees(order.subtotal)]
  ];

  if (Number(order.discountAmount || 0) > 0) {
    rows.push([
      `Discount${order.discountCode ? ` (${order.discountCode})` : ''}`,
      `-${rupees(order.discountAmount)}`
    ]);
  }

  rows.push(['Shipping', Number(order.shipping || 0) === 0 ? 'Free' : rupees(order.shipping)]);
  rows.push(['Order total', rupees(order.total)]);

  if (order.orderType === 'PREBOOK') {
    rows.push(['Advance amount', rupees(order.advanceAmount)]);
    rows.push(['Balance amount', rupees(order.balanceAmount)]);
  }

  if (options.amountLabel) {
    rows.push([options.amountLabel, rupees(options.amountValue)]);
  }

  return `
    <table role="presentation" style="width:100%; border-collapse:collapse; margin: 16px 0 8px;">
      ${rows.map(([label, value], index) => `
        <tr>
          <td style="padding: 8px 0; color:${index === rows.length - 1 ? BRAND.green : BRAND.muted}; font-weight:${index === rows.length - 1 ? '700' : '500'};">${escapeHtml(label)}</td>
          <td style="padding: 8px 0; text-align:right; color:${BRAND.green}; font-weight:700;">${value}</td>
        </tr>
      `).join('')}
    </table>
  `;
}

function paymentReference(order = {}, stage) {
  if (stage === 'balance') return order.balanceProviderTransactionId || order.providerTransactionId || '';
  return order.providerTransactionId || '';
}

function brandedEmail({ title, preheader, children, cta }) {
  return `
    <div style="margin:0; padding:0; background:${BRAND.cream}; font-family: Inter, Arial, sans-serif; color:${BRAND.green};">
      <span style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(preheader || title)}</span>
      <table role="presentation" style="width:100%; border-collapse:collapse; background:${BRAND.cream}; padding:0; margin:0;">
        <tr>
          <td style="padding: 28px 12px;">
            <table role="presentation" style="width:100%; max-width:680px; margin:0 auto; border-collapse:collapse; background:${BRAND.white}; border:1px solid ${BRAND.border}; border-radius:12px; overflow:hidden;">
              <tr>
                <td style="background:${BRAND.green}; padding:24px 28px; color:${BRAND.white};">
                  <div style="font-family: Georgia, serif; font-size:28px; line-height:1.15; font-weight:700;">Nika Arts Studio</div>
                  <div style="margin-top:8px; color:${BRAND.creamAlt}; font-size:14px;">Handcrafted originals, made with care</div>
                </td>
              </tr>
              <tr>
                <td style="padding:28px;">
                  <h1 style="font-family: Georgia, serif; font-size:28px; line-height:1.2; margin:0 0 12px; color:${BRAND.green};">${escapeHtml(title)}</h1>
                  ${children}
                  ${cta ? `
                    <p style="margin: 24px 0 8px;">
                      <a href="${cta.href}" style="display:inline-block; background:${BRAND.gold}; color:${BRAND.white}; text-decoration:none; padding:12px 18px; border-radius:8px; font-weight:700;">${escapeHtml(cta.label)}</a>
                    </p>
                  ` : ''}
                </td>
              </tr>
              <tr>
                <td style="background:${BRAND.creamAlt}; padding:18px 28px; color:${BRAND.muted}; font-size:13px;">
                  Need help? Reply to this email and we will assist you.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}

/**
 * Retry helper — attempts fn() up to (1 + retries) times with exponential backoff.
 * Suitable for transient email provider failures (network blips, rate limits).
 */
async function withEmailRetry(fn, { retries = 2, baseDelayMs = 1000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const waitMs = baseDelayMs * Math.pow(2, attempt);
        console.warn(`[Email] Attempt ${attempt + 1} failed, retrying in ${waitMs}ms…`, err.message);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
  }
  throw lastErr;
}

async function sendMailSafely(mailOptions, logLabel) {
  if (!hasEmailConfig()) {
    console.warn(`${logLabel} skipped because no email provider is configured.`);
    return false;
  }

  try {
    await withEmailRetry(() => sendMail(mailOptions, logLabel));
    console.log(`${logLabel} sent.`);
    return true;
  } catch (err) {
    console.error(`${logLabel} failed after retries:`, err.message || err);
    return false;
  }
}

async function sendMail(mailOptions, logLabel) {
  if (hasResendConfig()) {
    try {
      return await sendWithResend(mailOptions, logLabel);
    } catch (err) {
      console.error(`${logLabel} Resend send failed:`, err);
      if (!hasSmtpConfig() || process.env.EMAIL_ALLOW_SMTP_FALLBACK !== 'true') throw err;
      console.warn(`${logLabel} falling back to Gmail SMTP.`);
    }
  }

  if (hasSmtpConfig()) {
    return sendSmtpWithTimeout(mailOptions, logLabel);
  }

  throw new Error('No email provider configured.');
}

function sendSmtpWithTimeout(mailOptions, logLabel) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`${logLabel} timed out after ${EMAIL_SEND_TIMEOUT_MS}ms`);
      err.code = 'EMAIL_SEND_TIMEOUT';
      reject(err);
    }, EMAIL_SEND_TIMEOUT_MS);
  });

  return Promise.race([transporter.sendMail(mailOptions), timeoutPromise])
    .finally(() => clearTimeout(timeoutId));
}

async function sendWithResend(mailOptions, logLabel) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EMAIL_SEND_TIMEOUT_MS);

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: resendFromAddress(),
        to: normalizeRecipients(mailOptions.to),
        subject: mailOptions.subject,
        html: mailOptions.html,
        text: mailOptions.text,
        reply_to: process.env.RESEND_REPLY_TO || process.env.EMAIL_USER || undefined
      }),
      signal: controller.signal
    });
    const raw = await response.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }

    if (!response.ok) {
      const err = new Error(data.message || data.error || `${logLabel} failed with Resend status ${response.status}`);
      err.code = 'RESEND_SEND_FAILED';
      err.responseCode = response.status;
      err.response = raw;
      throw err;
    }

    return {
      provider: 'resend',
      messageId: data.id || '',
      accepted: normalizeRecipients(mailOptions.to),
      rejected: [],
      response: raw
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`${logLabel} timed out after ${EMAIL_SEND_TIMEOUT_MS}ms`);
      timeoutErr.code = 'RESEND_SEND_TIMEOUT';
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

function resendFromAddress() {
  const configured = String(process.env.RESEND_FROM_EMAIL || '').trim();
  if (!configured) return '';
  if (configured.includes('<')) return configured;
  return `${process.env.RESEND_FROM_NAME || 'Nika Arts Studio'} <${configured}>`;
}

function normalizeRecipients(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

async function sendDiagnosticEmail(toAddress) {
  if (!hasEmailConfig()) {
    return {
      success: false,
      message: 'No email provider is configured.'
    };
  }

  const to = toAddress || adminNotificationEmail();
  try {
    const info = await sendMail({
      from: `"Nika Arts Studio" <${process.env.EMAIL_USER}>`,
      to,
      subject: `Nika Arts Studio email test - ${new Date().toISOString()}`,
      html: brandedEmail({
        title: 'Email test successful',
        preheader: 'Nika Arts Studio production email test.',
        children: `
          <p style="margin:0 0 14px; color:${BRAND.green}; font-size:16px;">This is a diagnostic email from Nika Arts Studio.</p>
          <p style="margin:0; color:${BRAND.muted}; font-size:14px;">If you received this, Gmail delivery from the website server is working.</p>
        `
      })
    }, 'Diagnostic email');

    return {
      success: true,
      provider: info.provider || (hasResendConfig() ? 'resend' : 'gmail_smtp'),
      messageId: info.messageId || '',
      accepted: info.accepted || [],
      rejected: info.rejected || [],
      response: info.response || ''
    };
  } catch (err) {
    return {
      success: false,
      code: err.code || '',
      command: err.command || '',
      responseCode: err.responseCode || '',
      response: err.response || '',
      message: err.message || 'Email send failed.'
    };
  }
}

async function sendDiagnosticOrderEmails(toAddress) {
  const to = toAddress || adminNotificationEmail();
  const customer = {
    firstName: 'Nika',
    lastName: 'Test',
    email: to,
    phone: '9999999999'
  };
  const order = {
    id: `EMAIL-ORDER-TEST-${Date.now()}`,
    customer,
    subtotal: 499,
    shipping: 99,
    total: 598,
    orderType: 'STANDARD',
    advanceAmount: 0,
    balanceAmount: 0,
    paymentStatus: 'UPI_PENDING_VERIFICATION',
    fulfillmentStatus: 'PENDING',
    logisticsStatus: 'NOT_CREATED',
    paymentProvider: 'Manual UPI',
    providerTransactionId: 'ORDER-TEMPLATE-TEST',
    items: [{ productId: 'TEST', name: 'Diagnostic Keychain', price: 499, qty: 1, lineTotal: 499 }]
  };

  const adminSent = await sendOrderPlacedAdminEmail(customer, order, { stage: 'full' });
  const customerSent = await sendOrderPlacedCustomerEmail(customer, order, { stage: 'full' });

  return {
    success: adminSent === true && customerSent === true,
    orderId: order.id,
    admin: {
      success: adminSent === true,
      error: ''
    },
    customer: {
      success: customerSent === true,
      error: ''
    }
  };
}

async function sendOrderPlacedCustomerEmail(customer, order, options = {}) {
  const stage = options.stage || (order.orderType === 'PREBOOK' ? 'advance' : 'full');
  const amountLabel = stage === 'advance'
    ? 'Advance submitted'
    : stage === 'balance'
      ? 'Balance submitted'
      : 'Amount submitted';
  const amountValue = stage === 'advance'
    ? order.advanceAmount
    : stage === 'balance'
      ? order.balanceAmount
      : order.total;
  const ref = paymentReference(order, stage);
  const statusLine = stage === 'advance'
    ? 'We received your pre-book advance UPI reference. Admin verification is pending.'
    : stage === 'balance'
      ? 'We received your pre-book balance UPI reference. Admin verification is pending.'
    : 'We received your UPI payment reference. Admin verification is pending before packing starts.';
  const discountMessage = nextDiscountMessage(order);

  const html = brandedEmail({
    title: 'Order received',
    preheader: `Order ${order.id} is waiting for UPI verification.`,
    cta: { href: trackingLink(order.id), label: 'Track order' },
    children: `
      <p style="margin:0 0 14px; color:${BRAND.muted}; font-size:15px;">Hello ${escapeHtml(customer.firstName || 'there')},</p>
      <p style="margin:0 0 14px; color:${BRAND.green}; font-size:16px;">${statusLine}</p>
      <div style="padding:14px 16px; background:${BRAND.cream}; border:1px solid ${BRAND.border}; border-radius:10px; margin: 18px 0;">
        <strong>Order ID:</strong> ${escapeHtml(order.id)}<br>
        <strong>Payment mode:</strong> ${escapeHtml(order.paymentProvider || 'Manual UPI')}<br>
        ${ref ? `<strong>UPI reference:</strong> ${escapeHtml(ref)}<br>` : ''}
        <strong>Current status:</strong> ${escapeHtml(order.paymentStatus)}
      </div>
      ${orderItemsTable(order)}
      ${totalsTable(order, { amountLabel, amountValue })}
      ${discountMessage ? `<div style="padding:12px 14px; background:${BRAND.creamAlt}; border:1px solid ${BRAND.border}; border-radius:10px; margin: 16px 0; color:${BRAND.green}; font-size:14px;">${escapeHtml(discountMessage)}</div>` : ''}
      <p style="margin:16px 0 0; color:${BRAND.muted}; font-size:14px;">Shiprocket tracking will be updated after payment is verified and the order is handed over for shipping.</p>
    `
  });

  return sendMailSafely({
    from: `"Nika Arts Studio" <${process.env.EMAIL_USER}>`,
    to: customer.email,
    subject: `Order received: ${order.id}`,
    html
  }, `Customer order received email for ${order.id}`);
}

async function sendOrderPlacedAdminEmail(customer, order, options = {}) {
  const stage = options.stage || (order.orderType === 'PREBOOK' ? 'advance' : 'full');
  const amountLabel = stage === 'advance'
    ? 'Advance to verify'
    : stage === 'balance'
      ? 'Balance to verify'
      : 'Amount to verify';
  const amountValue = stage === 'advance'
    ? order.advanceAmount
    : stage === 'balance'
      ? order.balanceAmount
      : order.total;
  const ref = paymentReference(order, stage);

  const html = brandedEmail({
    title: 'Payment verification needed',
    preheader: `Order ${order.id} needs manual UPI verification.`,
    cta: { href: adminConfirmLink(order.id), label: 'Open payment confirmation' },
    children: `
      <p style="margin:0 0 14px; color:${BRAND.green}; font-size:16px;">A customer has placed an order and submitted a manual UPI reference. Verify receipt before fulfillment proceeds.</p>
      <div style="padding:14px 16px; background:${BRAND.cream}; border:1px solid ${BRAND.border}; border-radius:10px; margin: 18px 0;">
        <strong>Order ID:</strong> ${escapeHtml(order.id)}<br>
        <strong>Customer:</strong> ${escapeHtml(customerName(customer))}<br>
        <strong>Email:</strong> ${escapeHtml(customer.email || '')}<br>
        <strong>Phone:</strong> ${escapeHtml(customer.phone || customer.mobile || '')}<br>
        <strong>Payment mode:</strong> ${escapeHtml(order.paymentProvider || 'Manual UPI')}<br>
        ${ref ? `<strong>UPI reference:</strong> ${escapeHtml(ref)}<br>` : ''}
        <strong>Payment status:</strong> ${escapeHtml(order.paymentStatus)}
      </div>
      ${orderItemsTable(order)}
      ${totalsTable(order, { amountLabel, amountValue })}
      <p style="margin:16px 0 0; color:${BRAND.muted}; font-size:14px;">
        Customer tracking link: <a href="${trackingLink(order.id)}" style="color:${BRAND.goldDark};">${trackingLink(order.id)}</a><br>
        The confirmation page requires admin login before the payment can be marked as received.
      </p>
    `
  });

  return sendMailSafely({
    from: `"Nika Arts System" <${process.env.EMAIL_USER}>`,
    to: adminNotificationEmail(),
    subject: `Verify UPI payment: ${order.id} - ${rupees(amountValue)}`,
    html
  }, `Admin payment verification email for ${order.id}`);
}

async function sendPaymentConfirmedCustomerEmail(customer, order, options = {}) {
  const stage = options.stage || (order.orderType === 'PREBOOK' && order.paymentStatus === 'PREBOOK_ADVANCE_PAID' ? 'advance' : 'full');
  const statusLine = stage === 'advance'
    ? 'Your pre-book advance payment has been verified. We will notify you when stock is ready for the remaining amount.'
    : 'Your UPI payment has been verified. Your order is confirmed and will now move toward shipping.';
  const discountMessage = nextDiscountMessage(order);

  const html = brandedEmail({
    title: 'Payment confirmed',
    preheader: `Payment confirmed for ${order.id}.`,
    cta: { href: trackingLink(order.id), label: 'Track order' },
    children: `
      <p style="margin:0 0 14px; color:${BRAND.muted}; font-size:15px;">Hello ${escapeHtml(customer.firstName || 'there')},</p>
      <p style="margin:0 0 14px; color:${BRAND.green}; font-size:16px;">${escapeHtml(options.statusLabel || statusLine)}</p>
      <div style="padding:14px 16px; background:${BRAND.cream}; border:1px solid ${BRAND.border}; border-radius:10px; margin: 18px 0;">
        <strong>Order ID:</strong> ${escapeHtml(order.id)}<br>
        <strong>Payment status:</strong> ${escapeHtml(order.paymentStatus)}<br>
        <strong>Fulfillment status:</strong> ${escapeHtml(order.fulfillmentStatus)}<br>
        <strong>Logistics status:</strong> ${escapeHtml(order.logisticsStatus || 'NOT_CREATED')}
      </div>
      ${orderItemsTable(order)}
      ${totalsTable(order)}
      ${discountMessage ? `<div style="padding:12px 14px; background:${BRAND.creamAlt}; border:1px solid ${BRAND.border}; border-radius:10px; margin: 16px 0; color:${BRAND.green}; font-size:14px;">${escapeHtml(discountMessage)}</div>` : ''}
      <p style="margin:16px 0 0; color:${BRAND.muted}; font-size:14px;">Shiprocket tracking will appear on the tracking page once the shipment is created.</p>
    `
  });

  return sendMailSafely({
    from: `"Nika Arts Studio" <${process.env.EMAIL_USER}>`,
    to: customer.email,
    subject: `Payment confirmed: ${order.id}`,
    html
  }, `Customer payment confirmed email for ${order.id}`);
}

async function sendCustomerReceipt(customer, cart, orderId, total, options = {}) {
  const order = {
    id: orderId,
    customer,
    items: cart.map(item => ({
      ...item,
      lineTotal: item.lineTotal || Number(item.price || 0) * Number(item.qty || 0)
    })),
    subtotal: options.subtotal || total,
    shipping: options.shipping || 0,
    total,
    paymentStatus: options.paymentStatus || 'PAID',
    fulfillmentStatus: options.fulfillmentStatus || 'READY_FOR_SHIPPING',
    logisticsStatus: options.logisticsStatus || 'NOT_CREATED',
    paymentProvider: options.paymentProvider || 'Manual UPI',
    orderType: options.orderType || 'STANDARD',
    advanceAmount: options.advanceAmount || 0,
    balanceAmount: options.balanceAmount || 0
  };

  return sendPaymentConfirmedCustomerEmail(customer, order, options);
}

async function sendAdminNotification(customer, orderId, total, options = {}) {
  const order = {
    id: orderId,
    customer,
    items: options.items || [],
    subtotal: options.subtotal || total,
    shipping: options.shipping || 0,
    total,
    paymentStatus: options.paymentStatus || 'UPI_PENDING_VERIFICATION',
    fulfillmentStatus: options.fulfillmentStatus || 'PENDING',
    logisticsStatus: options.logisticsStatus || 'NOT_CREATED',
    paymentProvider: options.paymentProvider || 'Manual UPI',
    providerTransactionId: options.paymentReference || '',
    orderType: options.orderType || 'STANDARD',
    advanceAmount: options.advanceAmount || 0,
    balanceAmount: options.balanceAmount || 0
  };

  return sendOrderPlacedAdminEmail(customer, order, options);
}

async function sendPasswordResetEmail(customer, resetUrl) {
  const html = brandedEmail({
    title: 'Reset your password',
    preheader: 'Secure password reset link for your Nika Arts Studio account.',
    cta: { href: resetUrl, label: 'Reset password' },
    children: `
      <p style="margin:0 0 14px; color:${BRAND.muted}; font-size:15px;">Hello ${escapeHtml(customer.firstName || 'there')},</p>
      <p style="margin:0 0 14px; color:${BRAND.green}; font-size:16px;">Use the secure link below to set a new password. This link expires in 30 minutes.</p>
      <p style="margin:16px 0 0; color:${BRAND.muted}; font-size:14px;">If you did not request this, you can ignore this email.</p>
    `
  });

  return sendMailSafely({
    from: `"Nika Arts Studio" <${process.env.EMAIL_USER}>`,
    to: customer.email,
    subject: 'Reset your Nika Arts Studio password',
    html
  }, 'Password reset email');
}

async function sendPrebookBalanceRequest(customer, order) {
  const html = brandedEmail({
    title: 'Your pre-book is ready',
    preheader: `Balance payment is ready for ${order.id}.`,
    cta: { href: trackingLink(order.id), label: 'Pay remaining amount' },
    children: `
      <p style="margin:0 0 14px; color:${BRAND.muted}; font-size:15px;">Hello ${escapeHtml(customer.firstName || 'there')},</p>
      <p style="margin:0 0 14px; color:${BRAND.green}; font-size:16px;">Your pre-booked item is now available. Please pay the remaining amount and submit the UPI reference from the tracking page.</p>
      ${orderItemsTable(order)}
      ${totalsTable(order, { amountLabel: 'Balance due', amountValue: order.balanceAmount })}
      <p style="margin:16px 0 0; color:${BRAND.muted}; font-size:14px;">After you submit the UPI reference, admin will verify it and shipping will proceed.</p>
    `
  });

  return sendMailSafely({
    from: `"Nika Arts Studio" <${process.env.EMAIL_USER}>`,
    to: customer.email,
    subject: `Your pre-book is ready - ${order.id}`,
    html
  }, `Pre-book balance request email for ${order.id}`);
}

module.exports = {
  hasEmailConfig,
  hasResendConfig,
  hasSmtpConfig,
  emailProviderStatus,
  sendCustomerReceipt,
  sendAdminNotification,
  sendPasswordResetEmail,
  sendPrebookBalanceRequest,
  sendOrderPlacedCustomerEmail,
  sendOrderPlacedAdminEmail,
  sendPaymentConfirmedCustomerEmail,
  sendDiagnosticEmail,
  sendDiagnosticOrderEmails
};
