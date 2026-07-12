#!/usr/bin/env node
/**
 * Local smoke tests for dashboard API (read-only + auth flow).
 * Run: node scripts/smoke-test.js
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

async function main() {
  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) throw new Error('Health check failed');
  console.log('✓ health');

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
  });
  if (!loginRes.ok) throw new Error('Login failed');
  const cookie = loginRes.headers.get('set-cookie');
  const headers = cookie ? { Cookie: cookie.split(';')[0] } : {};

  for (const path of ['/api/domains', '/api/projects', '/api/projects/ports', '/api/terminal/presets', '/api/services']) {
    const res = await fetch(`${BASE}${path}`, { headers });
    if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
    console.log(`✓ ${path}`);
  }

  console.log('All smoke tests passed.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
