import Database from 'better-sqlite3';

const db = new Database('libby.db');

try {
  db.exec('ALTER TABLE conversations ADD COLUMN used_search INTEGER DEFAULT 0');
  console.log('✅ Spalte used_search hinzugefügt');
} catch (e) {
  console.log('✓ used_search existiert bereits');
}

try {
  db.exec('ALTER TABLE conversations ADD COLUMN language TEXT DEFAULT "de"');
  console.log('✅ Spalte language hinzugefügt');
} catch (e) {
  console.log('✓ language existiert bereits');
}

db.close();
