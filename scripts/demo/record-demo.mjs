#!/usr/bin/env node
/**
 * Record the README feature GIFs from a running Clew instance.
 *
 *   node scripts/demo/record-demo.mjs            # all segments, then convert
 *   node scripts/demo/record-demo.mjs overview   # one segment
 *
 * Requires Playwright (`npm install` inside scripts/demo) and a demo stack:
 *   backend  : DATA_DIR=/tmp/clew-demo/data uvicorn clew.main:app --port 8010
 *   frontend : VITE_API_TARGET=http://127.0.0.1:8010 npm run dev -- --port 5199
 *   setup    : node scripts/demo/setup-demo.mjs
 *
 * Env: CLEW_WEB (default http://localhost:5199), CLEW_WORK (default scripts/demo/.work)
 */

import { chromium } from 'playwright';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = process.env.CLEW_WEB ?? 'http://localhost:5199';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORK = process.env.CLEW_WORK ?? join(ROOT, 'scripts/demo/.work');
const VIDEO_DIR = join(WORK, 'video');
const TMP = join(WORK, 'tmp');

const VIEWPORT = { width: 1680, height: 1000 };
const only = process.argv[2];

async function loginSession(username = 'admin', password = 'admin123') {
  const response = await fetch(`${WEB}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`login failed: ${response.status}`);
  return response.json();
}

function newContext(browser, session) {
  return browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: VIDEO_DIR, size: VIEWPORT },
  }).then(async (context) => {
    await context.addInitScript(
      ([storedSession]) => {
        localStorage.setItem('clew.locale', 'en');
        if (storedSession) {
          localStorage.setItem('clew.session', JSON.stringify(storedSession));
        }
      },
      [session],
    );
    return context;
  });
}

async function waitForCanvas(page) {
  await page.locator('article[aria-label^="Dataset "]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1300);
}

async function selectRevenueReport(page) {
  await page.getByRole('button', { name: '4 hops', exact: true }).click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Revenue Report/ }).first().click();
  await page.waitForTimeout(1500);
}

const segments = {
  async overview(page) {
    await page.goto(WEB, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.click('#login-username');
    await page.keyboard.type('admin', { delay: 110 });
    await page.click('#login-password');
    await page.keyboard.type('admin123', { delay: 90 });
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /Sign in/ }).click();
    await waitForCanvas(page);
    await selectRevenueReport(page);
    await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
    await page.waitForTimeout(1100);
    await page.getByRole('button', { name: 'Expand all', exact: true }).click();
    await page.waitForTimeout(1100);
    await page.locator('button[aria-label="View field d4.amount"]').click();
    await page.waitForTimeout(1700);
  },

  async source(page) {
    await page.goto(WEB, { waitUntil: 'networkidle' });
    await waitForCanvas(page);
    await selectRevenueReport(page);
    await page.locator('button[aria-label="View field d4.amount"]').click();
    await page.waitForTimeout(1400);
    await page.getByRole('button', { name: 'Source preview', exact: true }).click();
    await page.waitForTimeout(2200);
    await page.getByRole('button', { name: 'Close source preview' }).click();
    await page.waitForTimeout(900);
    await page.locator('button[aria-label="View field d1.amount"]').click();
    await page.waitForTimeout(1400);
    await page.getByRole('button', { name: 'Source preview', exact: true }).click();
    await page.waitForTimeout(2400);
  },

  async ai(page) {
    await page.goto(WEB, { waitUntil: 'networkidle' });
    await waitForCanvas(page);
    await selectRevenueReport(page);
    await page.locator('button[aria-label="View field d4.order_id"]').click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'AI Assistant', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.locator('#ai-chat-input').click();
    await page.keyboard.type(
      'Trace the order_id lineage from Orders Raw to Revenue Report and tell me where it is stored.',
      { delay: 18 },
    );
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: 'Send', exact: true }).waitFor({
      state: 'visible',
      timeout: 120000,
    });
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Close AI assistant' }).click();
    await page.waitForTimeout(2200);
  },

  async versions(page) {
    await page.goto(WEB, { waitUntil: 'networkidle' });
    await waitForCanvas(page);
    await selectRevenueReport(page);
    await page.getByRole('button', { name: 'Versions', exact: true }).click();
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: 'Compute diff', exact: true }).click();
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: 'Roll back here' }).first().click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Close the versions drawer' }).click();
    await page.waitForTimeout(900);
    await page.locator('button[aria-label="View field d2.region"]').click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'View field change history' }).click();
    await page.waitForTimeout(2200);
    await page.getByRole('button', { name: 'Close change history' }).click();
    await page.waitForTimeout(800);
    await page.locator('button[title="User menu"]').click();
    await page.waitForTimeout(500);
    await page.getByRole('menuitem', { name: /Manage users/ }).click();
    await page.waitForTimeout(2200);
  },

  async edit(page) {
    await page.goto(WEB, { waitUntil: 'networkidle' });
    await waitForCanvas(page);
    await page.getByRole('button', { name: /Orders Clean/ }).first().click();
    await page.waitForTimeout(1500);
    await page.locator('button[aria-label="View field d1.amount"]').click();
    await page.waitForTimeout(1200);

    await page.locator('button[title="Edit field"]').click();
    await page.waitForTimeout(900);
    await page.fill('#field-description', 'Amount after discounts and refunds');
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForTimeout(2200);

    const annotation = page.locator('textarea[placeholder^="Add an annotation"]');
    await annotation.scrollIntoViewIfNeeded();
    await annotation.fill('Reconciled with the finance export on 2026-10-24.');
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForTimeout(1800);

    await page.getByRole('button', { name: 'AI suggestions', exact: true }).click();
    await page.waitForTimeout(2600);
    const confirms = page.getByRole('button', { name: 'Confirm', exact: true });
    await confirms.nth(1).scrollIntoViewIfNeeded();
    await confirms.nth(1).click();
    await page.waitForTimeout(2400);
  },

  async import(page) {
    const source = join(TMP, 'returns_raw.csv');
    const manifest = join(TMP, 'returns_manifest.json');
    await writeFile(
      source,
      'return_id,order_id,amount,region\nR-9001,SO-1001,19.8,East\nR-9002,SO-1002,59.0,North\nR-9003,SO-1003,12.5,South\n',
    );

    await page.goto(WEB, { waitUntil: 'networkidle' });
    await waitForCanvas(page);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.waitForTimeout(1200);
    await page
      .locator('input[type=file][aria-label="Drop source files here, or click to browse"]')
      .setInputFiles(source);
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.waitForTimeout(1200);
    await page.getByRole('radio', { name: /json/i }).check();
    await page.waitForTimeout(700);

    const chipText = await page.locator('[role=dialog]').innerText();
    const match = chipText.match(/#(\d+)/);
    const fileId = match ? match[1] : '6';
    await writeFile(
      manifest,
      JSON.stringify({
        datasets: [
          ['return_id', 'STRING', { header: 'return_id' }, 'Return identifier'],
          ['order_id', 'STRING', { header: 'order_id' }, 'Order the return belongs to'],
          ['amount', 'DECIMAL', { header: 'amount' }, 'Refunded amount'],
          ['region', 'STRING', { header: 'region' }, 'Return region'],
        ].map(([field_name, field_type, src_locator, description]) => ({
          dataset_id: 'd5',
          dataset_name: 'Returns',
          field_name,
          field_type,
          src_file: fileId,
          src_type: 'csv',
          src_locator,
          description,
        })),
        lineage: [{
          from_dataset: 'd2',
          from_field: 'order_id',
          to_dataset: 'd5',
          to_field: 'order_id',
          transform: 'returns join order items',
          confidence: 1.0,
          note: 'Returns reference their source order',
        }],
      }, null, 2),
    );
    await page
      .locator('input[type=file][aria-label="Drop here or click to browse"]')
      .setInputFiles(manifest);
    await page.waitForTimeout(1400);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Validate & import', exact: true }).click();
    await page.waitForTimeout(5500);
  },

  async i18n(page) {
    await page.goto(WEB, { waitUntil: 'networkidle' });
    await waitForCanvas(page);
    await selectRevenueReport(page);
    await page.getByRole('button', { name: '中', exact: true }).click();
    await page.waitForTimeout(2200);
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await page.waitForTimeout(1500);
  },
};

async function record(name, fn, browser, session) {
  const context = await newContext(browser, session);
  const page = await context.newPage();
  try {
    await fn(page);
  } finally {
    const video = page.video();
    await context.close();
    if (video) {
      const target = join(VIDEO_DIR, `${name}.webm`);
      const original = await video.path();
      await video.saveAs(target);
      if (original && original !== target) await unlink(original).catch(() => {});
      console.log(`recorded ${target}`);
    }
  }
}

async function main() {
  await mkdir(VIDEO_DIR, { recursive: true });
  await mkdir(TMP, { recursive: true });
  const browser = await chromium.launch();
  const session = await loginSession();
  try {
    for (const [name, fn] of Object.entries(segments)) {
      if (only && only !== name) continue;
      const contextSession = name === 'overview' ? null : session;
      await record(name, fn, browser, contextSession);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
