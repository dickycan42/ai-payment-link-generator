const $ = (id) => document.getElementById(id);
const input = $('nl-input');

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

function showError(msg, hint) {
  $('error-msg').textContent = msg;
  $('error-hint').textContent = hint || '';
  $('error-card').classList.remove('hidden');
  $('result-card').classList.add('hidden');
}

function hideError() { $('error-card').classList.add('hidden'); }

function field(k, v) {
  return `<div class="field"><div class="k">${k}</div><div class="v">${v ?? '—'}</div></div>`;
}

function fillParsed(p) {
  $('parsed-grid').innerHTML =
    field('Amount', p.amount != null ? p.amount.toLocaleString() : '—') +
    field('Currency', p.currency) +
    field('Recipient', p.recipient_email || p.recipient_name || '—') +
    field('Description', p.description || '—');
  $('parsed-confidence').textContent =
    `Parser confidence: ${Math.round((p.confidence || 0) * 100)}% · via ${p.method === 'llm' ? 'LLM' : 'built-in NLP'} · language: ${p.language || '?'}` +
    (p.notes && p.notes.length ? ` · notes: ${p.notes.join('; ')}` : '');
  $('parsed-card').classList.remove('hidden');
  // editable overrides
  if (p.recipient_email) $('edit-email').value = p.recipient_email;
  if (p.amount != null) $('edit-amount').value = p.amount;
  if (p.currency) $('edit-currency').value = p.currency;
  if (p.description) $('edit-desc').value = p.description;
}

async function doParse() {
  hideError();
  const text = input.value.trim();
  if (!text) return showError('Please type an invoice description first.');
  $('btn-parse').disabled = true;
  try {
    const data = await api('/api/parse', { text });
    if (!data.ok) throw new Error(data.error || 'Parse failed');
    fillParsed(data.parsed);
  } catch (e) { showError(e.message); }
  finally { $('btn-parse').disabled = false; }
}

async function doCreate() {
  hideError();
  $('btn-create').disabled = true;
  try {
    const body = { text: input.value.trim() || undefined };
    // editable overrides win when filled
    if ($('edit-email').value) body.recipient_email = $('edit-email').value.trim();
    if ($('edit-amount').value) body.amount = parseFloat($('edit-amount').value);
    if ($('edit-currency').value) body.currency = $('edit-currency').value;
    if ($('edit-desc').value) body.description = $('edit-desc').value.trim();
    if (!body.text && !body.amount) {
      throw new Error('Type a description or fill the amount + email fields.');
    }
    const data = await api('/api/invoice', body);
    if (!data.ok) throw new Error(data.error + (data.hint ? ' — ' + data.hint : ''));
    if (data.parsed) fillParsed(data.parsed);
    const inv = data.invoice;
    $('result-grid').innerHTML =
      field('Invoice ID', inv.invoice_id) +
      field('Status', inv.status) +
      field('Amount', `${inv.currency} ${inv.amount}`) +
      field('Recipient', inv.recipient_email);
    const link = $('pay-link');
    link.href = inv.payment_link || '#';
    link.textContent = inv.payment_link ? '🔗 Open payment link' : '⚠️ No payment link returned';
    $('result-note').textContent =
      `Mode: ${inv.mode === 'mock' ? 'MOCK (demo)' : 'PayPal Sandbox (live)'} — no real money moves.`;
    $('result-card').classList.remove('hidden');
    $('result-card').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { showError(e.message); }
  finally { $('btn-create').disabled = false; }
}

$('btn-parse').addEventListener('click', doParse);
$('btn-create').addEventListener('click', doCreate);
$('btn-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('pay-link').href); $('btn-copy').textContent = '✅ Copied!'; }
  catch { $('btn-copy').textContent = '❌ Copy failed'; }
  setTimeout(() => ($('btn-copy').textContent = '📋 Copy link'), 1500);
});
document.querySelectorAll('.chip').forEach((c) =>
  c.addEventListener('click', () => { input.value = c.dataset.ex; hideError(); })
);

// health → mode badge
fetch('/api/health').then((r) => r.json()).then((h) => {
  const b = $('mode-badge');
  b.textContent = h.paypal_mode === 'mock' ? 'MOCK mode' : 'Sandbox live';
  if (h.paypal_mode !== 'mock') b.classList.add('live');
}).catch(() => {});
