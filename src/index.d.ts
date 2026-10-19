export type PaymentStatus = 'succeeded' | 'failed' | 'processing';

export interface MehfuzPayOptions {
  /** Defaults to https://mehfuzpay.com. Use http://localhost:5173 only for local development. */
  baseUrl?: string;
}

export interface CardAppearance {
  /** CSS font-family for the card inputs, e.g. "Inter, sans-serif". */
  fontFamily?: string;
  /** Between 10px and 24px, e.g. "16px". */
  fontSize?: string;
  /** Hex text colour, e.g. "#111827". */
  color?: string;
}

export interface CardElementOptions {
  /** The clientSecret your server received from POST /api/v1/store/payments. */
  clientSecret: string;
  appearance?: CardAppearance;
}

/** Billing address used for bank (3-D Secure) authentication. Never put card data here. */
export interface BillingDetails {
  line1: string;
  city: string;
  postalCode?: string;
  /** Only "PK" is supported. Defaults to "PK". */
  country?: 'PK';
}

export interface ConfirmPaymentError {
  code:
    | 'not_mounted'
    | 'not_ready'
    | 'in_progress'
    | 'already_submitted'
    | 'invalid_billing'
    | 'invalid_card'
    | 'card_entry_failed'
    | string;
  message: string;
}

/**
 * `status` is what the browser saw. Always confirm the payment on your server
 * (GET /api/v1/store/payments/:id or your webhook) before fulfilling the order.
 */
export type ConfirmPaymentResult =
  | { paymentId: string; status: PaymentStatus; error?: undefined }
  | { paymentId: string; error: ConfirmPaymentError; status?: undefined };

export interface CardElementEvents {
  ready: { paymentId: string };
  /** The payment was not open for card entry when the form loaded. */
  status: { paymentId: string; status: string };
  error: { code: 'expired' | 'unavailable' | string; message: string };
  /** Bank authentication is showing inside the card form. */
  authentication: { active: boolean };
}

export interface CardElement {
  readonly paymentId: string;
  readonly ready: boolean;
  mount(target: string | HTMLElement): CardElement;
  on<E extends keyof CardElementEvents>(event: E, handler: (payload: CardElementEvents[E]) => void): () => void;
  confirmPayment(options: { billing: BillingDetails }): Promise<ConfirmPaymentResult>;
  destroy(): void;
}

export class MehfuzPayError extends Error {
  readonly code: string;
}

export class MehfuzPay {
  readonly baseUrl: string;
  constructor(options?: MehfuzPayOptions);
  createCardElement(options: CardElementOptions): CardElement;
}

export function loadMehfuzPay(options?: MehfuzPayOptions): MehfuzPay;
export function parseClientSecret(clientSecret: string): { paymentId: string };
export function resolveBaseUrl(value?: string): string;
export function cleanBilling(billing: BillingDetails): Required<BillingDetails>;
