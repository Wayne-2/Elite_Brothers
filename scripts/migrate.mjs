import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run `npx vercel env pull` or export it first.');
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
