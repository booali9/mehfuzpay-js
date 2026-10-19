# Contributing

Thanks for helping improve `@mehfuzpay/js`.

## Development

```bash
npm test
```

Tests use Node's built-in test runner (Node 20 or newer) and a small fake browser, so no extra
dependencies are needed.

## Pull requests

- Keep the package dependency-free and browser-only.
- Never add an API that accepts card numbers, expiry dates or CVVs.
- Add or update tests for every behaviour change, and update `README.md`, `src/index.d.ts` and
  `CHANGELOG.md` when the public API changes.

## Reporting bugs

Open an issue with the package version, browser, a minimal code sample and what you expected.
Do not include API keys, client secrets or card data. Security problems go to
[SECURITY.md](SECURITY.md), not public issues.
