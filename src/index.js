// @mehfuzpay/js — secure MehfuzPay card fields for a merchant's own checkout page.
//
// The card form is an iframe served by MehfuzPay. Card numbers, expiry and CVV are
// typed into that iframe and go straight to the payment processor, so neither this
// script, the merchant's page nor the merchant's server can read or store them.
// The page only ever learns a payment status, which must still be verified on the
// merchant's server before an order is fulfilled.

const PROTOCOL = 1;
const DEFAULT_BASE_URL = 'https://mehfuzpay.com';
const CLIENT_SECRET =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_secret_[a-f0-9]{64}$/;
const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_HEIGHT = 0; // the form collapses once the payment is submitted
const MAX_HEIGHT = 2000;

export class MehfuzPayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MehfuzPayError';
    this.code = code;
  }
}

const isLocalHost = (hostname) => hostname === 'localhost' || hostname === '127.0.0.1';

export function resolveBaseUrl(value = DEFAULT_BASE_URL) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new MehfuzPayError('invalid_base_url', 'baseUrl must be an absolute URL.');
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHost(url.hostname));
  if (!secure || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new MehfuzPayError('invalid_base_url', 'baseUrl must be an HTTPS origin such as https://mehfuzpay.com.');
  return url.origin;
}

export function parseClientSecret(clientSecret) {
  if (typeof clientSecret !== 'string' || !CLIENT_SECRET.test(clientSecret))
    throw new MehfuzPayError(
      'invalid_client_secret',
      'Pass the clientSecret your server received when it created the payment. Never put your API key in the browser.'
    );
  return { paymentId: clientSecret.slice(0, 36) };
}

// A defensive check: billing details must never carry a card number.
const looksLikeCardNumber = (text) => /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/.test(text);

export function cleanBilling(billing) {
  if (!billing || typeof billing !== 'object')
    throw new MehfuzPayError('invalid_billing', 'billing with line1 and city is required.');
  const field = (name, max, required) => {
    const value = billing[name];
    if (value === undefined || value === null || value === '') {
      if (required) throw new MehfuzPayError('invalid_billing', `billing.${name} is required.`);
      return '';
    }
    if (typeof value !== 'string' || value.trim().length > max)
      throw new MehfuzPayError('invalid_billing', `billing.${name} must be text up to ${max} characters.`);
    if (looksLikeCardNumber(value))
      throw new MehfuzPayError('card_data_not_allowed', 'Card numbers can only be typed into the secure card fields.');
    return value.trim();
  };
  const country = (field('country', 2, false) || 'PK').toUpperCase();
  if (country !== 'PK') throw new MehfuzPayError('invalid_billing', 'billing.country must be PK.');
  return {
    line1: field('line1', 120, true),
    city: field('city', 80, true),
    postalCode: field('postalCode', 20, false),
    country
  };
}

function cleanAppearance(appearance = {}) {
  const out = {};
  for (const key of ['fontFamily', 'fontSize', 'color'])
    if (typeof appearance[key] === 'string' && appearance[key].length <= 100) out[key] = appearance[key];
  return out;
}

function randomId(env, prefix) {
  const bytes = new Uint8Array(16);
  env.crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

class CardElement {
  #client;
  #env;
  #secret;
  #channel;
  #appearance;
  #iframe = null;
  #ready = false;
  #listeners = new Map();
  #pending = null;
  #onMessage = (event) => this.#receive(event);

  constructor(client, env, options = {}) {
    this.#client = client;
    this.#env = env;
    this.paymentId = parseClientSecret(options.clientSecret).paymentId;
    this.#secret = options.clientSecret;
    this.#appearance = cleanAppearance(options.appearance);
    this.#channel = randomId(env, 'ch_');
  }

  get ready() {
    return this.#ready;
  }

  mount(target) {
    if (this.#iframe) throw new MehfuzPayError('already_mounted', 'This card element is already mounted.');
    const document = this.#env.document;
    const container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container || typeof container.appendChild !== 'function')
      throw new MehfuzPayError('invalid_target', 'mount() needs an element or a CSS selector that exists on the page.');
    const params = new URLSearchParams({
      secret: this.#secret,
      origin: this.#env.location.origin,
      channel: this.#channel,
      appearance: JSON.stringify(this.#appearance)
    });
    const iframe = document.createElement('iframe');
    // The secret travels in the URL fragment, which browsers never send to a server.
    iframe.src = this.#client.baseUrl + '/elements/card#' + params.toString();
    iframe.title = 'Secure card payment form';
    iframe.setAttribute('allow', 'payment');
    iframe.setAttribute('scrolling', 'no');
    Object.assign(iframe.style, { border: '0', width: '100%', height: '72px', display: 'block', overflow: 'hidden' });
    this.#env.addEventListener('message', this.#onMessage);
    container.appendChild(iframe);
    this.#iframe = iframe;
    return this;
  }

  on(event, handler) {
    if (typeof handler !== 'function') throw new MehfuzPayError('invalid_handler', 'on() needs a function.');
    if (!this.#listeners.has(event)) this.#listeners.set(event, new Set());
    this.#listeners.get(event).add(handler);
    return () => this.#listeners.get(event)?.delete(handler);
  }

  confirmPayment({ billing } = {}) {
    const paymentId = this.paymentId;
    const fail = (code, message) => Promise.resolve({ paymentId, error: { code, message } });
    let cleaned;
    try {
      cleaned = cleanBilling(billing);
    } catch (error) {
      return Promise.reject(error);
    }
    if (!this.#iframe) return fail('not_mounted', 'Call mount() before confirmPayment().');
    if (!this.#ready) return fail('not_ready', 'The secure card fields are still loading.');
    if (this.#pending) return fail('in_progress', 'A confirmation is already running.');
    const requestId = randomId(this.#env, 'rq_');
    return new Promise((resolve) => {
      const timer = this.#env.setTimeout(() => this.#finish({ paymentId, status: 'processing' }), CONFIRM_TIMEOUT_MS);
      this.#pending = { requestId, resolve, timer };
      this.#iframe.contentWindow.postMessage(
        { mehfuzpay: PROTOCOL, channel: this.#channel, type: 'confirm', requestId, billing: cleaned },
        this.#client.baseUrl
      );
    });
  }

  destroy() {
    this.#env.removeEventListener('message', this.#onMessage);
    // An interrupted confirmation is not a failure: the payment may still complete.
    this.#finish({ paymentId: this.paymentId, status: 'processing' });
    this.#iframe?.remove();
    this.#iframe = null;
    this.#ready = false;
    this.#listeners.clear();
  }

  #finish(result) {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    this.#env.clearTimeout(pending.timer);
    pending.resolve(result);
  }

  #emit(event, payload) {
    for (const handler of this.#listeners.get(event) || []) {
      try {
        handler(payload);
      } catch (error) {
        this.#env.setTimeout(() => {
          throw error;
        }, 0);
      }
    }
  }

  #receive(event) {
    const data = event.data;
    if (
      !this.#iframe ||
      event.origin !== this.#client.baseUrl ||
      event.source !== this.#iframe.contentWindow ||
      !data ||
      data.mehfuzpay !== PROTOCOL ||
      data.channel !== this.#channel
    )
      return;
    switch (data.type) {
      case 'ready':
        this.#ready = true;
        this.#emit('ready', { paymentId: this.paymentId });
        break;
      case 'resize': {
        const height = Number(data.height);
        if (Number.isFinite(height))
          this.#iframe.style.height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(height))) + 'px';
        break;
      }
      case 'authentication':
        this.#emit('authentication', { active: data.active === true });
        break;
      case 'status':
        this.#emit('status', { paymentId: this.paymentId, status: String(data.status) });
        break;
      case 'load_error':
        this.#emit('error', {
          code: String(data.error?.code || 'unavailable'),
          message: String(data.error?.message || 'Secure card entry is unavailable.')
        });
        break;
      case 'result': {
        if (data.requestId !== this.#pending?.requestId) break;
        const result = { paymentId: this.paymentId };
        if (data.error) result.error = { code: String(data.error.code), message: String(data.error.message) };
        else result.status = ['succeeded', 'failed'].includes(data.status) ? data.status : 'processing';
        this.#finish(result);
        break;
      }
    }
  }
}

export class MehfuzPay {
  #env;
  constructor(options = {}, env = globalThis) {
    this.baseUrl = resolveBaseUrl(options.baseUrl);
    this.#env = env;
    const page = env.location;
    if (page && page.protocol !== 'https:' && !isLocalHost(page.hostname))
      throw new MehfuzPayError('insecure_page', 'Secure card fields only work on HTTPS pages (or localhost while testing).');
  }

  createCardElement(options) {
    return new CardElement(this, this.#env, options);
  }
}

export function loadMehfuzPay(options) {
  return new MehfuzPay(options);
}
