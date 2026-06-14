import { chromium } from 'playwright';
import { execSync } from 'child_process';

const BASE = 'http://localhost:3000';

function pass(msg)  { console.log(`✅  ${msg}`); }
function fail(msg)  { console.log(`❌  ${msg}`); process.exitCode = 1; }
function probe(msg) { console.log(`🔍  ${msg}`); }
function warn(msg)  { console.log(`⚠️   ${msg}`); }
function section(msg) { console.log(`\n═══ ${msg} ═══`); }

// ── Shared: walk landing → account → confidence ───────────────────────────────
async function getToSurvey(page, networkLog, name, email) {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  await page.locator('button:has-text("Get started"), a:has-text("Get started")').first().click();

  await page.waitForSelector('input[id="email"]', { timeout: 8000 });
  await page.fill('input[id="name"]', name);
  await page.fill('input[id="email"]', email);
  await page.locator('button[type="submit"]').click();

  // Wait for "Setting up…" to clear
  await page.waitForFunction(
    () => !(document.querySelector('button[type="submit"]')?.textContent ?? '').includes('Setting up'),
    { timeout: 12000 }
  );
  pass('Account created — POST /api/users resolved');

  // Confidence explainer — click first visible primary button
  const continueBtn = page.locator('button').filter({ hasText: /continue|start|let.s go/i }).first();
  await continueBtn.waitFor({ timeout: 6000 });
  await continueBtn.click();

  // Wait for survey radiogroup
  await page.waitForSelector('[role="radiogroup"]', { timeout: 8000 });
  pass('Survey loaded');
}

// ── Shared: answer one question ───────────────────────────────────────────────
async function answerAndNext(page, radioIndex) {
  await page.waitForSelector('[role="radiogroup"]', { timeout: 5000 });
  await page.locator('[role="radio"]').nth(radioIndex).click();
  const nextBtn = page.locator('button:has-text("Next")');
  if (await nextBtn.isVisible()) {
    await nextBtn.click();
    await page.waitForTimeout(320);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 1 — Normal path: Q9 = "Not at all" (value 0)
// ─────────────────────────────────────────────────────────────────────────────
async function flow1(browser) {
  section('FLOW 1: Normal path (Q9 = "Not at all")');
  const ctx = await browser.newContext();
  const networkLog = [];
  ctx.on('response', res => {
    if (res.url().includes('localhost:3001'))
      networkLog.push({ url: res.url(), status: res.status(), method: res.request().method() });
  });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));

  const email = `flow1-${Date.now()}@mosaic-verify.dev`;
  await getToSurvey(page, networkLog, 'Flow One', email);

  // Answer all 16 questions with radio[0] ("Not at all")
  for (let i = 0; i < 15; i++) await answerAndNext(page, 0);

  // Last question
  await page.waitForSelector('[role="radiogroup"]', { timeout: 5000 });
  await page.locator('[role="radio"]').nth(0).click();
  await page.locator('button:has-text("See your results")').click();
  pass('Clicked "See your results"');

  // Wait for submitting spinner → gone, then radiogroup gone = dashboard
  await page.waitForFunction(
    () => !(document.querySelector('button')?.textContent ?? '').includes('Submitting'),
    { timeout: 15000 }
  );
  await page.waitForFunction(
    () => !document.querySelector('[role="radiogroup"]'),
    { timeout: 10000 }
  );
  pass('Dashboard reached');

  // ── Network assertions ──
  const postUsers  = networkLog.find(r => r.url.includes('/api/users')  && r.method === 'POST');
  const postSurvey = networkLog.find(r => r.url.includes('/api/survey') && r.method === 'POST');
  const patch      = networkLog.find(r => r.url.match(/\/api\/users\/[^/]+$/) && r.method === 'PATCH');

  postUsers  ? pass(`POST /api/users → ${postUsers.status}`)   : fail('POST /api/users missing');
  postSurvey ? pass(`POST /api/survey → ${postSurvey.status}`) : fail('POST /api/survey missing');
  patch      ? pass(`PATCH /api/users/:id → ${patch.status}`)  : fail('PATCH /api/users/:id missing');

  // ── localStorage ──
  const storedId = await page.evaluate(() => localStorage.getItem('mosaic_user_id'));
  if (storedId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storedId)) {
    pass(`localStorage mosaic_user_id is a valid UUID: ${storedId}`);
  } else {
    fail(`localStorage mosaic_user_id missing or not a UUID: ${storedId}`);
  }

  // ── Order check ──
  const order = networkLog.filter(r =>
    (r.url.includes('/api/users') && r.method === 'POST') ||
    (r.url.includes('/api/survey') && r.method === 'POST') ||
    (r.url.match(/\/api\/users\/[^/]+$/) && r.method === 'PATCH')
  ).map(r => `${r.method} ${r.url.replace('http://localhost:3001','')}`);
  probe(`Network call order: ${order.join(' → ')}`);

  if (jsErrors.length) warn(`JS errors: ${jsErrors.join(' | ')}`);
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 2 — Q9 crisis interstitial (value 1 = "Several days")
// ─────────────────────────────────────────────────────────────────────────────
async function flow2(browser) {
  section('FLOW 2: Q9 crisis interstitial ("Several days")');
  const ctx = await browser.newContext();
  const networkLog = [];
  ctx.on('response', res => {
    if (res.url().includes('localhost:3001'))
      networkLog.push({ url: res.url(), status: res.status(), method: res.request().method() });
  });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));

  const email = `flow2-${Date.now()}@mosaic-verify.dev`;
  await getToSurvey(page, networkLog, 'Flow Two', email);

  // Q1–Q8 (indices 0–7): "Not at all"
  for (let i = 0; i < 8; i++) await answerAndNext(page, 0);
  pass('Q1–Q8 answered');

  // Q9 (index 8): "Several days" = radio[1]
  await page.waitForSelector('[role="radiogroup"]', { timeout: 5000 });
  await page.locator('[role="radio"]').nth(1).click();
  await page.locator('button:has-text("Next")').click();
  await page.waitForTimeout(500);
  pass('Q9 answered with "Several days"');

  // Crisis interstitial must appear
  const crisisHeading = page.locator('text=Thanks for being honest');
  try {
    await crisisHeading.waitFor({ timeout: 5000 });
    pass('Crisis interstitial appeared (contains "Thanks for being honest")');
  } catch {
    fail('Crisis interstitial did NOT appear after Q9 > 0');
    await ctx.close();
    return;
  }

  // 988 resource link must be visible
  const link988 = page.locator('a[href="tel:988"]');
  if (await link988.isVisible()) pass('988 crisis resource link is visible');
  else warn('988 resource link not found');

  // Click "Continue my check-in"
  await page.locator('button:has-text("Continue my check-in")').click();
  await page.waitForTimeout(500);
  pass('"Continue my check-in" clicked');

  // Should now be on Q10 — radiogroup back, counter shows 10 / 16
  await page.waitForSelector('[role="radiogroup"]', { timeout: 5000 });
  const counter = await page.locator('span.tabular-nums, span[class*="tabular"]').textContent().catch(() => null)
    || await page.locator('text=/\\d+ \\/ 16/').textContent().catch(() => null);
  pass(`Resumed at question — counter reads: "${counter}"`);
  if (counter && counter.trim() === '10 / 16') pass('Counter correctly shows 10 / 16');
  else if (counter) warn(`Counter shows "${counter.trim()}" — expected "10 / 16"`);

  // Q10–Q16 (indices 9–15): answer remaining 6, then last
  for (let i = 9; i < 15; i++) await answerAndNext(page, 0);

  // Last question (index 15)
  await page.waitForSelector('[role="radiogroup"]', { timeout: 5000 });
  await page.locator('[role="radio"]').nth(0).click();
  await page.locator('button:has-text("See your results")').click();
  pass('Clicked "See your results" after crisis continue');

  await page.waitForFunction(
    () => !(document.querySelector('button')?.textContent ?? '').includes('Submitting'),
    { timeout: 15000 }
  );
  await page.waitForFunction(
    () => !document.querySelector('[role="radiogroup"]'),
    { timeout: 10000 }
  );
  pass('Dashboard reached after crisis flow');

  const postSurvey = networkLog.find(r => r.url.includes('/api/survey') && r.method === 'POST');
  postSurvey ? pass(`POST /api/survey → ${postSurvey.status} (submitted after crisis continue)`)
             : fail('POST /api/survey missing after crisis flow');

  if (jsErrors.length) warn(`JS errors: ${jsErrors.join(' | ')}`);
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 3 — Error path (backend stopped before survey submit)
// ─────────────────────────────────────────────────────────────────────────────
async function flow3(browser) {
  section('FLOW 3: Error path — backend stopped before survey submit');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));

  const email = `flow3-${Date.now()}@mosaic-verify.dev`;
  await getToSurvey(page, ctx, 'Flow Three', email);

  // Answer Q1–Q15
  for (let i = 0; i < 15; i++) await answerAndNext(page, 0);

  // Answer last question but don't submit yet
  await page.waitForSelector('[role="radiogroup"]', { timeout: 5000 });
  await page.locator('[role="radio"]').nth(0).click();
  pass('On last question, answer selected — stopping backend now');

  // Kill the backend process
  try {
    execSync('pkill -f "ts-node-dev.*src/index.ts"', { stdio: 'ignore' });
  } catch {}
  await page.waitForTimeout(500);
  probe('Backend process killed');

  // Submit — should fail
  await page.locator('button:has-text("See your results")').click();

  // "Submitting…" should appear, then resolve to an error state
  const submittingBtn = page.locator('button:has-text("Submitting")');
  try {
    await submittingBtn.waitFor({ timeout: 3000 });
    pass('"Submitting…" spinner appeared');
  } catch {
    probe('"Submitting…" may have been too brief to catch');
  }

  // Wait for spinner to clear (error path must unblock the button)
  await page.waitForFunction(
    () => !(document.querySelector('button')?.textContent ?? '').includes('Submitting'),
    { timeout: 12000 }
  );
  pass('Button unblocked after network failure (not stuck on "Submitting…")');

  // Check for inline error message
  const errorEl = page.locator('[role="alert"]').filter({ hasText: /wrong|try again|error/i });
  if (await errorEl.isVisible()) {
    const errText = await errorEl.textContent();
    pass(`Inline error message visible: "${errText.trim()}"`);
  } else {
    fail('No inline [role="alert"] error message appeared after backend failure');
  }

  // Submit button should be re-enabled (not stuck disabled)
  const submitBtn = page.locator('button:has-text("See your results")');
  const isDisabled = await submitBtn.getAttribute('disabled');
  isDisabled === null ? pass('Submit button re-enabled after error') : fail('Submit button still disabled after error');

  // Survey radiogroup should still be there (no navigation away on error)
  const radiogroup = page.locator('[role="radiogroup"]');
  if (await radiogroup.isVisible()) pass('User stays on survey (no crash navigation)');
  else warn('Radiogroup gone — user may have navigated away unexpectedly');

  if (jsErrors.length) warn(`JS errors: ${jsErrors.join(' | ')}`);
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await flow1(browser);
    await flow2(browser);
    await flow3(browser);
  } catch (err) {
    console.error('Unhandled error in test runner:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }

  console.log('\n' + (process.exitCode ? '❌  RESULT: FAIL' : '✅  RESULT: PASS'));
})();
