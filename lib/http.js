export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function readJson(req) {
  const body = req.body;
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString('utf8'));
    } catch {
      return {};
    }
  }
  return body;
}

export function serverError(res, err) {
  console.error(err);
  return sendJson(res, 500, { error: 'Something went wrong on our end' });
}

export function clientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  return req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

const buckets = new Map();

export function rateLimit(req, res, key, limit = 10, windowMs = 60_000) {
  const now = Date.now();
  if (buckets.size > 5_000) {
    for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
  }
  const id = `${clientIp(req)}:${key}`;
  let bucket = buckets.get(id);
  if (!bucket || now > bucket.reset) {
    bucket = { count: 0, reset: now + windowMs };
    buckets.set(id, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    sendJson(res, 429, { error: 'Too many attempts. Please try again in a minute.' });
    return false;
  }
  return true;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
