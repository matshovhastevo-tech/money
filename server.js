const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

// A deliberately small .env reader keeps the app dependency-free.
try {
  const envFile = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
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
    throw Object.assign(new Error('The image data could not be read. Please upload it again.'), { status: 400 });
  }
  const imageBytes = Buffer.from(base64, 'base64').length;
  if (!imageBytes || imageBytes > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error('Keep screenshots under 8 MB.'), { status: 413 });
  }
  const asset = String(payload.asset || 'Other').slice(0, 40);
  const timeframe = String(payload.timeframe || 'Unknown').slice(0, 24);
  return { base64, asset, timeframe, mimeType: payload.mimeType };
}

const SYSTEM_PROMPT = `You are Money Heist, a careful chart-image analyst. Analyze only what is visible in the supplied screenshot and the user's selected market/timeframe. This is educational chart commentary, not financial, investment, or trading advice. Never promise profits or certainty, and do not invent prices, indicators, labels, or chart details that are unreadable. State when the image is unclear or missing context. Do not recommend leverage or position size. Prefer conditional scenarios and explicit invalidation over directives. Return ONLY a valid JSON object with exactly these keys: summary (string), bias (one of "Bullish", "Bearish", "Range", "Unclear"), confidence (integer 0-100 reflecting image clarity and setup evidence, not likelihood of profit), trend (string), structure (string), keyLevels (array of objects with label and value strings), scenarios (array of objects with name, condition, observation strings), invalidation (string), riskNotes (array of strings), observations (array of strings). Keep language concise, explain uncertainty, and use "not visible" rather than guessing. If there is no legible price scale, keyLevels should be an empty array.`;

async function analyze(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
  if (!process.env.OPENAI_API_KEY) {
    return sendJson(res, 503, { error: 'AI analysis is not configured yet. Add OPENAI_API_KEY to a .env file, then restart the app.' });
  }

  try {
    const payload = await readJson(req);
    const { base64, asset, timeframe, mimeType } = validatePayload(payload);
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Analyze this chart screenshot. Selected market: ${asset}. Selected timeframe: ${timeframe}. Treat these selections as context only; note if the screenshot appears inconsistent.` },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } }
            ]
          }
        ]
      })
    });

    const result = await response.json();
    if (!response.ok) {
      const message = result.error && result.error.message ? result.error.message : 'The AI provider could not analyze this image.';
      return sendJson(res, response.status === 401 ? 502 : 502, { error: message });
    }
    const content = result.choices?.[0]?.message?.content;
    if (!content) return sendJson(res, 502, { error: 'The AI returned an empty analysis. Please try again.' });
    let analysis;
    try { analysis = JSON.parse(content); }
    catch { return sendJson(res, 502, { error: 'The AI response was not readable. Please try again.' }); }
    return sendJson(res, 200, { analysis });
  } catch (error) {
    if (res.headersSent || res.destroyed) return;
    const status = error.status || 500;
    return sendJson(res, status, { error: error.message || 'Something went wrong while analyzing the screenshot.' });
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
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    });
    if (req.method === 'HEAD') return res.end();
    res.end(content);
  });
});

server.listen(PORT, () => console.log(`Money Heist is ready at http://localhost:${PORT}`));
