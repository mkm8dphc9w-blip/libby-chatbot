import Database from 'better-sqlite3';

const db = new Database('libby.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    user_message TEXT,
    assistant_message TEXT,
    feedback INTEGER DEFAULT 0,
    context TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_type TEXT,
    avg_feedback REAL,
    count INTEGER,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_session ON conversations(session_id);
  CREATE INDEX IF NOT EXISTS idx_feedback ON conversations(feedback);
`);

console.log('✅ Datenbank initialisiert');
db.close();
