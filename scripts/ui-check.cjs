/* 临时 UI 冒烟测试：验证侧边栏收起 / 技能栏 / 批量删除 / 输入框融合 / 窄屏满屏 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const URL = process.env.UI_URL || 'http://127.0.0.1:18780/?token=fhcode-2026-fixed-token-9f3a';
const OUT = path.join(process.cwd(), '.ui-check');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true,
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('fhcode.token', 'fhcode-2026-fixed-token-9f3a');
      localStorage.setItem('fhcode.phone', '13800000000');
      localStorage.setItem('fhcode.sidebarCollapsed', '0');
    } catch (e) {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const r = {};
  r.title = await page.title();
  r.loggedIn = await page.evaluate(() => document.documentElement.classList.contains('logged-in'));
  r.callBarGone = (await page.locator('.call-bar').count()) === 0;
  r.workspaceInInputBar = await page.evaluate(() => !!document.getElementById('workspacePickBtn')?.closest('.input-bar'));
  r.messagesOverflow = await page.evaluate(() => getComputedStyle(document.getElementById('messages')).overflowY);
  r.sidebarWidthExpanded = await page.evaluate(() => Math.round(document.getElementById('sidebar').getBoundingClientRect().width));
  r.skillSection = await page.evaluate(() => !!document.getElementById('skillSection'));
  r.skillItems = await page.locator('#skillList .skill-item, #skillList .skill-empty').count();

  await page.screenshot({ path: path.join(OUT, 'desktop-expanded.png') });

  // 收起侧边栏
  await page.click('#sidebarFoldBtn');
  await page.waitForTimeout(450);
  r.sidebarWidthCollapsed = await page.evaluate(() => Math.round(document.getElementById('sidebar').getBoundingClientRect().width));
  r.collapsedClass = await page.evaluate(() => document.getElementById('appLayout').classList.contains('sidebar-collapsed'));
  r.labelHidden = await page.evaluate(() => {
    const el = document.querySelector('.sidebar-icon .label');
    return el ? getComputedStyle(el).display === 'none' : null;
  });
  await page.screenshot({ path: path.join(OUT, 'desktop-collapsed.png') });

  // 展开回去
  await page.click('#sidebarFoldBtn');
  await page.waitForTimeout(450);
  r.sidebarWidthReopened = await page.evaluate(() => Math.round(document.getElementById('sidebar').getBoundingClientRect().width));

  // 批量模式
  await page.click('#taskBatchBtn');
  await page.waitForTimeout(300);
  r.batchBarVisible = await page.evaluate(() => getComputedStyle(document.getElementById('taskBatchBar')).display !== 'none');
  r.batchBtnActive = await page.evaluate(() => document.getElementById('taskBatchBtn').classList.contains('active'));
  r.checkboxes = await page.locator('#taskListContainer [data-check-id]').count();
  await page.screenshot({ path: path.join(OUT, 'desktop-batch.png') });
  await page.click('#taskBatchCancelBtn');
  await page.waitForTimeout(200);
  r.batchBarHiddenAfterCancel = await page.evaluate(() => getComputedStyle(document.getElementById('taskBatchBar')).display === 'none');

  // 窄屏
  await page.setViewportSize({ width: 820, height: 900 });
  await page.waitForTimeout(700);
  r.narrowSidebarOffscreen = await page.evaluate(() => {
    const b = document.getElementById('sidebar').getBoundingClientRect();
    return b.right <= 1;
  });
  r.narrowRightPanelHidden = await page.evaluate(() => getComputedStyle(document.querySelector('.right-panel')).display === 'none');
  r.narrowChatFullWidth = await page.evaluate(() => {
    const chat = document.querySelector('.chat-area').getBoundingClientRect();
    return Math.round(chat.width) >= Math.round(window.innerWidth) - 2;
  });
  r.narrowMobileBtnVisible = await page.evaluate(() => getComputedStyle(document.getElementById('sidebarMobileBtn')).display !== 'none');
  await page.screenshot({ path: path.join(OUT, 'narrow-chat.png') });

  // 打开抽屉
  await page.click('#sidebarMobileBtn');
  await page.waitForTimeout(450);
  r.drawerOpen = await page.evaluate(() => document.getElementById('sidebar').getBoundingClientRect().left >= -1);
  r.backdropVisible = await page.evaluate(() => getComputedStyle(document.getElementById('sidebarBackdrop')).display !== 'none');
  await page.screenshot({ path: path.join(OUT, 'narrow-drawer.png') });

  // 重复 ID 护栏：任何重复 id 都会破坏 getElementById 绑定
  r.duplicateIds = await page.evaluate(() => {
    const ids = {};
    let dup = 0;
    document.querySelectorAll('[id]').forEach((el) => {
      const id = el.id;
      if (!id) return;
      ids[id] = (ids[id] || 0) + 1;
      if (ids[id] > 1) dup++;
    });
    return dup;
  });

  r.errors = errors.slice(0, 12);
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
