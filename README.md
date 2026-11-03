# 💸🤖 AI Payment Link Generator

**PayPal AI Hackathon 2026 entry** — turn plain words into a PayPal invoice with a shareable payment link.

Type it like you'd say it:
> `tagih $50 ke client buat desain logo`

AI parses the amount, currency, recipient, and description → creates a **PayPal Sandbox invoice** → returns a **payment link** you can send to anyone.

Works in **English and Bahasa Indonesia**.

---

## ✨ Features

- **Natural-language invoice parsing** — bilingual (EN/ID) NLP understands amounts (`$50`, `Rp1.250.000`, `1.5 juta`, `75rb`, `€75`), currencies, emails, recipient names, and descriptions.
- **PayPal Invoicing API v2 (Sandbox)** — creates a real draft invoice, sends it, and returns the payer-facing `recipient_view_url` payment link.
- **Optional LLM upgrade** — set `OPENAI_API_KEY` to parse with `gpt-4o-mini` instead of the built-in parser.
- **Mock mode** — demo the full flow with zero credentials (`PAYPAL_MOCK=true`).
- **One-page web UI** — parse → preview → edit → create → copy link.

## 🏗️ Architecture

```
┌─────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  Frontend   │      │  Backend (Node)  │      │  PayPal Sandbox  │
│  index.html │─────▶│  /api/parse      │      │  Invoicing API v2│
│  app.js     │      │  /api/invoice    │─────▶│  OAuth + invoices│
└─────────────┘      │  lib/ai-parser   │      └──────────────────┘
                     │  lib/paypal      │
                     └──────────────────┘
```

**API endpoints**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Service status + PayPal mode |
| `POST` | `/api/parse` | `{ "text" }` → parsed invoice fields |
| `POST` | `/api/invoice` | `{ "text" }` or explicit fields → PayPal invoice + `payment_link` |

## 🚀 Quick start (mock mode — no credentials needed)

```bash
cd backend
npm install
PAYPAL_MOCK=true node server.js
# open http://localhost:3000
```

## 🔑 Live Sandbox mode

1. Create a free app at https://developer.paypal.com/dashboard/applications/sandbox → copy **Client ID** and **Secret**.
2. Copy `.env.example` to `.env` and fill in the values (leave `PAYPAL_MOCK` unset/false).
3. `node server.js` — the badge in the UI switches from `MOCK mode` to `Sandbox live`.

> Sandbox only — no real money ever moves.

## 🧠 How the AI parsing works

`backend/lib/ai-parser.js` implements a layered parser:

1. **Email extraction** (regex)
2. **Amount + currency extraction** — handles `$50`, `€75`, `Rp50.000`, `250000 rupiah`, `1.5 juta`, `75rb`, `50k`, `USD/EUR/IDR/GBP/MYR/PHP/JPY/INR`
3. **Description extraction** — text after the last `for` / `buat` / `untuk`
4. **Recipient name extraction** — text after `to` / `ke` / `kepada`
5. **Confidence scoring** — fraction of fields successfully extracted

Set `OPENAI_API_KEY` to upgrade step 1–4 to an LLM (`gpt-4o-mini`, temperature 0, JSON-only output) with automatic fallback to the rule-based parser.

### Parser examples

| Input | amount | currency | recipient | description |
|---|---|---|---|---|
| `tagih $50 ke client buat desain logo` | 50 | USD | client | desain logo |
| `invoice 250000 rupiah to budi@gmail.com for website redesign` | 250000 | IDR | budi@gmail.com | website redesign |
| `charge €75 to maria@example.com for consulting` | 75 | EUR | maria@example.com | consulting |
| `bill 1.5 juta to siti@gmail.com untuk jasa fotografi` | 1500000 | IDR | siti@gmail.com | jasa fotografi |
| `tagih 75rb ke client@gmail.com buat edit video` | 75000 | IDR | client@gmail.com | edit video |

## 📁 Project structure

```
paypal-ai-hackathon/
├── README.md
├── LICENSE (MIT)
├── .env.example
├── .gitignore
├── backend/
│   ├── package.json
│   ├── server.js          # Express app + API routes
│   └── lib/
│       ├── ai-parser.js   # bilingual NL invoice parser (+ optional LLM)
│       └── paypal.js      # PayPal Invoicing API v2 client (+ mock mode)
└── frontend/
    ├── index.html
    ├── styles.css
    └── app.js
```

## 🧪 Testing

```bash
cd backend && npm install
# unit-test the parser (8 cases, EN + ID)
node -e "const {parseWithRules}=require('./lib/ai-parser'); /* ... */"
# start server in mock mode and hit the API
PAYPAL_MOCK=true node server.js &
curl -X POST localhost:3000/api/parse -H 'Content-Type: application/json' \
  -d '{"text":"tagih $50 ke client@example.com buat desain logo"}'
curl -X POST localhost:3000/api/invoice -H 'Content-Type: application/json' \
  -d '{"text":"tagih $50 ke client@example.com buat desain logo"}'
```

## 📜 License

MIT — see [LICENSE](LICENSE).
