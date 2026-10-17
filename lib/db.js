import { neon } from '@neondatabase/serverless';

let instance = null;

export function getSql() {
  if (!instance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL environment variable is not set');
    instance = neon(url);
  }
  return instance;
}
