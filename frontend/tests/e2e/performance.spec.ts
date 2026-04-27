import { test } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Performance Diagnosis', () => {
  test('Upload signal_data.csv and render charts', async ({ page }) => {
    // Generate a unique user email to avoid conflicts
    const userEmail = `test_${Date.now()}@example.com`;
    const password = 'password123';

    // 1. Register
    await page.goto('/register');
    await page.fill('input[name="email"]', userEmail);
    await page.fill('input[name="password"]', password);
    await page.fill('input[name="confirmPassword"]', password);
    await page.click('button[type="submit"]');

    // 2. Login
    await page.waitForURL('**/login');
    await page.fill('input[name="email"]', userEmail);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');

    // 3. Go to Signals Page
    await page.waitForURL('**/');
    await page.goto('/signals');

    // 4. Upload Signal
    await page.click('button:has-text("Upload Signal")');

    // Select the file
    const filePath = path.resolve(__dirname, '../../../../data/signal_data.csv');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePath);

    // Track upload time
    const uploadStartTime = Date.now();

    // 5. Configure Columns
    // Wait for the configuration panel to appear
    await page.waitForSelector('text=Configure Column Mapping', { timeout: 10000 });
    const uploadEndTime = Date.now();
    console.log(`[Performance] File upload took ${uploadEndTime - uploadStartTime}ms`);

    // For stacked format, ensure a datetime column is selected if not auto-selected
    const processButton = page.locator('button:has-text("Process Signal")');

    // In stacked format, the datetime column might need selection
    const datetimeRadio = page.locator('input[type="radio"][value="datetime"]');
    if (await datetimeRadio.isVisible()) {
        await datetimeRadio.check();
    }

    const selectAllButton = page.locator('button:has-text("Select all")');
    if (await selectAllButton.isVisible()) {
        await selectAllButton.click();
    }

    // Process the signal
    const processStartTime = Date.now();
    await processButton.click();

    // 6. Wait for Processing to Complete
    // Wait for the Explore button to appear
    const exploreButton = page.locator('button:has-text("Explore →")').first();
    await exploreButton.waitFor({ state: 'visible', timeout: 30000 });
    const processEndTime = Date.now();
    console.log(`[Performance] Signal processing took ${processEndTime - processStartTime}ms`);

    // 7. Verify Rendering
    const renderStartTime = Date.now();
    await exploreButton.click();

    // Wait for the main layout to load
    await page.waitForURL('**/?signalId=*');

    // Assert that a chart canvas or SVG is rendered (Plotly creates these)
    await page.waitForSelector('.js-plotly-plot', { timeout: 15000 });
    const renderEndTime = Date.now();
    console.log(`[Performance] Chart rendering took ${renderEndTime - renderStartTime}ms`);

    console.log(`[Performance] Total end-to-end time: ${renderEndTime - uploadStartTime}ms`);
  });
});
