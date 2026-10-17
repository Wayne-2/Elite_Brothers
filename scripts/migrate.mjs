import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';
import { getDatabaseUrl } from '../lib/db.js';

let DATABASE_URL;
try {
  DATABASE_URL = getDatabaseUrl();
} catch {
  console.error('No database connection string found. Run `npx vercel env pull` or set DATABASE_URL.');
  process.exit(1);
}

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql');
const schema = await readFile(schemaPath, 'utf8');

const statements = schema
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

const sql = neon(DATABASE_URL);

for (const statement of statements) {
  await sql.query(statement);
}

console.log(`Applied ${statements.length} statements. Schema is up to date.`);
