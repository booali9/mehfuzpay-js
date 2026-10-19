// Minimal custom checkout with @mehfuzpay/js.
// The secret key stays here; the browser only ever receives the clientSecret.
import express from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const API = process.env.MEHFUZPAY_API_URL || 'https://mehfuzpay.com/api/v1/store';
const KEY = process.env.MEHFUZPAY_SECRET_KEY;
if (!KEY?.startsWith('mp_test_')) throw new Error('Set MEHFUZPAY_SECRET_KEY to your sandbox key (see .env.example)');

const mehfuzpay = (path, init = {}) =>
  fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
  }).then(async (r) => ({ ok: r.ok, body: await r.json() }));

const app = express();
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
// Serve the browser module from node_modules (a bundler would do this for you).
const packageFile = fileURLToPath(import.meta.resolve('@mehfuzpay/js'));
app.get('/vendor/mehfuzpay.js', (_req, res) => res.sendFile(packageFile, { dotfiles: 'allow' }));

// 1. Create the payment for an order (amounts in paisa).
app.post('/api/payment', async (_req, res) => {
  const reference = 'DEMO-' + Date.now();
  const { ok, body } = await mehfuzpay('/payments', {
    method: 'POST',
    body: JSON.stringify({
      orderReference: reference,
      idempotencyKey: randomUUID(),
      amountPaisa: 250000,
      currency: 'PKR',
      environment: 'sandbox',
      method: 'card',
      returnUrl: 'https://example.com/thank-you',
      cancelUrl: 'https://example.com/cart',
      payer: { firstName: 'Test', lastName: 'Customer', email: 'customer@example.com', phone: '+923001234567' }
    })
  });
  if (!ok) return res.status(502).json({ error: body.error });
  res.json({ clientSecret: body.clientSecret });
});

// 3. Verify on the server before showing "order confirmed".
app.get('/api/payment/:id', async (req, res) => {
  const { ok, body } = await mehfuzpay('/payments/' + encodeURIComponent(req.params.id));
  if (!ok) return res.status(502).json({ error: body.error });
  res.json({ status: body.status, orderReference: body.orderReference, amountPaisa: body.amountPaisa });
});

// Webhook: verify the signature over the raw body, then re-read the payment.
app.post('/webhooks/mehfuzpay', express.raw({ type: 'application/json' }), async (req, res) => {
  const header = Object.fromEntries(
    (req.get('X-MehfoozPay-Signature') || '').split(',').map((part) => part.split('='))
  );
  const expected = createHmac('sha256', process.env.MEHFUZPAY_WEBHOOK_SECRET || '')
    .update(`${header.t}.${req.body}`)
    .digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(header.t)) <= 300;
  const valid =
    fresh &&
    typeof header.v1 === 'string' &&
    header.v1.length === expected.length &&
    timingSafeEqual(Buffer.from(header.v1), Buffer.from(expected));
  if (!valid) return res.status(400).end();
  const event = JSON.parse(req.body);
  const { body } = await mehfuzpay('/payments/' + encodeURIComponent(event.resourceId));
  console.log('webhook', event.type, 'verified status:', body.status); // fulfil once when 'succeeded'
  res.status(200).end();
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Open http://localhost:${port}`));
