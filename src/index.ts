import pup = require('puppeteer');

async function run() {
    const browser = await pup.launch();
    const page = await browser.newPage();
    await page.goto("http://github.com/");
}

run().then(()=>{});
