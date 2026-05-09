# Ritual Prediction Arena

Static prediction market demo for the Ritual Testnet Wallet extension.

## Features

- Connects to the Ritual wallet through `window.ethereum`.
- Loads live crypto market data from CoinGecko.
- Refreshes prices every 60 seconds.
- Lets users choose YES or NO direction predictions.
- Signs off-chain prediction orders with `personal_sign`.
- Saves signed prediction history in local browser storage.

## Local Use

Open `index.html` in a browser where the Ritual wallet extension is installed.

## Deploy To Vercel

1. Push this folder to GitHub.
2. Open Vercel.
3. Click `Add New Project`.
4. Import this GitHub repository.
5. Keep the default static settings.
6. Deploy.

The free domain will look like:

```text
https://data-ritual-wallet-tesnet-extension-dan-prediksi-market.vercel.app
```

## Notes

This is a demo/off-chain prediction market. It signs orders but does not settle markets on-chain yet.
For real settlement, add smart contracts and an oracle flow later.
