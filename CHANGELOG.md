# Changelog

All notable changes to this package are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## 0.1.0 — 2026-10-19

First sandbox preview.

- `loadMehfuzPay()` and `createCardElement({ clientSecret, appearance })`.
- Secure card fields in a MehfuzPay iframe, with bank authentication (3-D Secure) inside the frame
  and automatic resizing.
- `confirmPayment({ billing })` returning `succeeded`, `failed` or `processing`, or a typed error.
- Events: `ready`, `error`, `status`, `authentication`.
- TypeScript types, no runtime dependencies.
