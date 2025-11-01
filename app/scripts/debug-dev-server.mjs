import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on('console', (message) => {
    console.log(`[console] ${message.type()}: ${message.text()}`);
  });

  page.on('pageerror', (error) => {
    console.log(`[pageerror] ${error.message}`);
  });

  await page.goto('http://localhost:1420/', { waitUntil: 'load', timeout: 10000 });

  console.log('Page content snippet:', (await page.content()).slice(0, 200));

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
