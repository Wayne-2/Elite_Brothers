import { neon } from '@neondatabase/serverless';

let instance = null;

export function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const prefixed = Object.keys(process.env).find((key) => key.endsWith('_DATABASE_URL'));
  if (prefixed) return process.env[prefixed];
  const postgres = Object.keys(process.env).find((key) => key === 'POSTGRES_URL' || key.endsWith('_POSTGRES_URL'));
  if (postgres) return process.env[postgres];
  throw new Error('No database connection string found. Set DATABASE_URL (or a *_DATABASE_URL variable).');
}

export function getSql() {
  if (!instance) {
    instance = neon(getDatabaseUrl());
  }
  return instance;
}
