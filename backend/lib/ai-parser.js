/**
 * ai-parser.js — Natural-language invoice parser (English + Indonesian)
 *
 * Turns free text like:
 *   "tagih $50 ke client buat desain logo"
 *   "invoice 200000 rupiah to budi@gmail.com for website design"
 * into structured invoice data:
 *   { amount, currency, recipient_email, recipient_name, description, language, confidence }
 *
 * Layered design:
 *  - parseWithRules(): deterministic bilingual NLP (always available, used in demo)
 *  - parseWithLLM():   OpenAI-backed parsing when OPENAI_API_KEY is set (optional upgrade)
 */

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;

const CURRENCY_SYMBOLS = {
  '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR',
  'Rp': 'IDR', 'RP': 'IDR',
};

const CURRENCY_WORDS = {
  dollar: 'USD', dollars: 'USD', usd: 'USD', buck: 'USD', bucks: 'USD',
  euro: 'EUR', euros: 'EUR', eur: 'EUR',
  pound: 'GBP', pounds: 'GBP', gbp: 'GBP',
  rupiah: 'IDR', idr: 'IDR', perak: 'IDR',
  ringgit: 'MYR', myr: 'MYR', rm: 'MYR',
  peso: 'PHP', php: 'PHP',
  yen: 'JPY', jpy: 'JPY',
};

// Indonesian multipliers
const MULTIPLIERS = {
  ribu: 1e3, rb: 1e3, k: 1e3,
  juta: 1e6, jt: 1e6, m: 1e6,
};

const ID_KEYWORDS = ['tagih', 'buat', 'untuk', 'kepada', 'bayar', 'minta', 'tolong', 'kirim'];
const DESC_KEYWORDS = /^(?:for|buat|untuk|buatkan|desc(?:ription)?)\b/i;
const TO_KEYWORDS = /^(?:to|ke|kepada|kirim\s+ke)\b/i;

function detectLanguage(text) {
  const lower = text.toLowerCase();
  let idScore = 0, enScore = 0;
  for (const w of ID_KEYWORDS) if (lower.includes(w)) idScore++;
  for (const w of ['invoice', 'charge', 'bill', 'the', 'and']) if (lower.includes(w)) enScore++;
  if (/rp\b/i.test(text) || /ribu|juta/i.test(text)) idScore += 2;
  return idScore >= enScore ? 'id' : 'en';
}

/** Normalize a raw number string into a float, currency-aware. */
function normalizeAmount(raw, currency) {
  let s = raw.trim();
  // strip multiplier words handled separately; here only digits + separators
  if (currency === 'IDR') {
    // Indonesian format: dots = thousands, comma = decimal.
    // But a single dot with 1-2 decimals ("1.5") is a decimal point.
    if (/^\d+\.\d{1,2}$/.test(s)) {
      const v = parseFloat(s);
      return isNaN(v) ? null : v;
    }
    if (/,\d{1,2}$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/[.,]/g, '');
    }
    const v = parseFloat(s);
    return isNaN(v) ? null : v;
  }
  // Default (EN): commas = thousands, dot = decimal; trailing ",dd" = decimal
  if (/,\d{2}$/.test(s) && !/\.\d+$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const v = parseFloat(s);
  return isNaN(v) ? null : v;
}

/** Extract { amount, currency } from text. Returns nulls when not found. */
function extractAmount(text, language) {
  // 1) Symbol-prefixed: $50, Rp50.000, €75
  let m = text.match(/(Rp|\$|€|£|¥|₹)\s?(\d[\d.,]*)/);
  if (m) {
    const currency = CURRENCY_SYMBOLS[m[1]] || 'USD';
    const amount = normalizeAmount(m[2], currency);
    if (amount != null) return { amount, currency, raw: m[0] };
  }
  // 2) Number + currency word/code/multiplier: 50 USD, 200 ribu, 1.5 juta, 50k
  m = text.match(/(\d[\d.,]*)\s*(ribu|juta|rb|jt|[a-z]{2,8})?\b/i);
  if (m) {
    const word = (m[2] || '').toLowerCase();
    let currency = null, multiplier = 1;
    if (MULTIPLIERS[word]) {
      multiplier = MULTIPLIERS[word];
      currency = 'IDR';
    } else if (CURRENCY_WORDS[word]) {
      currency = CURRENCY_WORDS[word];
    }
    // lone "k" suffix: 50k
    if (!m[2] && /(\d)k$/i.test(m[0])) multiplier = 1e3;
    const amount = normalizeAmount(m[1], currency || (language === 'id' ? 'IDR' : 'USD'));
    if (amount != null) {
      return {
        amount: amount * multiplier,
        currency: currency || (language === 'id' ? 'IDR' : 'USD'),
        raw: m[0],
      };
    }
  }
  return { amount: null, currency: null, raw: null };
}

function stripToken(text, token) {
  if (!token) return text;
  const i = text.indexOf(token);
  if (i === -1) return text;
  return (text.slice(0, i) + ' ' + text.slice(i + token.length)).replace(/\s+/g, ' ').trim();
}

function parseWithRules(text) {
  const original = text;
  const language = detectLanguage(text);
  const notes = [];

  // --- recipient email ---
  const emailMatch = text.match(EMAIL_RE);
  const recipient_email = emailMatch ? emailMatch[0] : null;
  let rest = stripToken(text, recipient_email);

  // --- amount + currency ---
  const { amount, currency, raw } = extractAmount(rest, language);
  rest = stripToken(rest, raw);
  if (amount == null) notes.push('No amount detected');

  // --- description: text after the LAST for/buat/untuk keyword ---
  let description = null;
  const parts = rest.split(/\s+(?:for|buat|untuk|buatkan|description|desc)\s+/i);
  if (parts.length > 1) {
    description = parts[parts.length - 1].trim().replace(/[.\s]+$/, '');
    rest = parts.slice(0, -1).join(' ').trim();
  }

  // --- recipient name: after to/ke keyword ---
  let recipient_name = null;
  const toMatch = rest.match(/(?:to|ke|kepada|kirim\s+ke)\s+([a-zA-Z][\w\s.'-]*?)(?=\s*$)/i);
  if (toMatch && !EMAIL_RE.test(toMatch[1])) {
    recipient_name = toMatch[1].trim();
    rest = rest.slice(0, toMatch.index).trim();
  }

  // Fallback description: whatever meaningful text remains (minus filler verbs)
  if (!description) {
    const cleaned = rest
      .replace(/^(tagih|invoice|bill|charge|buatkan|minta|tolong)\b\s*/i, '')
      .replace(/\s+/g, ' ').trim();
    if (cleaned.length > 1) description = cleaned;
  }
  if (!description) notes.push('No description detected');

  const found = [amount != null, !!recipient_email || !!recipient_name, !!description]
    .filter(Boolean).length;
  const confidence = found / 3;

  return {
    amount, currency, recipient_email, recipient_name, description,
    language, confidence: Math.round(confidence * 100) / 100,
    notes, original,
  };
}

/** Optional LLM upgrade: uses OpenAI when OPENAI_API_KEY is set. */
async function parseWithLLM(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY not set');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: 'Extract invoice data from the user message. Reply ONLY with JSON: {"amount": number|null, "currency": "USD"|"IDR"|"EUR"|"GBP"|"MYR"|"PHP"|"JPY"|"INR"|null, "recipient_email": string|null, "recipient_name": string|null, "description": string|null}. Amount as a plain number (e.g. "50 ribu" -> 50000, currency IDR).' },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  const rules = parseWithRules(text);
  return { ...rules, ...parsed, confidence: 0.95, method: 'llm', original: text };
}

/** Main entry: LLM when available, rules otherwise. */
async function parse(text) {
  if (!text || !text.trim()) throw new Error('Empty text');
  if (process.env.OPENAI_API_KEY) {
    try { return await parseWithLLM(text); } catch (e) { /* fall through to rules */ }
  }
  return { ...parseWithRules(text), method: 'rules' };
}

module.exports = { parse, parseWithRules, parseWithLLM };
