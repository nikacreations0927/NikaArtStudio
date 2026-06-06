(function () {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order') || params.get('id') || '';
  let currentOrder = null;

  const messageEl = document.getElementById('payment-confirm-message');
  const loginPanel = document.getElementById('payment-confirm-login');
  const card = document.getElementById('payment-confirm-card');
  const loginForm = document.getElementById('payment-confirm-login-form');
  const confirmButton = document.getElementById('payment-confirm-button');

  function rupees(value) {
    return 'Rs. ' + Number(value || 0).toLocaleString('en-IN');
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

  function showMessage(message, isError = false) {
    messageEl.textContent = String(message || '');
    messageEl.className = isError ? 'admin-message error-msg' : 'admin-message';
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const raw = await res.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { success: false, message: raw || `Request failed with status ${res.status}` };
    }
    if (!res.ok || data.success === false) {
      const err = new Error(data.message || `Request failed with status ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function paymentStage(order) {
    if (order.paymentStatus === 'PREBOOK_BALANCE_PENDING') return 'balance';
    if (order.paymentStatus === 'PREBOOK_ADVANCE_PENDING') return 'advance';
    return 'full';
  }

  function amountToVerify(order) {
    const stage = paymentStage(order);
    if (stage === 'advance') return order.advanceAmount;
    if (stage === 'balance') return order.balanceAmount;
    return order.total;
  }

  function paymentReference(order) {
    return paymentStage(order) === 'balance'
      ? order.balanceProviderTransactionId || order.providerTransactionId || ''
      : order.providerTransactionId || '';
  }

  function canVerify(order) {
    return ['UPI_PENDING_VERIFICATION', 'PREBOOK_ADVANCE_PENDING', 'PREBOOK_BALANCE_PENDING'].includes(order.paymentStatus);
  }

  function customerDisplay(order) {
    const customer = order.customer || {};
    return `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Customer';
  }

  function renderOrder(order) {
    currentOrder = order;
    const ref = paymentReference(order);
    document.getElementById('payment-confirm-title').textContent = `Order ${order.id}`;
    document.getElementById('payment-confirm-subtitle').textContent = order.orderType === 'PREBOOK'
      ? 'Pre-book manual UPI verification'
      : 'Manual UPI verification';
    document.getElementById('confirm-customer-name').textContent = customerDisplay(order);
    document.getElementById('confirm-customer-contact').textContent = `${order.customer?.email || ''}${order.customer?.phone ? ' | ' + order.customer.phone : ''}`;
    document.getElementById('confirm-payment-mode').textContent = order.paymentProvider || 'Manual UPI';
    document.getElementById('confirm-payment-reference').textContent = ref ? `Reference: ${ref}` : 'No UPI reference available';
    document.getElementById('confirm-payment-status').textContent = order.paymentStatus || '-';
    document.getElementById('confirm-fulfillment-status').textContent = `Fulfillment: ${order.fulfillmentStatus || '-'}`;
    document.getElementById('confirm-amount').textContent = rupees(amountToVerify(order));
    document.getElementById('confirm-order-total').textContent = `Order total: ${rupees(order.total)}`;
    document.getElementById('payment-confirm-track-link').href = `/track-order?order=${encodeURIComponent(order.id)}`;

    document.getElementById('payment-confirm-items').innerHTML = (order.items || []).map(item => `
      <tr>
        <td><strong>${escapeHtml(item.name)}</strong></td>
        <td>${Number(item.qty || 0)}</td>
        <td>${rupees(item.price)}</td>
        <td>${rupees(item.lineTotal || Number(item.price || 0) * Number(item.qty || 0))}</td>
      </tr>
    `).join('') || '<tr><td colspan="4" class="inventory-empty">No items found for this order.</td></tr>';

    confirmButton.disabled = !canVerify(order);
    confirmButton.textContent = canVerify(order)
      ? 'Confirm payment received'
      : 'Payment already handled';

    loginPanel.hidden = true;
    card.hidden = false;
    showMessage(canVerify(order) ? 'Review the details before confirming payment.' : 'This order is not waiting for payment verification.');
  }

  async function loadOrder() {
    if (!orderId) {
      loginPanel.hidden = true;
      card.hidden = true;
      showMessage('Missing order ID in the confirmation link.', true);
      return;
    }

    try {
      const data = await api(`/api/orders/${encodeURIComponent(orderId)}`);
      renderOrder(data.order);
    } catch (err) {
      if (err.status === 401) {
        card.hidden = true;
        loginPanel.hidden = false;
        showMessage('Please log in to review this order.');
        return;
      }
      showMessage(err.message, true);
    }
  }

  loginForm?.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await api('/api/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          username: document.getElementById('payment-confirm-username').value.trim(),
          password: document.getElementById('payment-confirm-password').value
        })
      });
      document.getElementById('payment-confirm-password').value = '';
      await loadOrder();
    } catch (err) {
      showMessage(err.message, true);
    }
  });

  confirmButton?.addEventListener('click', async () => {
    if (!currentOrder || !canVerify(currentOrder)) return;
    const ref = paymentReference(currentOrder);
    confirmButton.disabled = true;
    confirmButton.textContent = 'Confirming...';
    try {
      const data = await api(`/api/orders/${encodeURIComponent(currentOrder.id)}/payment`, {
        method: 'PATCH',
        body: JSON.stringify({ providerTransactionId: ref })
      });
      renderOrder(data.order);
      showMessage(data.message || 'Payment verified and customer notified.');
    } catch (err) {
      confirmButton.disabled = false;
      confirmButton.textContent = 'Confirm payment received';
      showMessage(err.message, true);
    }
  });

  loadOrder();
}());
