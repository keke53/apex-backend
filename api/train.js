const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET);

const AGENTS = [
  { key: 'kine',     name: 'Marc Revel',        role: 'kinésithérapeute spécialisé sport' },
  { key: 'hand',     name: 'Stefan Kovač',       role: 'coach handball élite' },
  { key: 'muscu',    name: 'Alexandre Petit',    role: 'coach musculation et force' },
  { key: 'mobilite', name: 'Dr. Kenji Watanabe', role: 'expert mobilité et mouvement' },
  { key: 'foot',     name: 'Marco Delgado',      role: 'coach football élite' },
  { key: 'basket',   name: 'Tony Reeves',        role: 'coach basketball élite' },
  { key: 'natation', name: 'Claire Fontaine',    role: 'coach natation élite' },
  { key: 'gym',      name: 'Isabelle Marchetti', role: 'coach gymnastique élite' },
  { key: 'course',   name: 'Julien Marais',      role: 'coach course à pied élite' },
  { key: 'volley',   name: 'Marco Benedetti',    role: 'coach volleyball élite' },
  { key: 'athle',    name: 'Dr. Amara Diallo',   role: 'coach athlétisme élite' },
  { key: 'nutri',    name: 'Dr. Léa Rousseau',   role: 'nutritionniste sport élite' },
];

async function loadMemories(agentKey) {
  const { data } = await supabase.from('agent_memories').select('*').eq('agent', agentKey).order('created_at', { ascending: false }).limit(5);
  return data || [];
}

async function saveMemory(agentKey, learned, rule, score) {
  await supabase.from('agent_memories').insert([{ agent: agentKey, learned, rule, score }]);
}

async function loadUserProfil() {
  const { data } = await supabase.from('agent_memories').select('learned').eq('agent', 'user_profil').order('created_at', { ascending: false }).limit(1);
  if (!data || !data.length) return null;
  try { return JSON.parse(data[0].learned); } catch(e) { return null; }
}

async function trainAgent(agent, profilStr) {
  const memories = await loadMemories(agent.key);
  const memoriesStr = memories.map(m => `- ${m.learned} | Score: ${m.score}/10`).join('\n') || 'Aucune mémoire encore.';

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001', // Haiku = 5x plus rapide
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Tu es ${agent.name}, ${agent.role}.
Athlète: ${profilStr}
Tes mémoires: ${memoriesStr}

Génère 2 nouvelles règles courtes pour mieux aider cet athlète.
Réponds UNIQUEMENT en JSON: {"regles":["règle1","règle2"],"note":"observation courte"}`
    }]
  });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const clean = text.replace(/```json|```/g, '').trim();
  const result = JSON.parse(clean);

  for (const rule of (result.regles || [])) {
    await saveMemory(agent.key, `[AUTO-TRAIN] ${rule}`, rule, 8);
  }
  return result;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const log = [];
  const startTime = Date.now();

  try {
    const userProfil = await loadUserProfil();
    const profilStr = userProfil
      ? `${userProfil.profil?.nom || 'Kerim'}, ${userProfil.profil?.age || 22} ans, ${userProfil.profil?.sport || 'cyclo-cross'}. Blessures: ${(userProfil.injuries || []).join(', ')}.`
      : 'Kerim, 22 ans, cyclo-cross, subluxation épaule gauche, TDAH, hyperlaxité.';

    // Train all agents in parallel — much faster
    const results = await Promise.allSettled(
      AGENTS.map(agent => trainAgent(agent, profilStr).then(r => ({ key: agent.key, ...r })))
    );

    for (const r of results) {
      if (r.status === 'fulfilled') log.push(`✅ ${r.value.key}: ${(r.value.regles||[]).join(' | ')}`);
      else log.push(`❌ ${r.reason?.message || 'erreur'}`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log.push(`Terminé en ${duration}s`);
    res.status(200).json({ success: true, duration, log });
  } catch(err) {
    res.status(500).json({ error: err.message, log });
  }
};
