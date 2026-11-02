import { chromium } from "playwright";
import { CrawlSession } from "../lib/network.js";
export async function inspectBrowser(url: string, crawl: CrawlSession) {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    const errors: string[] = [];
    const failed: string[] = [];
    let count = 0;
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (!["GET", "HEAD"].includes(request.method()) || ++count > 60)
        return route.abort();
      try {
        const r = await crawl.fetch(request.url(), {
          maxBytes: 5_000_000,
          method: request.method() as "GET" | "HEAD",
        });
        const headers = { ...r.headers };
        for (const h of [
          "content-encoding",
          "content-length",
          "transfer-encoding",
          "set-cookie",
          "location",
        ])
          delete headers[h];
        await route.fulfill({ status: r.status, headers, body: r.body });
      } catch {
        failed.push(request.url());
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 500)));
    await page.routeWebSocket("**/*", (socket) => socket.close());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(1000);
    const layout = await page.evaluate(() => ({
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth + 2,
      images: [...document.images].slice(0, 50).map((i) => ({
        url: i.currentSrc,
        intrinsic: [i.naturalWidth, i.naturalHeight],
        rendered: [i.clientWidth, i.clientHeight],
      })),
      resources: performance
        .getEntriesByType("resource")
        .slice(0, 100)
        .map((e) => {
          const r = e as PerformanceResourceTiming;
          return {
            url: r.name,
            transferSize: r.transferSize || null,
            encodedBodySize: r.encodedBodySize || null,
          };
        }),
    }));
    const screenshot = await page.screenshot({ type: "png", fullPage: false });
    return {
      screenshot,
      layout,
      errors,
      failed: failed.slice(0, 30),
      viewport: { width: 390, height: 844 },
    };
  } finally {
    await browser.close();
  }
}
