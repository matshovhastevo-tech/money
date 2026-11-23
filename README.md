# Money Heist — AI Chart Scanner

A mobile-friendly web app for AI-assisted analysis of trading chart screenshots. It supports Gold (XAUUSD), US30, NAS100, and selected forex pairs. The report describes visible chart structure, readable levels, and conditional scenarios; it is not a trading signal or financial advice.

## Run locally

Requirements: Node.js 18 or newer. No npm dependencies are needed.

1. Copy `.env.example` to `.env`.
2. Add your API key to `.env` (`OPENAI_API_KEY=...`). Keep `.env` private and never commit it.
3. Optionally set `OPENAI_MODEL` (defaults to `gpt-4o-mini`).
4. Run `npm start` and open [http://localhost:3000](http://localhost:3000).

The API key is used only by the server. Screenshots are held in memory for the request, sent to the configured OpenAI vision-capable model, and are not written to disk by this app. Provider data handling is subject to the provider's policies. Configure an appropriate vision model and API access for your account.

## Features

- Responsive workspace with drag-and-drop or browse-to-upload, plus mobile camera/gallery support where the browser provides it.
- Supports PNG, JPEG, and WebP screenshots up to 8 MB.
- Instrument and timeframe context for Gold, US30, NAS100, EURUSD, GBPUSD, USDJPY, and other charts.
- Structured AI report: bias, image/setup clarity, trend, structure, visible key levels, conditional scenarios, invalidation, risk/context notes, and observations.
- Does not save screenshots or keep a scan history.
- Server-side API key, input checks, basic security headers, and no third-party frontend dependencies.

## Notes

The analysis is limited to the screenshot, may misread chart elements, and does not have live quotes or economic-calendar context. Always verify levels and market conditions independently. AI-generated observations are educational and should not be treated as personalized financial advice or a recommendation to buy, sell, or hold.
