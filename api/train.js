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
  const { data } = await supabase
    .from('agent_memories')
    .select('*')
    .eq('agent', agentKey)
    .order('created_at', { ascending: false })
    .limit(10);
  return data || [];
}

async function saveMemory(agentKey, learned, rule, score) {
  await supabase.from('agent_memories').insert([{ agent: agentKey, learned, rule, score }]);
}

async function loadUserProfil() {
  const { data } = await supabase
    .from('agent_memories')
    .select('learned')
    .eq('agent', 'user_profil')
    .order('created_at', { ascending: false })
    .limit(1);
  if (!data || !data.length) return null;
  try { return JSON.parse(data[0].learned); } catch(e) { return null; }
}

async function trainAgent(agent, userProfil, log) {
  // Load past memories
  const memories = await loadMemories(agent.key);
  const longMem = await loadMemories(agent.key + '_longmem');
  const summaries = await loadMemories(agent.key + '_summary');

  const profilStr = userProfil
    ? `Athlète: ${userProfil.profil?.nom || 'Kerim'}, ${userProfil.profil?.age || 22} ans, ${userProfil.profil?.sport || 'cyclo-cross'}. Blessures: ${(userProfil.injuries || []).join(', ')}.`
    : 'Athlète: Kerim, 22 ans, cyclo-cross, subluxation épaule gauche.';

  const memoriesStr = memories.map(m => `- ${m.learned} | Règle: ${m.rule} | Score: ${m.score}/10`).join('\n') || 'Aucune mémoire encore.';
  const summariesStr = summaries.map(m => m.learned).join('\n') || 'Aucun résumé encore.';

  const prompt = `Tu es ${agent.name}, ${agent.role} sur la plateforme APEX Sport.

PROFIL ATHLÈTE:
${profilStr}

TES MÉMOIRES PASSÉES (feedbacks et apprentissages):
${memoriesStr}

TES RÉSUMÉS DE SESSIONS:
${summariesStr}

MISSION D'AUTO-ENTRAÎNEMENT:
Analyse tes interactions passées avec Kerim et génère:
1. Ce que tu as bien fait (max 2 points)
2. Ce que tu aurais dû faire différemment (max 2 points)  
3. 3 nouvelles règles concrètes que tu t'engages à suivre désormais
4. Une question que tu poserais à un autre agent (kiné, muscu, mobilité) pour mieux aider Kerim

Réponds en JSON strict:
{
  "bien_fait": ["point1", "point2"],
  "a_ameliorer": ["point1", "point2"],
  "nouvelles_regles": ["règle1", "règle2", "règle3"],
  "question_inter_agent": {"destinataire": "kine|muscu|mobilite", "question": "..."}
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let result;
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    result = JSON.parse(clean);
  } catch(e) {
    log.push(`[${agent.key}] Parse error: ${e.message}`);
    return;
  }

  // Save new rules as memories
  for (const rule of (result.nouvelles_regles || [])) {
    await saveMemory(agent.key, `[AUTO-TRAIN] ${rule}`, rule, 8);
  }

  // Update long memory with training results
  const longMemData = longMem.length > 0
    ? (() => { try { return JSON.parse(longMem[0].learned); } catch(e) { return {}; } })()
    : {};

  longMemData.lastTraining = new Date().toISOString();
  longMemData.bienFait = result.bien_fait || [];
  longMemData.aAmeliorer = result.a_ameliorer || [];
  longMemData.regles = (longMemData.regles || []).concat(result.nouvelles_regles || []).slice(-10);

  await saveMemory(
    agent.key + '_longmem',
    JSON.stringify(longMemData),
    'fiche longue mémoire auto-training',
    10
  );

  // Handle inter-agent question
  if (result.question_inter_agent && result.question_inter_agent.question) {
    const dest = result.question_inter_agent.destinataire;
    const question = result.question_inter_agent.question;
    await saveMemory(
      dest + '_questions',
      `[QUESTION DE ${agent.key.toUpperCase()}] ${question}`,
      `répondre à ${agent.key}`,
      9
    );
  }

  log.push(`[${agent.key}] ✅ ${result.nouvelles_regles?.length || 0} règles générées`);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Verify cron secret to prevent abuse (optional but recommended)
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET || 'apex-cron-2026';
  if (authHeader && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const log = [];
  const startTime = Date.now();

  try {
    log.push(`[APEX TRAIN] Démarrage ${new Date().toISOString()}`);

    // Load user profil
    const userProfil = await loadUserProfil();
    log.push(`[APEX TRAIN] Profil: ${userProfil ? '✅' : '⚠️ non trouvé'}`);

    // Train each agent sequentially (avoid rate limits)
    for (const agent of AGENTS) {
      try {
        await trainAgent(agent, userProfil, log);
        // Small delay between agents to avoid rate limits
        await new Promise(r => setTimeout(r, 500));
      } catch(e) {
        log.push(`[${agent.key}] ❌ Error: ${e.message}`);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    log.push(`[APEX TRAIN] Terminé en ${duration}s`);

    res.status(200).json({ success: true, duration, log });
  } catch(err) {
    log.push(`[APEX TRAIN] FATAL: ${err.message}`);
    res.status(500).json({ error: err.message, log });
  }
};
