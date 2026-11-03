/**
 * server.js — AI Payment Link Generator (PayPal AI Hackathon 2026)
 *
 * Endpoints:
 *   GET  /api/health    -> service + PayPal mode status
 *   POST /api/parse     -> { text } => parsed invoice fields (AI)
 *   POST /api/invoice   -> { text } or { amount, currency, recipient_email, description }
 *                          => PayPal invoice + payer payment link
 *   GET  /              -> serves the frontend
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { parse } = require('./lib/ai-parser');
const paypal = require('./lib/paypal');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'ai-payment-link-generator',
    paypal_mode: paypal.isMock() ? 'mock' : 'live-sandbox',
    paypal_configured: !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    llm_parser: !!process.env.OPENAI_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/parse', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Field "text" is required' });
    }
    const parsed = await parse(text);
    res.json({ ok: true, parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/invoice', async (req, res) => {
  try {
    let { text, amount, currency, recipient_email, recipient_name, description } = req.body || {};

    // Step 1: AI-parse natural language when raw text is provided
    let parsed = null;
    if (text && text.trim()) {
      parsed = await parse(text);
      amount = amount ?? parsed.amount;
      currency = currency ?? parsed.currency;
      recipient_email = recipient_email ?? parsed.recipient_email;
      recipient_name = recipient_name ?? parsed.recipient_name;
      description = description ?? parsed.description;
    }

    // Step 2: validate required fields
    const missing = [];
    if (!amount) missing.push('amount');
    if (!currency) missing.push('currency');
    if (!recipient_email) missing.push('recipient_email');
    if (missing.length) {
      return res.status(422).json({
        error: `Missing required fields: ${missing.join(', ')}`,
        parsed,
        hint: 'Include an amount (e.g. $50), a recipient email, and a description like "for logo design".',
      });
    }

    // Step 3: create + send PayPal invoice, get payment link
    const result = await paypal.createPaymentLink({
      amount, currency, recipient_email, description,
    });

    res.json({ ok: true, parsed, invoice: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`AI Payment Link Generator running on http://localhost:${PORT}`);
  console.log(`PayPal mode: ${paypal.isMock() ? 'MOCK (no credentials)' : 'LIVE SANDBOX'}`);
});
