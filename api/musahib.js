const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;
const rateBucket = new Map();

const ALLOWED_ORIGINS = new Set([
  'https://sagainisch.vercel.app',
  'https://www.sagainisch.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]);

const MODEL = 'gemini-2.5-flash';
const MAX_MESSAGE_LENGTH = 1500;
const MAX_HISTORY_ITEMS = 12;
const MAX_HISTORY_CHARS = 4000;

export default async function handler(req, res) {
  const origin = req.headers.origin;
  applyCors(origin, res);

  if (req.method === 'OPTIONS') {
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return res.status(403).json({ error: 'Origin not allowed.' });
    }
    return res.status(204).end();
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const ip = getClientIp(req);
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    return res.status(429).json({ error: 'Too many requests. Please try again in a minute.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY on the server.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const history = Array.isArray(body.history) ? body.history : [];
    const guestInfo = body.guestInfo && typeof body.guestInfo === 'object' ? body.guestInfo : {};
    const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';

    if (!message) {
      return res.status(400).json({ error: 'Missing message.' });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Message too long. Keep it under ${MAX_MESSAGE_LENGTH} characters.` });
    }

    const safeHistory = history
      .filter((item) => item && typeof item.content === 'string' && item.content.trim())
      .slice(-MAX_HISTORY_ITEMS)
      .map((item) => ({
        role: item.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: item.content.trim().slice(0, MAX_HISTORY_CHARS) }]
      }));

    const guestSummary = Object.entries(guestInfo)
      .filter(([key, value]) => (
        typeof key === 'string' &&
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ''
      ))
      .map(([key, value]) => `${sanitizeKey(key)}: ${String(value).trim().slice(0, 300)}`)
      .join('\n');

    const contents = [
      ...safeHistory,
      {
        role: 'user',
        parts: [{
          text: guestSummary
            ? `${message}\n\nGuest details already collected:\n${guestSummary}`
            : message
        }]
      }
    ];

    const payload = {
      contents,
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 700
      }
    };

    if (systemPrompt) {
      payload.systemInstruction = {
        role: 'system',
        parts: [{ text: systemPrompt.slice(0, 12000) }]
      };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const upstreamMessage =
        data?.error?.message ||
        data?.error ||
        `Gemini request failed with status ${response.status}`;

      return res.status(response.status).json({
        error: upstreamMessage
      });
    }

    const reply = extractReply(data);

    if (!reply) {
      return res.status(502).json({
        error: 'Gemini returned no text reply.'
      });
    }

    return res.status(200).json({ reply });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || 'Unexpected server error.'
    });
  }
}

function applyCors(origin, res) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateBucket.get(ip);

  if (!bucket || now - bucket.start >= RATE_WINDOW_MS) {
    rateBucket.set(ip, { start: now, count: 1 });
    cleanupRateBucket(now);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - bucket.start)) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function cleanupRateBucket(now) {
  for (const [ip, bucket] of rateBucket.entries()) {
    if (now - bucket.start >= RATE_WINDOW_MS) {
      rateBucket.delete(ip);
    }
  }
}

function sanitizeKey(key) {
  return key.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 60) || 'field';
}

function extractReply(data) {
  if (!data || !Array.isArray(data.candidates)) return '';

  for (const candidate of data.candidates) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) continue;

    const text = parts
      .map((part) => typeof part?.text === 'string' ? part.text : '')
      .join('')
      .trim();

    if (text) return text;
  }

  return '';
}
