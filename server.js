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
  de: {
    agenda: {
      mission: "Freiheit und Eigenverantwortung = Bausteine für florierende Gesellschaft. Lösungsorientiert, wissenschaftlich, unbestechlich.",
      finanzierung: "100% privat finanziert. Kein Geld von Staat, Parteien, Kammern.",
    },
    steuern: {
      fakten: "Abgabenquote 43% (DE 40%, OECD 34%). Obere 10% zahlen Hälfte.",
      position: "Senkung auf 40% möglich."
    },
    pensionen: {
      fakten: "Antritt faktisch 60J (EU: 64J). 8 Mrd/Jahr Zuschuss.",
      position: "Antrittsalter an Lebenserwartung koppeln."
    },
    buerokratie: {
      fakten: "Österreich = Bürokratie-Champion Europas.",
      position: "One-Stop-Shops, Digitalisierung."
    },
    schulden: {
      fakten: "78% BIP = 32.000€/Kopf. 7 Mrd Zinsen/Jahr.",
      position: "Ausgabenbremse wie Schweiz."
    }
  },
  en: {
    agenda: {
      mission: "Freedom and personal responsibility = building blocks for thriving society. Solution-oriented, scientific, incorruptible.",
      finanzierung: "100% privately funded. No money from state, parties, chambers.",
    },
    steuern: {
      fakten: "Tax rate 43% (Germany 40%, OECD 34%). Top 10% pay half.",
      position: "Reduction to 40% possible."
    },
    pensionen: {
      fakten: "Retirement effectively at 60 (EU: 64). €8bn/year subsidy.",
      position: "Link retirement age to life expectancy."
    },
    buerokratie: {
      fakten: "Austria = Europe's bureaucracy champion.",
      position: "One-stop-shops, digitalization."
    },
    schulden: {
      fakten: "78% GDP = €32,000 per capita. €7bn interest/year.",
      position: "Spending brake like Switzerland."
    }
  }
};

function detectLanguage(message) {
  const text = message.toLowerCase();
  
  // Englische Indikatoren
  const englishIndicators = [
    /\b(what|how|why|when|where|who|which)\b/,
    /\b(the|is|are|was|were|been|being)\b/,
    /\b(you|your|yours|yourself)\b/,
    /\b(can|could|would|should|will|shall)\b/,
    /\b(about|because|before|after|through)\b/,
    /\b(tax|pension|debt|bureaucracy)\b/,
    /\b(show|tell|explain|give)\s+me\b/
  ];
  
  // Deutsche Indikatoren
  const germanIndicators = [
    /\b(was|wie|warum|wann|wo|wer|welch)\b/,
    /\b(der|die|das|den|dem|des)\b/,
    /\b(ich|du|er|sie|es|wir|ihr)\b/,
    /\b(ist|sind|war|waren|sein|werden)\b/,
    /\b(und|oder|aber|denn|weil|dass)\b/,
    /\b(steuer|pension|schuld|bürokratie)\b/,
    /\b(zeig|sag|erkläre|gib)\s+(mir|uns)\b/
  ];
  
  let englishScore = 0;
  let germanScore = 0;
  
  englishIndicators.forEach(pattern => {
    if (pattern.test(text)) englishScore++;
  });
  
  germanIndicators.forEach(pattern => {
    if (pattern.test(text)) germanScore++;
  });
  
  // Bei Gleichstand: Prüfe ob typisch englische Buchstabenkombinationen
  if (englishScore === germanScore) {
    if (text.match(/\b\w+tion\b|\b\w+ing\b/)) englishScore++;
    if (text.match(/\b\w+ung\b|\b\w+keit\b/)) germanScore++;
  }
  
  return englishScore > germanScore ? 'en' : 'de';
}

function getRelevantKnowledge(message, lang) {
  const msg = message.toLowerCase();
  const kb = knowledge[lang];
  let context = '';
  
  if (msg.match(/agenda|think.?tank|wer|who|mission|about.*you/i)) {
    context += lang === 'de' 
      ? `AGENDA: ${kb.agenda.mission} ${kb.agenda.finanzierung}\n`
      : `AGENDA: ${kb.agenda.mission} ${kb.agenda.finanzierung}\n`;
  }
  if (msg.match(/steuer|tax|abgabe/i)) {
    context += lang === 'de'
      ? `STEUERN: ${kb.steuern.fakten} ${kb.steuern.position}\n`
      : `TAXES: ${kb.steuern.fakten} ${kb.steuern.position}\n`;
  }
  if (msg.match(/pension|rente|retirement/i)) {
    context += lang === 'de'
      ? `PENSIONEN: ${kb.pensionen.fakten} ${kb.pensionen.position}\n`
      : `PENSIONS: ${kb.pensionen.fakten} ${kb.pensionen.position}\n`;
  }
  if (msg.match(/büro|bureaucracy|verwaltung|administration/i)) {
    context += lang === 'de'
      ? `BÜROKRATIE: ${kb.buerokratie.fakten} ${kb.buerokratie.position}\n`
      : `BUREAUCRACY: ${kb.buerokratie.fakten} ${kb.buerokratie.position}\n`;
  }
  if (msg.match(/schuld|debt|budget|deficit/i)) {
    context += lang === 'de'
      ? `SCHULDEN: ${kb.schulden.fakten} ${kb.schulden.position}\n`
      : `DEBT: ${kb.schulden.fakten} ${kb.schulden.position}\n`;
  }
  
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

function getLearnedRules(lang) {
  const badAnswers = db.prepare(`
    SELECT assistant_message, COUNT(*) as count 
    FROM conversations 
    WHERE feedback = -1 AND language = ?
    GROUP BY assistant_message 
    HAVING count >= 2
    ORDER BY count DESC 
    LIMIT 10
  `).all(lang);
  
  let rules = '';
  
  for (const answer of badAnswers) {
    const msg = answer.assistant_message;
    
    if (msg.split(' ').length > 15) {
      rules += lang === 'de'
        ? `- VERMEIDE: Antworten über 15 Wörter (${answer.count}x 👎)\n`
        : `- AVOID: Answers over 15 words (${answer.count}x 👎)\n`;
    }
    
    if (msg.match(/hier sind|als libby|here are|as libby/i)) {
      rules += lang === 'de'
        ? `- VERMEIDE: Meta-Kommentare (${answer.count}x 👎)\n`
        : `- AVOID: Meta-comments (${answer.count}x 👎)\n`;
    }
    
    if (lang === 'de' && msg.match(/Sie|Ihnen|Ihr /)) {
      rules += `- VERMEIDE: "Sie"-Anrede (${answer.count}x 👎) - immer "du"!\n`;
    }
  }
  
  return rules;
}

function getGoodExamples(lang) {
  const goodAnswers = db.prepare(`
    SELECT user_message, assistant_message, COUNT(*) as count 
    FROM conversations 
    WHERE feedback = 1 AND language = ?
    GROUP BY user_message, assistant_message 
    ORDER BY count DESC 
    LIMIT 5
  `).all(lang);
  
  let examples = '';
  for (const ex of goodAnswers) {
    examples += `User: "${ex.user_message}"\n✅ (${ex.count}x 👍): "${ex.assistant_message}"\n\n`;
  }
  
  return examples;
}

const prompts = {
  de: (needsSource, learnedRules, goodExamples, relevantKnowledge) => `Du bist Libby, 28, Ökonomin bei Agenda Austria Wien.

KRITISCH - SPRACHE & ANREDE:
- IMMER auf Deutsch antworten
- IMMER "du", "dich", "dir" (klein!)
- NIEMALS "Sie", "Ihnen", "Ihr"

${needsSource ? `KRITISCH - QUELLENANGABE:
- NUTZE web_search Tool um Belege zu finden
- Gib NIEMALS erfundene Quellen an
- Format: "Laut [Quelle] vom [Datum]: [Aussage]"
` : ''}

ABSOLUTES VERBOT:
- Meta-Kommentare
- Rhetorische Fragen wie "Fair?" "Zu viel?"
- Länger als 15 Wörter (außer bei Quellenangabe!)

${learnedRules ? 'AUS FEEDBACK GELERNT:\n' + learnedRules : ''}

IMMER:
- Direkt, selbstbewusst, pointiert
- Zahlen verwenden wo möglich

${goodExamples ? 'BEWÄHRTE BEISPIELE:\n' + goodExamples : ''}

${relevantKnowledge ? 'WISSEN:\n' + relevantKnowledge : ''}`,

  en: (needsSource, learnedRules, goodExamples, relevantKnowledge) => `You are Libby, 28, economist at Agenda Austria Vienna.

CRITICAL - LANGUAGE & TONE:
- ALWAYS respond in English
- Use "you" (informal)
- Direct, confident, max 15 words

${needsSource ? `CRITICAL - SOURCES:
- USE web_search tool to find evidence
- NEVER provide made-up sources
- Format: "According to [Source] from [Date]: [Statement]"
` : ''}

ABSOLUTE NO-GO:
- Meta-comments like "Here are typical answers"
- Rhetorical questions like "Fair?" "Too much?"
- Longer than 15 words (except when citing sources!)

${learnedRules ? 'LEARNED FROM FEEDBACK:\n' + learnedRules : ''}

ALWAYS:
- One statement OR one concrete question
- Use numbers where possible

${goodExamples ? 'PROVEN EXAMPLES:\n' + goodExamples : ''}

${relevantKnowledge ? 'KNOWLEDGE:\n' + relevantKnowledge : ''}`
};

app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId = 'default' } = req.body;
    
    // Sprache erkennen
    const detectedLang = detectLanguage(message);
    
    const history = getConversationHistory(sessionId, 6);
    const relevantKnowledge = getRelevantKnowledge(message, detectedLang);
    const learnedRules = getLearnedRules(detectedLang);
    const goodExamples = getGoodExamples(detectedLang);
    
    const needsSource = message.match(/quelle|beleg|wo.*sag|recherchier|source|evidence|where.*say|research/i);
    
    const systemPrompt = prompts[detectedLang](needsSource, learnedRules, goodExamples, relevantKnowledge);

    history.push({ role: 'user', content: message });
    
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: needsSource ? 200 : 70,
      system: systemPrompt,
      messages: history,
      tools: needsSource ? [{
        type: "web_search_20250305",
        name: "web_search"
      }] : undefined
    });
    
    let assistantMessage = '';
    let usedSearch = false;
    
    for (const block of response.content) {
      if (block.type === 'text') {
        assistantMessage += block.text;
      } else if (block.type === 'tool_use') {
        usedSearch = true;
      }
    }
    
    const insert = db.prepare(`INSERT INTO conversations (session_id, user_message, assistant_message, context, used_search, language) VALUES (?, ?, ?, ?, ?, ?)`);
    const result = insert.run(sessionId, message, assistantMessage, relevantKnowledge || '', usedSearch ? 1 : 0, detectedLang);
    
    res.json({ 
      message: assistantMessage, 
      conversationId: result.lastInsertRowid,
      detectedLanguage: detectedLang 
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Fehler / Error' });
  }
});

app.post('/api/feedback', (req, res) => {
  try {
    const { conversationId, feedback } = req.body;
    db.prepare('UPDATE conversations SET feedback = ? WHERE id = ?').run(feedback, conversationId);
    console.log(`📊 Feedback: ${feedback > 0 ? '👍' : '👎'} #${conversationId}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Fehler / Error' });
  }
});

app.get('/api/stats', (req, res) => {
  const stats = {
    total: db.prepare('SELECT COUNT(*) as count FROM conversations').get().count,
    positive: db.prepare('SELECT COUNT(*) as count FROM conversations WHERE feedback = 1').get().count,
    negative: db.prepare('SELECT COUNT(*) as count FROM conversations WHERE feedback = -1').get().count,
    searches: db.prepare('SELECT COUNT(*) as count FROM conversations WHERE used_search = 1').get().count,
    german: db.prepare('SELECT COUNT(*) as count FROM conversations WHERE language = "de"').get().count,
    english: db.prepare('SELECT COUNT(*) as count FROM conversations WHERE language = "en"').get().count
  };
  res.json(stats);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Libby mit Auto-Language Detection läuft auf Port ${PORT}`));
