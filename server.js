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
    mission: "Freiheit und Eigenverantwortung = Bausteine für florierende Gesellschaft. Lösungsorientiert, wissenschaftlich, unbestechlich.",
    finanzierung: "100% privat finanziert. Kein Geld von Staat, Parteien, Kammern. Kein Förderer >10% Anteil. Keine Studienaufträge von außen.",
    grundsatz: "Ergebnisoffen, marktwirtschaftlich. Breite Öffentlichkeit. Wissenschaftlicher Beirat sichert Qualität."
  },
  steuern: {
    fakten: "Abgabenquote 43% (DE 40%, OECD 34%). Lohnsteuer +20% seit 2022. Obere 10% zahlen Hälfte.",
    position: "Senkung auf 40% möglich. Deutschland schafft mit 40% Überschüsse, Österreich mit 43% Defizite."
  },
  pensionen: {
    fakten: "Antritt faktisch 60J (EU: 64J). 21 Jahre Ruhestand. 8 Mrd/Jahr Zuschuss.",
    position: "Antrittsalter an Lebenserwartung koppeln. +2 Monate/Jahr bis 67J."
  },
  buerokratie: {
    fakten: "Österreich = Bürokratie-Champion Europas. Milliarden für Formulare, lange Genehmigungen.",
    position: "One-Stop-Shops, Digitalisierung, Verwaltung verschlanken."
  },
  schulden: {
    fakten: "78% BIP = 32.000€/Kopf. 7 Mrd Zinsen/Jahr.",
    position: "Ausgabenbremse wie Schweiz. Problem = Ausgaben, nicht Einnahmen. Staatsquote >50%."
  },
  bildung: {
    fakten: "PISA Rang 27. Viele Österreicher kennen Wirtschaftsgrundlagen nicht.",
    position: "Schulautonomie, Wettbewerb, Wirtschaftsfach einführen."
  },
  wohnen: {
    fakten: "Mietpreisbremse kommt. 100+ Jahre Erfahrung mit Mietpreiseingriffen in Österreich.",
    position: "Mietpreisbremsen ruinieren Wohnungsmärkte systematisch."
  },
  privatisierung: {
    fakten: "Öffentliche Hand besitzt gewaltige Teile österreichischer Wirtschaft.",
    position: "Privatisierung = Gebot der Stunde. Am Ende gewinnen alle."
  },
  standort: {
    fakten: "Österreich Wachstumskeller trotz höchste Staatsausgaben der Geschichte.",
    position: "Schöpferische Zerstörung nötig. Veränderung statt Stillstand."
  }
};

function getRelevantKnowledge(message) {
  const msg = message.toLowerCase();
  let context = '';
  
  if (msg.match(/agenda|think.?tank|wer.?seid|mission|grundsatz|finanz/i)) {
    context += `AGENDA: ${knowledge.agenda.mission} ${knowledge.agenda.finanzierung}\n`;
  }
  if (msg.match(/steuer|abgabe|lohn/i)) context += `STEUERN: ${knowledge.steuern.fakten} ${knowledge.steuern.position}\n`;
  if (msg.match(/pension|rente|alter/i)) context += `PENSIONEN: ${knowledge.pensionen.fakten} ${knowledge.pensionen.position}\n`;
  if (msg.match(/büro|verwaltung|genehmigung|formular/i)) context += `BÜROKRATIE: ${knowledge.buerokratie.fakten} ${knowledge.buerokratie.position}\n`;
  if (msg.match(/schuld|budget|ausgabe|defizit/i)) context += `SCHULDEN: ${knowledge.schulden.fakten} ${knowledge.schulden.position}\n`;
  if (msg.match(/bildung|schule|pisa|wirtschaft.*unterricht/i)) context += `BILDUNG: ${knowledge.bildung.fakten} ${knowledge.bildung.position}\n`;
  if (msg.match(/wohn|miet|immobilie/i)) context += `WOHNEN: ${knowledge.wohnen.fakten} ${knowledge.wohnen.position}\n`;
  if (msg.match(/privatisier|verstaatlich|öffentlich.*hand/i)) context += `PRIVATISIERUNG: ${knowledge.privatisierung.fakten} ${knowledge.privatisierung.position}\n`;
  if (msg.match(/standort|wachstum|konjunktur|wettbewerb/i)) context += `STANDORT: ${knowledge.standort.fakten} ${knowledge.standort.position}\n`;
  
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
    
    if (msg.split(' ').length > 15) {
      rules += `- VERMEIDE: Antworten über 15 Wörter (${answer.count}x 👎)\n`;
    }
    
    if (msg.match(/hier sind|als libby|typische antworten/i)) {
      rules += `- VERMEIDE: Meta-Kommentare (${answer.count}x 👎)\n`;
    }
    
    if (msg.match(/Sie|Ihnen|Ihr /)) {
      rules += `- VERMEIDE: "Sie"-Anrede (${answer.count}x 👎) - immer "du"!\n`;
    }
  }
  
  return rules;
}

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
    
    const learnedRules = getLearnedRules();
    const goodExamples = getGoodExamples();
    
    const systemPrompt = `Du bist Libby, 28, Ökonomin bei Agenda Austria Wien.

KRITISCH - ANREDE:
- IMMER "du", "dich", "dir", "deine" (klein geschrieben!)
- NIEMALS "Sie", "Ihnen", "Ihr", "Ihre"
- Konsistent bleiben - kein Wechsel

ABSOLUTES VERBOT:
- NIEMALS Meta-Kommentare wie "Hier sind typische Antworten"
- NIEMALS rhetorische Fragen wie "Fair?" "Zu viel?"
- NIEMALS länger als 15 Wörter

${learnedRules ? 'AUS FEEDBACK GELERNT:\n' + learnedRules : ''}

IMMER:
- Direkt, selbstbewusst, pointiert
- Zahlen verwenden wo möglich
- Eine Aussage ODER konkrete Frage

${goodExamples ? 'BEWÄHRTE BEISPIELE:\n' + goodExamples : ''}

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
    console.log(`📊 Feedback: ${feedback > 0 ? '👍' : '👎'} #${conversationId} - System lernt!`);
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
app.listen(PORT, () => console.log(`✅ Libby mit Selbstlernen läuft auf Port ${PORT}`));
