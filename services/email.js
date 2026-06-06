const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your.nika.arts.email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-16-digit-app-password'
  }
});

function hasEmailConfig() {
  return Boolean(
    process.env.EMAIL_USER &&
    process.env.EMAIL_PASS &&
    !String(process.env.EMAIL_USER).startsWith('your.') &&
    !String(process.env.EMAIL_PASS).startsWith('your-')
  );
}

function rupees(value) {
  return 'Rs. ' + Number(value || 0).toLocaleString('en-IN');
}

function siteUrl(path = '') {
  return `${String(process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')}${path}`;
}

async function sendCustomerReceipt(customer, cart, orderId, total, options = {}) {
  if (!hasEmailConfig()) {
    console.warn('Customer email skipped because EMAIL_USER/EMAIL_PASS are not configured.');
    return false;
  }

  const statusLabel = options.statusLabel || 'Your order is confirmed and we are getting it ready for shipping.';
  const itemsHtml = cart.map(item => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.name} (x${item.qty})</td>
      <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">${rupees(item.price * item.qty)}</td>
    </tr>
  `).join('');

  const mailOptions = {
    from: `"Nika Arts Studio" <${process.env.EMAIL_USER}>`,
    to: customer.email,
    subject: `Nika Arts Studio Order - ${orderId}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #2b3a2f; text-align: center;">Nika Arts Studio</h2>
        <p style="font-size: 16px;">Hello ${customer.firstName || 'there'},</p>
        <p style="font-size: 16px;">${statusLabel}</p>
        <h3 style="border-bottom: 2px solid #2b3a2f; padding-bottom: 5px; margin-top: 30px;">Order Summary (${orderId})</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          ${itemsHtml}
          <tr>
            <td style="padding: 10px; font-weight: bold; text-align: right;">Total:</td>
            <td style="padding: 10px; font-weight: bold; text-align: right; color: #2b3a2f;">${rupees(total)}</td>
          </tr>
        </table>
        <p style="font-size: 14px; color: #666;">Track this order anytime at <a href="${siteUrl(`/track-order?order=${encodeURIComponent(orderId)}`)}">Nika Arts Studio</a>.</p>
        <p style="font-size: 14px; color: #666; text-align: center; margin-top: 40px;">
          If you have any questions, simply reply to this email.<br>
          (c) 2026 Nika Arts Studio
        </p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Customer email sent to ${customer.email}`);
    return true;
  } catch (err) {
    console.error('Error sending customer email:', err);
    return false;
  }
}

async function sendAdminNotification(customer, orderId, total, options = {}) {
  if (!hasEmailConfig()) {
    console.warn('Admin notification skipped because EMAIL_USER/EMAIL_PASS are not configured.');
    return false;
  }

  const statusLabel = options.statusLabel || 'Paid order received';
  const referenceHtml = options.paymentReference
    ? `<p><strong>UPI Reference:</strong> ${options.paymentReference}</p>`
    : '';
  const mailOptions = {
    from: `"Nika Arts System" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_USER,
    subject: `New Order: ${orderId} - ${rupees(total)}`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #2e7d32;">New Order Received</h2>
        <p><strong>Status:</strong> ${statusLabel}</p>
        <p><strong>Customer:</strong> ${customer.firstName || ''} ${customer.lastName || ''}</p>
        <p><strong>Email:</strong> ${customer.email || ''}</p>
        <p><strong>Phone:</strong> ${customer.phone || customer.mobile || ''}</p>
        <p><strong>Total:</strong> ${rupees(total)}</p>
        ${referenceHtml}
        <a href="${siteUrl('/admin')}" style="display: inline-block; padding: 10px 20px; background: #2b3a2f; color: white; text-decoration: none; border-radius: 4px; margin-top: 15px;">View in Dashboard</a>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Admin notification sent.');
    return true;
  } catch (err) {
    console.error('Error sending admin notification:', err);
    return false;
  }
}

async function sendPasswordResetEmail(customer, resetUrl) {
  if (!hasEmailConfig()) {
    console.warn('Password reset email skipped because EMAIL_USER/EMAIL_PASS are not configured.');
    return false;
  }

  const mailOptions = {
    from: `"Nika Arts Studio" <${process.env.EMAIL_USER}>`,
    to: customer.email,
    subject: 'Reset your Nika Arts Studio password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #2b3a2f;">Reset your password</h2>
        <p>Hello ${customer.firstName || 'there'},</p>
        <p>Use the secure link below to set a new password for your Nika Arts Studio account. This link expires in 30 minutes.</p>
        <p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#2b3a2f;color:#fff;text-decoration:none;border-radius:6px;">Reset password</a></p>
        <p style="font-size: 13px; color: #666;">If you did not request this, you can ignore this email.</p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
  return true;
}

async function sendPrebookBalanceRequest(customer, order) {
  if (!hasEmailConfig()) {
    console.warn('Pre-book balance email skipped because EMAIL_USER/EMAIL_PASS are not configured.');
    return false;
  }

  const mailOptions = {
    from: `"Nika Arts Studio" <${process.env.EMAIL_USER}>`,
    to: customer.email,
    subject: `Your pre-book is ready - ${order.id}`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #2b3a2f; text-align: center;">Nika Arts Studio</h2>
        <p>Hello ${customer.firstName || 'there'},</p>
        <p>Your pre-booked item is now available. Please pay the remaining amount to confirm shipping.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Order ID</td><td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;"><strong>${order.id}</strong></td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Advance paid</td><td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">${rupees(order.advanceAmount)}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Balance due</td><td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;"><strong>${rupees(order.balanceAmount)}</strong></td></tr>
        </table>
        <p><a href="${siteUrl(`/track-order?order=${encodeURIComponent(order.id)}`)}" style="display:inline-block;padding:12px 18px;background:#2b3a2f;color:#fff;text-decoration:none;border-radius:6px;">Pay remaining amount</a></p>
        <p style="font-size: 13px; color: #666;">After you submit the UPI reference, our admin will verify it and ship your order.</p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
  return true;
}

module.exports = { hasEmailConfig, sendCustomerReceipt, sendAdminNotification, sendPasswordResetEmail, sendPrebookBalanceRequest };
