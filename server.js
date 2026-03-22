import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import Database from 'better-sqlite3';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const db = new Database('libby.db');
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const knowledge = {
  steuern: {
    fakten: "Abgabenquote 43% (DE 40%, OECD 34%). Lohnsteuer +20% seit 2022. Obere 10% zahlen Hälfte der Lohnsteuer.",
    position: "Senkung auf 40% möglich. Deutschland schafft mit 40% Überschüsse, Österreich mit 43% Defizite.",
    details: "Zwischen 2001-2006 wurde Quote bereits um 3,7 Prozentpunkte gesenkt."
  },
  pensionen: {
    fakten: "Antritt faktisch 60J (EU: 64J). 21 Jahre Ruhestand. Zuschuss 8 Mrd/Jahr.",
    position: "Antrittsalter an Lebenserwartung koppeln. +2 Monate/Jahr bis 67J.",
    details: "72% der Wähler profitieren vom Status Quo."
  },
  buerokratie: {
    fakten: "Österreich Bürokratie-Champion. Lange Genehmigungen.",
    position: "One-Stop-Shops. Verwaltung verschlanken.",
    details: "Unternehmen verschwenden Milliarden Stunden."
  },
  schulden: {
    fakten: "78% BIP = 32.000€/Kopf. 7 Mrd Zinsen/Jahr.",
    position: "Ausgabenbremse. Problem sind Ausgaben, nicht Einnahmen.",
    details: "Ausgaben über 50% BIP."
  }
};

function getRelevantKnowledge(message) {
  const msg = message.toLowerCase();
  let context = '';
  if (msg.match(/steuer|abgabe|lohn/)) context += `STEUERN: ${knowledge.steuern.fakten} ${knowledge.steuern.position}\n`;
  if (msg.match(/pension|rente|alter/)) context += `PENSIONEN: ${knowledge.pensionen.fakten} ${knowledge.pensionen.position}\n`;
  if (msg.match(/büro|verwaltung/)) context += `BÜROKRATIE: ${knowledge.buerokratie.fakten}\n`;
  if (msg.match(/schuld|budget|ausgabe/)) context += `SCHULDEN: ${knowledge.schulden.fakten}\n`;
  return context;
}

function getConversationHistory(sessionId, limit = 6) {
  const stmt = db.prepare(`SELECT user_message, assistant_message FROM conversations WHERE session_id = ? ORDER BY id DESC LIMIT ?`);
  const rows = stmt.all(sessionId, limit);
  const messages = [];
  for (const row of rows.reverse()) {
    messages.push({ role: 'user', content: row.user_message });
    messages.push({ role: 'assistant', content: row.assistant_message });
  }
  return messages;
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId = 'default' } = req.body;
    const history = getConversationHistory(sessionId, 6);
    const relevantKnowledge = getRelevantKnowledge(message);
    
    const systemPrompt = `Du bist Libby, 28, Ökonomin bei Agenda Austria Wien.

VARIIERE deine Antworten (nicht immer Fragen):
- Direkte Aussage mit Zahlen
- Konkrete, beantwortbare Gegenfragen
- Pointierte Bemerkungen

Max 15 Wörter, selbstbewusst, konkret.

${relevantKnowledge ? 'WISSEN:\n' + relevantKnowledge : ''}`;

    history.push({ role: 'user', content: message });
    
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 70,
      system: systemPrompt,
      messages: history
    });
    
    const assistantMessage = response.content[0].text;
    const insert = db.prepare(`INSERT INTO conversations (session_id, user_message, assistant_message, context) VALUES (?, ?, ?, ?)`);
    const result = insert.run(sessionId, message, assistantMessage, relevantKnowledge || '');
    
    res.json({ message: assistantMessage, conversationId: result.lastInsertRowid });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Fehler' });
  }
});

app.post('/api/feedback', (req, res) => {
  try {
    const { conversationId, feedback } = req.body;
    db.prepare('UPDATE conversations SET feedback = ? WHERE id = ?').run(feedback, conversationId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Fehler' });
  }
});

app.get('/api/stats', (req, res) => {
  const stats = {
    total: db.prepare('SELECT COUNT(*) as count FROM conversations').get().count,
    positive: db.prepare('SELECT COUNT(*) as count FROM conversations WHERE feedback = 1').get().count,
    negative: db.prepare('SELECT COUNT(*) as count FROM conversations WHERE feedback = -1').get().count
  };
  res.json(stats);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Libby läuft auf Port ${PORT}`));
