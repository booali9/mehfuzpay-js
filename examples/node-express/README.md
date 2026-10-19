# Example: custom checkout with Node.js + Express

A complete, minimal checkout page using `@mehfuzpay/js` in the MehfuzPay sandbox.

```bash
npm install
cp .env.example .env    # then paste your mp_test_ key
npm start
```

Open <http://localhost:3000> and pay with the sandbox card `4456 5300 0000 1005`, any future
expiry, CVV `123`.

- `server.js` creates the payment with your secret key, returns only the `clientSecret`,
  verifies the final status and checks webhook signatures.
- `public/index.html` is your own checkout design with the secure card fields inside it.

To receive webhooks locally, expose port 3000 with an HTTPS tunnel and add
`https://<your-tunnel>/webhooks/mehfuzpay` in *Dashboard → Webhooks & deliveries*.
