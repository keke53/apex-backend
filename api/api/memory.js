const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'POST') {
      // Save memory
      const { agent, learned, rule, score } = req.body;
      const { data, error } = await supabase
        .from('agent_memories')
        .insert([{ agent, learned, rule, score }]);
      if (error) throw error;
      res.status(200).json({ success: true });
    } else if (req.method === 'GET') {
      // Load memory
      const agent = req.query.agent;
      const { data, error } = await supabase
        .from('agent_memories')
        .select('*')
        .eq('agent', agent)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      res.status(200).json({ memories: data });
    }
  } catch (err) {
    console.error('Supabase error:', err);
    res.status(500).json({ error: err.message });
  }
};
