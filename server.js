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
  agenda: {
    basis: "Agenda Austria = unabhängiger liberaler Think-Tank in Wien. Motto: 'Unabhängig aber nicht neutral'. Gegründet für bessere Zukunft Österreichs.",
    themen: "Steuern, Pensionen, Staatsschulden, Bürokratie, Bildung, Arbeitsmarkt, Wettbewerb, Wirtschaftspolitik.",
    position: "Liberal-marktwirtschaftlich. Für weniger Staat, mehr Eigenverantwortung, Wettbewerb statt Regulierung."
  },
  steuern: {
    fakten: "Abgabenquote 43% (DE 40%, OECD 34%). Lohnsteuer +20% seit 2022. Obere 10% zahlen Hälfte der Lohnsteuer.",
    position: "Senkung auf 40% möglich. Deutschland schafft mit 40% Überschüsse, Österreich mit 43% Defizite.",
    details: "Zwischen 2001-2006 wurde Quote bereits um 3,7 Prozentpunkte gesenkt."
  },
  pensionen: {
    fakten: "Antritt faktisch 60J (EU: 64J). 21 Jahre Ruhestand. Zuschuss 8 Mrd/Jahr.",
    position: "Antrittsalter an Lebenserwartung koppeln (schwedisches Modell). +2 Monate/Jahr bis 67J.",
    details: "72% der Wähler profitieren vom Status Quo."
  },
  buerokratie: {
    fakten: "Österreich Bürokratie-Champion Europas. Lange Genehmigungen, Milliarden für Formulare.",
    position: "One-Stop-Shops. Verwaltung verschlanken. Digitalisierung statt Papier.",
    details: "Unternehmen verschwenden Milliarden Stunden jährlich für Behörden."
  },
  schulden: {
    fakten: "78% BIP = 32.000€/Kopf. 7 Mrd Zinsen/Jahr. Rekordhöhe trotz Wirtschaftswachstum.",
    position: "Ausgabenbremse wie Schweiz. Problem sind Ausgaben, nicht Einnahmen.",
    details: "Ausgaben über 50% BIP. Staatsquote zu hoch."
  },
  bildung: {
    fakten: "PISA Rang 27. Mehr Ausgaben ≠ bessere Ergebnisse.",
    position: "Schulautonomie. Leistung messen. Wettbewerb zwischen Schulen. Wirtschaftsfach einführen.",
    details: "Viele Österreicher kennen Wirtschaftsgrundlagen nicht."
  }
};

function getRelevantKnowledge(message) {
  const msg = message.toLowerCase();
  let context = '';
  
  if (msg.match(/agenda|think.?tank|wer.?seid|über.?euch|mission/)) {
    context += `AGENDA AUSTRIA: ${knowledge.agenda.basis} ${knowledge.agenda.themen} ${knowledge.agenda.position}\n`;
  }
  if (msg.match(/steuer|abgabe|lohn/)) context += `STEUERN: ${knowledge.steuern.fakten} ${knowledge.steuern.position}\n`;
  if (msg.match(/pension|rente|alter/)) context += `PENSIONEN: ${knowledge.pensionen.fakten} ${knowledge.pensionen.position}\n`;
  if (msg.match(/büro|verwaltung|genehmigung/)) context += `BÜROKRATIE: ${knowledge.buerokratie.fakten} ${knowledge.buerokratie.position}\n`;
  if (msg.match(/schuld|budget|ausgabe|defizit/)) context += `SCHULDEN: ${knowledge.schulden.fakten} ${knowledge.schulden.position}\n`;
  if (msg.match(/bildung|schule|pisa|wirtschaft.*fach/)) context += `BILDUNG: ${knowledge.bildung.fakten} ${knowledge.bildung.position}\n`;
  
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

// SELBSTLERNEN: Analysiere schlechte Antworten und generiere Regeln
function getLearnedRules() {
  const badAnswers = db.prepare(`
    SELECT assistant_message, COUNT(*) as count 
    FROM conversations 
    WHERE feedback = -1 
    GROUP BY assistant_message 
    HAVING count >= 2
    ORDER BY count DESC 
    LIMIT 10
  `).all();
  
  let rules = '';
  
  for (const answer of badAnswers) {
    const msg = answer.assistant_message;
    
    // Regel 1: Zu lange Antworten
    if (msg.split(' ').length > 15) {
      rules += `- VERMEIDE: Antworten über 15 Wörter (Negativ-Beispiel mit ${answer.count}x 👎: "${msg.substring(0, 50)}...")\n`;
    }
    
    // Regel 2: Meta-Kommentare
    if (msg.match(/hier sind|als libby|typische antworten/i)) {
      rules += `- VERMEIDE: Meta-Kommentare wie in "${msg.substring(0, 40)}..." (${answer.count}x 👎)\n`;
    }
    
    // Regel 3: Rhetorische Fragen
    if (msg.match(/\? *$/)) {
      const lastSentence = msg.split(/[.!]/).pop();
      if (lastSentence.match(/fair|zu viel|was meinst|oder/i)) {
        rules += `- VERMEIDE: Rhetorische Fragen wie "${lastSentence.trim()}" (${answer.count}x 👎)\n`;
      }
    }
  }
  
  return rules;
}

// SELBSTLERNEN: Hole beste Antworten als Beispiele
function getGoodExamples() {
  const goodAnswers = db.prepare(`
    SELECT user_message, assistant_message, COUNT(*) as count 
    FROM conversations 
    WHERE feedback = 1 
    GROUP BY user_message, assistant_message 
    ORDER BY count DESC 
    LIMIT 5
  `).all();
  
  let examples = '';
  for (const ex of goodAnswers) {
    examples += `User: "${ex.user_message}"\n✅ (${ex.count}x 👍): "${ex.assistant_message}"\n\n`;
  }
  
  return examples;
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId = 'default' } = req.body;
    const history = getConversationHistory(sessionId, 6);
    const relevantKnowledge = getRelevantKnowledge(message);
    
    // SELBSTLERNEN: Dynamische Regeln aus Feedback
    const learnedRules = getLearnedRules();
    const goodExamples = getGoodExamples();
    
    const systemPrompt = `Du bist Libby, 28, Ökonomin bei Agenda Austria Wien.

ABSOLUTES VERBOT:
- NIEMALS Meta-Kommentare wie "Hier sind typische Antworten" oder "Als Libby würde ich..."
- NIEMALS rhetorische Fragen wie "Fair?" "Zu viel?" "Was meinst du?"
- NIEMALS länger als 15 Wörter pro Antwort

${learnedRules ? 'AUS FEEDBACK GELERNT:\n' + learnedRules + '\n' : ''}

IMMER:
- Sei Libby DIREKT, nicht über Libby reden
- Eine prägnante Aussage ODER eine konkrete beantwortbare Frage
- Zahlen verwenden wo möglich
- Selbstbewusst und pointiert

${goodExamples ? 'BEWÄHRTE BEISPIELE (👍):\n' + goodExamples : ''}

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
    console.log(`📊 Feedback: ${feedback > 0 ? '👍' : '👎'} für #${conversationId} - System lernt daraus!`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Fehler' });
  }
});

app.get('/api/stats', (req, res) => {
  const stats = {
    total: db.prepare('SELECT COUNT(*) as count FROM conversations').get().count,
    positive: db.prepare('SELECT COUNT(*) as count FROM conversations WHERE feedback = 1').get().count,
    negative: db.prepare('SELECT COUNT(*) as count FROM conversations WHERE feedback = -1').get().count,
    learnedRules: getLearnedRules().split('\n').filter(r => r.trim()).length,
    goodExamples: db.prepare('SELECT COUNT(DISTINCT assistant_message) as count FROM conversations WHERE feedback = 1').get().count
  };
  res.json(stats);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Libby mit Selbstlernen läuft auf Port ${PORT}`));
