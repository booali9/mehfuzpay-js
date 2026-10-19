import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MehfuzPay, MehfuzPayError, parseClientSecret, resolveBaseUrl, cleanBilling } from '../src/index.js';

const SECRET = '6f1c2b0e-8a7d-4c3e-9b1a-2d4e6f8a0b1c_secret_' + 'ab'.repeat(32);
const BASE = 'https://mehfuzpay.com';

// Just enough of a browser to drive the element.
function fakeBrowser(origin = 'https://shop.example') {
  const url = new URL(origin);
  const listeners = new Set();
  const timers = new Map();
  let nextTimer = 1;
  const posted = [];
  const frameWindow = { postMessage: (data, targetOrigin) => posted.push({ data, targetOrigin }) };
  const container = { children: [], appendChild(node) { this.children.push(node); node.parent = this; } };
  const env = {
    location: { origin: url.origin, protocol: url.protocol, hostname: url.hostname },
    crypto: globalThis.crypto,
    addEventListener: (type, fn) => type === 'message' && listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
    setTimeout: (fn) => (timers.set(nextTimer, fn), nextTimer++),
    clearTimeout: (id) => timers.delete(id),
    document: {
      querySelector: (selector) => (selector === '#card' ? container : null),
      createElement: () => ({
        style: {},
        attributes: {},
        contentWindow: frameWindow,
        setAttribute(name, value) { this.attributes[name] = value; },
        remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); }
      })
    }
  };
  const iframe = () => container.children[0];
  const channel = () => new URLSearchParams(iframe().src.split('#')[1]).get('channel');
  const deliver = (data, { from = BASE, source = frameWindow } = {}) =>
    [...listeners].forEach((fn) => fn({ origin: from, source, data }));
  const fromFrame = (type, extra = {}, opts) => deliver({ mehfuzpay: 1, channel: channel(), type, ...extra }, opts);
  return { env, container, posted, listeners, timers, iframe, channel, deliver, fromFrame };
}

const billing = { line1: 'Office 8, Uni Center', city: 'Karachi' };

test('validates configuration before anything is shown', () => {
  assert.equal(resolveBaseUrl(), BASE);
  assert.equal(resolveBaseUrl('http://localhost:5173'), 'http://localhost:5173');
  for (const bad of ['http://mehfuzpay.com', 'https://mehfuzpay.com/elements', 'https://u:p@mehfuzpay.com', 'nope'])
    assert.throws(() => resolveBaseUrl(bad), { code: 'invalid_base_url' });
  assert.equal(parseClientSecret(SECRET).paymentId, '6f1c2b0e-8a7d-4c3e-9b1a-2d4e6f8a0b1c');
  for (const bad of [undefined, 'sk_test_123', SECRET.replace('_secret_', '_'), SECRET + 'a'])
    assert.throws(() => parseClientSecret(bad), { code: 'invalid_client_secret' });
  assert.throws(() => new MehfuzPay({}, fakeBrowser('http://shop.example').env), { code: 'insecure_page' });
  assert.doesNotThrow(() => new MehfuzPay({}, fakeBrowser('http://localhost:3000').env));
});

test('mounts an isolated iframe and keeps the secret out of the request URL', () => {
  const b = fakeBrowser();
  const card = new MehfuzPay({}, b.env).createCardElement({ clientSecret: SECRET, appearance: { color: '#111', evil: 'x' } });
  card.mount('#card');
  const frame = b.iframe();
  const [path, fragment] = frame.src.split('#');
  assert.equal(path, BASE + '/elements/card');
  const params = new URLSearchParams(fragment);
  assert.equal(params.get('secret'), SECRET);
  assert.equal(params.get('origin'), 'https://shop.example');
  assert.deepEqual(JSON.parse(params.get('appearance')), { color: '#111' });
  assert.equal(frame.attributes.allow, 'payment');
  assert.throws(() => card.mount('#card'), { code: 'already_mounted' });
  assert.throws(() => new MehfuzPay({}, b.env).createCardElement({ clientSecret: SECRET }).mount('#missing'), {
    code: 'invalid_target'
  });
});

test('ignores messages from other origins, windows or elements', () => {
  const b = fakeBrowser();
  const card = new MehfuzPay({}, b.env).createCardElement({ clientSecret: SECRET }).mount('#card');
  let ready = 0;
  card.on('ready', () => ready++);
  b.fromFrame('ready', {}, { from: 'https://evil.example' });
  b.fromFrame('ready', {}, { source: {} });
  b.deliver({ mehfuzpay: 1, channel: 'ch_other', type: 'ready' });
  b.deliver({ mehfuzpay: 2, channel: b.channel(), type: 'ready' });
  assert.equal(ready, 0);
  assert.equal(card.ready, false);
  b.fromFrame('ready');
  assert.equal(ready, 1);
  assert.equal(card.ready, true);
  b.fromFrame('resize', { height: 999999 });
  assert.equal(b.iframe().style.height, '2000px');
  b.fromFrame('resize', { height: -5 });
  assert.equal(b.iframe().style.height, '0px');
  b.fromFrame('resize', { height: 'x' });
  assert.equal(b.iframe().style.height, '0px');
});

test('confirmPayment talks only to the MehfuzPay frame and resolves with its result', async () => {
  const b = fakeBrowser();
  const card = new MehfuzPay({}, b.env).createCardElement({ clientSecret: SECRET }).mount('#card');
  assert.equal((await card.confirmPayment({ billing })).error.code, 'not_ready');
  b.fromFrame('ready');
  const promise = card.confirmPayment({ billing });
  assert.equal((await card.confirmPayment({ billing })).error.code, 'in_progress');
  assert.equal(b.posted.length, 1);
  const { data, targetOrigin } = b.posted[0];
  assert.equal(targetOrigin, BASE);
  assert.equal(data.type, 'confirm');
  assert.deepEqual(data.billing, { line1: 'Office 8, Uni Center', city: 'Karachi', postalCode: '', country: 'PK' });
  b.fromFrame('result', { requestId: 'rq_wrong', status: 'succeeded' });
  b.fromFrame('result', { requestId: data.requestId, status: 'succeeded' }, { from: 'https://evil.example' });
  b.fromFrame('result', { requestId: data.requestId, status: 'succeeded' });
  assert.deepEqual(await promise, { paymentId: card.paymentId, status: 'succeeded' });
  assert.equal(b.timers.size, 0, 'timeout cleared');
});

test('unexpected statuses become processing, errors pass through', async () => {
  const b = fakeBrowser();
  const card = new MehfuzPay({}, b.env).createCardElement({ clientSecret: SECRET }).mount('#card');
  b.fromFrame('ready');
  let p = card.confirmPayment({ billing });
  b.fromFrame('result', { requestId: b.posted.at(-1).data.requestId, status: 'paid!' });
  assert.equal((await p).status, 'processing');
  p = card.confirmPayment({ billing });
  b.fromFrame('result', { requestId: b.posted.at(-1).data.requestId, error: { code: 'invalid_card', message: 'Check' } });
  assert.deepEqual((await p).error, { code: 'invalid_card', message: 'Check' });
});

test('billing can never carry card data', () => {
  assert.throws(() => cleanBilling({ line1: '4111 1111 1111 1111', city: 'Karachi' }), { code: 'card_data_not_allowed' });
  assert.throws(() => cleanBilling({ city: 'Karachi' }), { code: 'invalid_billing' });
  assert.throws(() => cleanBilling({ ...billing, country: 'US' }), { code: 'invalid_billing' });
  assert.throws(() => cleanBilling({ ...billing, city: 5 }), MehfuzPayError);
});

test('destroy cleans up and an interrupted payment is reported as processing', async () => {
  const b = fakeBrowser();
  const card = new MehfuzPay({}, b.env).createCardElement({ clientSecret: SECRET }).mount('#card');
  b.fromFrame('ready');
  const p = card.confirmPayment({ billing });
  card.destroy();
  assert.equal((await p).status, 'processing');
  assert.equal(b.container.children.length, 0);
  assert.equal(b.listeners.size, 0);
  assert.equal(b.timers.size, 0);
});
