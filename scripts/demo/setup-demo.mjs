#!/usr/bin/env node
/**
 * Pre-recording setup for the README GIFs.
 *
 * Adds the M3 state the recordings need (annotations, change-log entries and
 * two version tags) through the public API, so the demo only uses production
 * code paths. Safe to re-run: the tag check makes it a no-op afterwards.
 *
 *   node scripts/demo/setup-demo.mjs
 *   CLEW_API=http://127.0.0.1:8010 node scripts/demo/setup-demo.mjs
 */

const BASE = process.env.CLEW_API ?? 'http://127.0.0.1:8010';

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function main() {
  const login = await request('/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' },
  });
  const token = login.access_token;

  const tags = await request('/version-tags', { token });
  if (tags.some((tag) => tag.name === 'v1.0-baseline')) {
    console.log('Demo state already present; nothing to do.');
    return;
  }

  await request('/annotations', {
    token,
    method: 'POST',
    body: {
      target_kind: 'field',
      target_id: 'd1.amount',
      body: 'Verified against the billing export: net of refunds and discounts.',
    },
  });
  await request('/annotations', {
    token,
    method: 'POST',
    body: {
      target_kind: 'edge',
      target_id: 'd0.order_id-->d1.order_id',
      body: 'Trim + cast only; no business rule applied at this hop.',
    },
  });

  await request('/version-tags', {
    token,
    method: 'POST',
    body: { name: 'v1.0-baseline', note: 'Initial import, reviewed by data team' },
  });

  await request('/fields/d2/region', {
    token,
    method: 'PATCH',
    body: { description: 'Region normalized to ISO 3166-2 codes' },
  });
  await request('/fields/d3/amount', {
    token,
    method: 'PATCH',
    body: { description: 'Daily amount rolled up from order items' },
  });

  await request('/version-tags', {
    token,
    method: 'POST',
    body: { name: 'v1.1-cleanup', note: 'Post-import metadata cleanup' },
  });

  console.log('Demo state ready: 2 annotations, 2 edits, tags v1.0-baseline -> v1.1-cleanup.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
