const crypto = require('crypto');

function generateKlingJWT() {
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;
  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 })).toString('base64url');
  const msg = header + '.' + payload;
  const sig = crypto.createHmac('sha256', secretKey).update(msg).digest('base64url');
  return msg + '.' + sig;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const jwt = generateKlingJWT();

    if (req.method === 'POST') {
      // Create video task
      const { prompt } = req.body;
      const resp = await fetch('https://api.klingai.com/v1/videos/text2video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + jwt },
        body: JSON.stringify({ model: 'kling-v1', prompt, duration: '5', aspect_ratio: '16:9', mode: 'std' })
      });
      const data = await resp.json();
      res.status(200).json(data);
    } else if (req.method === 'GET') {
      // Poll task status
      const taskId = req.query.taskId;
      const resp = await fetch('https://api.klingai.com/v1/videos/text2video/' + taskId, {
        headers: { 'Authorization': 'Bearer ' + jwt }
      });
      const data = await resp.json();
      res.status(200).json(data);
    }
  } catch (err) {
    console.error('Kling error:', err);
    res.status(500).json({ error: err.message });
  }
};
