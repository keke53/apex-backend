const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { system, messages, max_tokens } = req.body;
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: max_tokens || 4000,
      system,
      messages,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }]
    });
    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');
    res.status(200).json({ content: text, stop_reason: response.stop_reason });
  } catch (err) {
    console.error('Claude error:', err);
    res.status(500).json({ error: err.message });
  }
};
