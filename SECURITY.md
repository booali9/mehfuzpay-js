# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Email **business@mehfuzpay.com** with the subject `SECURITY: @mehfuzpay/js` and include:

- what you found and where (package version, page or API endpoint),
- steps to reproduce,
- the impact you expect.

We will acknowledge your report within 3 business days and keep you updated until it is fixed.
Please give us reasonable time to fix the issue before disclosing it publicly.

Never include real card numbers, CVVs or customer data in a report. Use sandbox data only.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x (sandbox preview) | Yes |

## How the package protects card data

- Card fields are rendered in an iframe served by MehfuzPay; the merchant page cannot read them.
- The client secret travels in the URL fragment (never sent to servers) and is removed from the
  frame's address after loading.
- Messages between the page and the frame are checked for origin, source window and channel.
- The package has no API that accepts card numbers, and the MehfuzPay API rejects any request
  containing one.
