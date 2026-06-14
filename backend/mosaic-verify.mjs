import { chromium } from 'playwright';
import { execSync } from 'child_process';

const BASE = 'http://localhost:3000';

function pass(msg)    { console.log(`✅  ${msg}`); }
function fail(msg)    { console.log(`❌  ${msg}`); process.exitCode = 1; }
function probe(msg)   { console.log(`🔍  ${msg}`); }
function warn(msg)    { console.log(`⚠️   ${msg}`); }
function section(msg) { console.log(`\n═══ ${msg} ═══`); }

// Correctly pass options as 3rd arg (not 2nd — that's the page fn arg)
async function waitFor(page, fn, timeout = 15000) {
  return page.waitForFunction(fn, undefined, { timeout });
}

// ── Walk landing → account → confidence → first radiogroup ───────────────────
async function getToSurvey(page, name, email) {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  await page.locator('button:has-text("Get started"), a:has-text("Get started")').first().waitFor({ timeout: 6000 });
  await page.locator('button:has-text("Get started"), a:has-text("Get started")').first().click();

  await page.waitForSelector('input[id="email"]', { timeout: 8000 });
  await page.fill('input[id="name"]', name);
  await page.fill('input[id="email"]', email);
  await page.locator('button[type="submit"]').click();

  await waitFor(page,
    () => !(document.querySelector('button[type="submit"]')?.textContent ?? '').includes('Setting up'),
    12000
  );
  pass(`Account created (POST /api/users resolved)`);

  const continueBtn = page.locator('button').filter({ hasText: /continue|start|let.s go/i }).first();
  await continueBtn.waitFor({ timeout: 6000 });
  await continueBtn.click();

  await page.waitForSelector('[role="radiogroup"]', { timeout: 8000 });
  pass('Survey loaded');
}

// ── Answer one question and click Next (if visible) ──────────────────────────
async function answerAndNext(page, radioIndex) {
  await page.waitForSelector('[role="radiogroup"]', { timeout: 5000 });
  await page.locator('[role="radio"]').nth(radioIndex).click();
  const nextBtn = page.locator('button:has-text("Next")');
  if (await nextBtn.isVisible({ timeout: 300 }).catch(() => false)) {
    await nextBtn.click();
    await page.waitForTimeout(320);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 1 — Normal path: all Q9 = 0 ("Not at all")
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
  await getToSurvey(page, 'Flow One', email);

  // Q1–Q15: answer + Next
  for (let i = 0; i < 15; i++) await answerAndNext(page, 0);

  // Q16 (last): answer, wait for enabled, submit
  await page.waitForSelector('[role="radiogroup"]', { timeout: 5000 });
  await page.locator('[role="radio"]').nth(0).click();
  await page.locator('button:has-text("See your results"):not([disabled])').waitFor({ timeout: 3000 });

  // Register PATCH listener BEFORE clicking (it fires fire-and-forget right after survey POST)
  const patchPromise = ctx.waitForEvent('response', {
    predicate: res => /\/api\/users\/[0-9a-f-]{36}/.test(res.url()) && res.request().method() === 'PATCH',
    timeout: 8000,
  }).catch(() => null);

  await page.locator('button:has-text("See your results")').click();
  pass('Clicked "See your results"');

  // Spinner (may be too fast to catch — that's OK)
  try {
    await page.locator('button:has-text("Submitting")').waitFor({ timeout: 2000 });
    pass('"Submitting…" spinner appeared');
  } catch { probe('"Submitting…" resolved before we could observe it'); }

  // Wait for dashboard (radiogroup disappears when SurveyFlow unmounts)
  await waitFor(page, () => !document.querySelector('[role="radiogroup"]'), 20000);
  pass('Dashboard reached — radiogroup gone');

  // Now await the fire-and-forget PATCH (it was already in flight)
  const patchRes = await patchPromise;
  if (patchRes) {
    networkLog.push({ url: patchRes.url(), status: patchRes.status(), method: 'PATCH' });
  }

  // Network checks
  const postUsers  = networkLog.find(r => r.url.includes('/api/users')  && r.method === 'POST');
  const postSurvey = networkLog.find(r => r.url.includes('/api/survey') && r.method === 'POST');
  const patchUsers = networkLog.find(r => r.url.match(/\/api\/users\/[0-9a-f-]{36}/) && r.method === 'PATCH');

  postUsers  ? pass(`POST /api/users → ${postUsers.status}`)   : fail('POST /api/users not in network log');
  postSurvey ? pass(`POST /api/survey → ${postSurvey.status}`) : fail('POST /api/survey not in network log');
  patchUsers ? pass(`PATCH /api/users/:id → ${patchUsers.status}`) : fail('PATCH /api/users/:id not in network log');

  const relevant = networkLog.filter(r =>
    (r.url.includes('/api/users') && r.method === 'POST') ||
    (r.url.includes('/api/survey') && r.method === 'POST') ||
    (r.url.match(/\/api\/users\/[0-9a-f-]{36}/) && r.method === 'PATCH')
  );
  probe(`Call order: ${relevant.map(r => `${r.method} ${r.url.replace('http://localhost:3001','')}`).join(' → ')}`);

  // localStorage
  const storedId = await page.evaluate(() => localStorage.getItem('mosaic_user_id'));
  if (storedId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storedId)) {
    pass(`localStorage mosaic_user_id = ${storedId}`);
  } else {
    fail(`localStorage mosaic_user_id missing or not a UUID: "${storedId}"`);
  }

  if (jsErrors.length) warn(`JS errors: ${jsErrors.join(' | ')}`);
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 2 — Q9 crisis interstitial
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
  await getToSurvey(page, 'Flow Two', email);

  // Q1–Q8
  for (let i = 0; i < 8; i++) await answerAndNext(page, 0);
  pass('Q1–Q8 answered');

  // Q9: "Several days" = radio[1]
  await page.waitForSelector('[role="radiogroup"]', { timeout: 5000 });
  await page.locator('[role="radio"]').nth(1).click();
  await page.locator('button:has-text("Next"):not([disabled])').waitFor({ timeout: 3000 });
  await page.locator('button:has-text("Next")').click();
  await page.waitForTimeout(400);
  pass('Q9 answered "Several days"');

  // Crisis screen
  const crisisHeading = page.locator('text=Thanks for being honest');
  await crisisHeading.waitFor({ timeout: 5000 }).catch(() => {});
  if (await crisisHeading.isVisible()) {
    pass('Crisis interstitial appeared');
  } else {
    fail('Crisis interstitial did NOT appear after Q9 > 0');
    await ctx.close(); return;
  }

  if (await page.locator('a[href="tel:988"]').isVisible()) pass('988 crisis link visible');
  else warn('988 crisis link not found');

  await page.locator('button:has-text("Continue my check-in")').click();
  await page.waitForTimeout(400);
  pass('"Continue my check-in" clicked');

  // Back on Q10
  await page.waitForSelector('[role="radiogroup"]', { timeout: 5000 });
  const counter = await page.locator('span.tabular-nums').textContent().catch(() => null);
  probe(`Counter after crisis continue: "${counter}"`);
  if (counter?.trim() === '10 / 16') pass('Counter shows 10 / 16 — resumed at Q10');
  else warn(`Counter shows "${counter?.trim()}" — expected "10 / 16"`);

  // Q10–Q15
  for (let i = 9; i < 15; i++) await answerAndNext(page, 0);

  // Q16
  await page.waitForSelector('[role="radiogroup"]', { timeout: 5000 });
  await page.locator('[role="radio"]').nth(0).click();
  await page.locator('button:has-text("See your results"):not([disabled])').waitFor({ timeout: 3000 });
  await page.locator('button:has-text("See your results")').click();
  pass('Clicked "See your results" after crisis continue');

  await waitFor(page, () => !document.querySelector('[role="radiogroup"]'), 20000);
  pass('Dashboard reached after crisis flow');

  const postSurvey = networkLog.find(r => r.url.includes('/api/survey') && r.method === 'POST');
  postSurvey ? pass(`POST /api/survey → ${postSurvey.status}`) : fail('POST /api/survey missing after crisis flow');

  if (jsErrors.length) warn(`JS errors: ${jsErrors.join(' | ')}`);
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOW 3 — Error path: backend killed before survey submit
// ─────────────────────────────────────────────────────────────────────────────
async function flow3(browser) {
  section('FLOW 3: Error path — backend stopped before survey submit');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));

  const email = `flow3-${Date.now()}@mosaic-verify.dev`;
  await getToSurvey(page, 'Flow Three', email);

  // Q1–Q15
  for (let i = 0; i < 15; i++) await answerAndNext(page, 0);

  // Q16: answer but don't submit yet
  await page.waitForSelector('[role="radiogroup"]', { timeout: 5000 });
  await page.locator('[role="radio"]').nth(0).click();
  await page.locator('button:has-text("See your results"):not([disabled])').waitFor({ timeout: 3000 });
  pass('On Q16, answer selected — killing backend now');

  try { execSync('pkill -f "ts-node-dev.*src/index.ts"', { stdio: 'ignore' }); } catch {}
  await page.waitForTimeout(600);
  probe('Backend killed');

  // Submit
  await page.locator('button:has-text("See your results")').click();

  // Spinner
  try {
    await page.locator('button:has-text("Submitting")').waitFor({ timeout: 4000 });
    pass('"Submitting…" spinner appeared');
  } catch { probe('"Submitting…" may have resolved before we caught it'); }

  // Must unblock (not stuck forever)
  await waitFor(page,
    () => !Array.from(document.querySelectorAll('button')).some(b => b.textContent?.includes('Submitting')),
    12000
  );
  pass('Submit button unblocked after network failure');

  // Inline error
  const errAlert = page.locator('[role="alert"]').filter({ hasText: /wrong|try again/i });
  if (await errAlert.isVisible({ timeout: 2000 }).catch(() => false)) {
    pass(`Inline error shown: "${(await errAlert.textContent())?.trim()}"`);
  } else {
    fail('No [role="alert"] error message after backend failure');
  }

  // Button re-enabled
  const disabled = await page.locator('button:has-text("See your results")').getAttribute('disabled').catch(() => null);
  disabled === null ? pass('Submit button re-enabled for retry') : fail('Submit button still disabled');

  // Stays on survey
  if (await page.locator('[role="radiogroup"]').isVisible()) pass('User stays on survey (no crash navigation)');
  else warn('Radiogroup not visible — may have navigated away');

  if (jsErrors.length) warn(`JS errors: ${jsErrors.join(' | ')}`);
  await ctx.close();
}

// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  // Ensure backend is up before starting
  const browser = await chromium.launch({ headless: true });
  try {
    await flow1(browser);
    await flow2(browser);
    await flow3(browser);
  } catch (err) {
    console.error('Unhandled runner error:', err?.message ?? err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
  console.log('\n' + (process.exitCode ? '❌  RESULT: FAIL' : '✅  RESULT: PASS'));
})();
