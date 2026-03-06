export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Missing GEMINI_API_KEY on the server.'
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'gemini-2.5-flash';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const history = Array.isArray(body.history) ? body.history : [];
    const guestInfo = body.guestInfo && typeof body.guestInfo === 'object' ? body.guestInfo : {};
    const systemPrompt = typeof body.systemPrompt === 'string' ? body.systemPrompt.trim() : '';

    if (!message) {
      return res.status(400).json({ error: 'Missing message.' });
    }

    const safeHistory = history
      .filter((item) => item && typeof item.content === 'string' && item.content.trim())
      .slice(-12)
      .map((item) => ({
        role: item.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: item.content.trim().slice(0, 4000) }]
      }));

    const guestSummary = Object.entries(guestInfo)
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
      .map(([key, value]) => `${key}: ${String(value).trim()}`)
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
        parts: [{ text: systemPrompt }]
      };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
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
        error: upstreamMessage,
        details: data
      });
    }

    const reply = extractReply(data);

    if (!reply) {
      return res.status(502).json({
        error: 'Gemini returned no text reply.',
        details: data
      });
    }

    return res.status(200).json({ reply, raw: data });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || 'Unexpected server error.'
    });
  }
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
