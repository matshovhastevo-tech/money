const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

try {
  const envFile = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(value));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) {
        reject(Object.assign(new Error('Request is too large.'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(Object.assign(new Error('Invalid JSON request.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function validatePayload(payload) {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!payload || !allowedTypes.includes(payload.mimeType) || typeof payload.image !== 'string') {
    throw Object.assign(new Error('Upload a PNG, JPEG, or WebP chart screenshot.'), { status: 400 });
  }
  const base64 = payload.image.replace(/^data:image\/(?:jpeg|png|webp);base64,/, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64)) {
    throw Object.assign(new Error('The image data could not be read.'), { status: 400 });
  }
  const imageBytes = Buffer.from(base64, 'base64').length;
  if (!imageBytes || imageBytes > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error('Keep screenshots under 10 MB.'), { status: 413 });
  }
  return {
    base64, mimeType: payload.mimeType,
    asset: String(payload.asset || 'Other').slice(0, 50),
    timeframe: String(payload.timeframe || 'Unknown').slice(0, 24),
    platform: String(payload.platform || 'Unknown').slice(0, 24),
    higherTimeframe: String(payload.higherTimeframe || 'Not specified').slice(0, 24)
  };
}

const SYSTEM_PROMPT = `You are Money Heist, a cautious professional chart screenshot analyst. Analyze one supplied screenshot as visible evidence only. It may come from MetaTrader or TradingView and may contain candlesticks. Never invent unreadable prices or labels. Return ONLY valid JSON with exactly these keys:
{
  "summary":"string",
  "decision":"BUY|SELL|WAIT",
  "bias":"Bullish|Bearish|Range|Unclear",
  "confidence":0-100,
  "imageQuality":"string",
  "marketContext":{"trend":"string","momentum":"string","structure":"string","volatility":"string","session":"string"},
  "candles":{"pattern":"string","strength":"Weak|Moderate|Strong|Unclear","observation":"string"},
  "marketStructure":{"bos":"string","choch":"string","swingHighs":"array<string>","swingLows":"array<string>"},
  "zones":{"support":"array<string>","resistance":"array<string>","orderBlocks":"array<string>","fairValueGaps":"array<string>","liquidity":"array<string>","supplyDemand":"array<string>"},
  "liquiditySweep":{"detected":true|false|"Unclear","observation":"string"},
  "multiTimeframe":{"selected":"string","higherTimeframe":"string","alignment":"Aligned|Mixed|Countertrend|Unclear","reason":"string"},
  "setup":{"entry":"string","confirmation":"string","stopLoss":"string","target1":"string","target2":"string","riskReason":"string","invalidatedAt":"string"},
  "scenarios":{"bullish":"string","bearish":"string","neutral":"string"},
  "riskNotes":"array<string>",
  "checks":"array<string>"
}
Confidence means clarity/evidence quality, not probability of profit. A setup entry and stop-loss must be conditional, nearby, and only offered when a readable price scale exists. Never promise profits. Explain if live quote/time confirmation is unavailable. A BUY/SELL decision should have strong visible evidence; otherwise WAIT. Do not provide leverage or position size. Use strings for readable visible values and 'Not visible' for unavailable values.`;

async function analyze(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
  if (!process.env.OPENAI_API_KEY) {
    return sendJson(res, 503, { error: 'Add OPENAI_API_KEY to .env and restart the app.' });
  }
  try {
    const payload = await readJson(req);
    const data = validatePayload(payload);
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.15,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            { type: 'text', text: `Analyze this chart. Instrument: ${data.asset}. Platform: ${data.platform}. Selected timeframe: ${data.timeframe}. Higher timeframe context requested: ${data.higherTimeframe}. Identify visible candlestick behavior, trend, momentum, structure, support/resistance, liquidity sweeps, FVGs, order blocks, BoS and CHoCH. Use conditional educational language only.` },
            { type: 'image_url', image_url: { url: `data:${data.mimeType};base64,${data.base64}`, detail: 'high' } }
          ] }
        ]
      })
    });
    const result = await response.json();
    if (!response.ok) {
      const message = result.error?.message || 'The AI provider could not analyze this image.';
      return sendJson(res, 502, { error: message });
    }
    const content = result.choices?.[0]?.message?.content;
    if (!content) return sendJson(res, 502, { error: 'The AI returned an empty analysis.' });
    let analysis;
    try { analysis = JSON.parse(content); }
    catch { return sendJson(res, 502, { error: 'The AI response could not be parsed. Please retry.' }); }
    return sendJson(res, 200, { analysis });
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || 'Something went wrong.' });
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/analyze') return analyze(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.resolve(ROOT, requested);
  if (!filePath.startsWith(ROOT + path.sep)) return sendJson(res, 403, { error: 'Forbidden.' });
  fs.readFile(filePath, (error, content) => {
    if (error) return sendJson(res, 404, { error: 'Not found.' });
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    });
    if (req.method === 'HEAD') return res.end();
    res.end(content);
  });
});

server.listen(PORT, () => console.log(`Money Heist is ready at http://localhost:${PORT}`));
