import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = '/Users/sudheer/.gemini/antigravity/brain/e87ec0d3-fa96-4ed8-a2b8-03da04f3146c';

async function dismissModals(page) {
  for (let i = 0; i < 3; i++) {
    const overlay = page.locator('.overlay, .modal-backdrop');
    if (await overlay.isVisible({ timeout: 500 }).catch(() => false)) {
      const closeBtn = page.locator('.overlay button[aria-label="Close"], button[aria-label="Close"]').first();
      if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await closeBtn.click();
      } else {
        await page.keyboard.press('Escape');
      }
      await page.waitForTimeout(400);
    } else {
      break;
    }
  }
}

async function navigateTab(page, tabName) {
  await dismissModals(page);
  console.log(`Navigating to ${tabName}...`);
  const navItem = page.locator(`.sb-label:has-text("${tabName}")`).first();
  await navItem.scrollIntoViewIfNeeded();
  await navItem.click();
  await page.waitForTimeout(1000);
}

async function run() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  console.log('Navigating to app...');
  await page.goto('http://127.0.0.1:9992');
  await page.waitForLoadState('networkidle');

  // Login
  console.log('Logging in...');
  const switchBtn = page.locator('.auth-switch button').first();
  if (await switchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    const text = await switchBtn.textContent();
    if (text && text.includes('Sign in')) {
      await switchBtn.click();
      await page.waitForTimeout(500);
    }
  }

  const slugInput = page.locator('input[placeholder="acme-studio"]').first();
  if (await slugInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await slugInput.fill('meridian-demo-5de8e3');
    await page.locator('input[type="email"], input[placeholder="alex@company.com"]').first().fill('demo-meridian-demo-5de8e3@example.test');
    await page.locator('input[type="password"]').first().fill('EIxu2j2b9Sx7cDwKc4tMFL3jrf4');
    await page.locator('button.primary.full').first().click();
    await page.waitForTimeout(2500);
  }

  await page.screenshot({ path: path.join(ARTIFACT_DIR, '01_login_home.png') });
  console.log('Saved 01_login_home.png');

  // Sprints tab
  await navigateTab(page, 'Sprints');
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '02_sprints_panel.png') });
  console.log('Saved 02_sprints_panel.png');

  // Sprint Report modal
  const reportBtn = page.locator('button:has-text("Sprint Report")').first();
  if (await reportBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await reportBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '03_sprint_report_modal.png') });
    console.log('Saved 03_sprint_report_modal.png');
    await dismissModals(page);
  }

  // Sprint Capacity modal
  const capacityBtn = page.locator('button:has-text("Capacity")').first();
  if (await capacityBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await capacityBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '04_sprint_capacity_modal.png') });
    console.log('Saved 04_sprint_capacity_modal.png');
    await dismissModals(page);
  }

  // Sprint Board modal
  const sprintBoardBtn = page.locator('button:has-text("Sprint Board")').first();
  if (await sprintBoardBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await sprintBoardBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '05_sprint_board_modal.png') });
    console.log('Saved 05_sprint_board_modal.png');
    await dismissModals(page);
  }

  // Roadmap tab
  await navigateTab(page, 'Roadmap');
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '06_roadmap_panel.png') });
  console.log('Saved 06_roadmap_panel.png');

  // Portfolio Roll-up sub-view
  const portfolioBtn = page.locator('button:has-text("Portfolio Roll-up")').first();
  if (await portfolioBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await portfolioBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '07_portfolio_rollup.png') });
    console.log('Saved 07_portfolio_rollup.png');
  }

  // RAID Register sub-view
  const raidBtn = page.locator('button:has-text("RAID Register")').first();
  if (await raidBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await raidBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, '08_raid_register.png') });
    console.log('Saved 08_raid_register.png');
  }

  // Service tab
  await navigateTab(page, 'Service');
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '09_service_panel_incidents_portal.png') });
  console.log('Saved 09_service_panel_incidents_portal.png');

  // Knowledge tab
  await navigateTab(page, 'Knowledge');
  // Click first page in tree if available
  const firstPage = page.locator('button.page-link').first();
  if (await firstPage.isVisible({ timeout: 3000 }).catch(() => false)) {
    await firstPage.click();
    await page.waitForTimeout(800);
  }
  // Click Inline Comments toggle if visible
  const inlineBtn = page.locator('button:has-text("Inline Comments")').first();
  if (await inlineBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await inlineBtn.click();
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: path.join(ARTIFACT_DIR, '10_knowledge_tab.png') });
  console.log('Saved 10_knowledge_tab.png');

  console.log('All visual verifications completed successfully!');
  await browser.close();
}

run().catch((err) => {
  console.error('Error during verification:', err);
  process.exit(1);
});
