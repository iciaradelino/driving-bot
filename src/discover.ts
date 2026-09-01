/**
 * headed playwright session that records calendar-related xhr/fetch traffic.
 * log in manually in the opened browser, open calendario, then press enter here.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import type { CapturedRequest } from "./types.js";
import { loadEnvFile, rootPath } from "./utils.js";

loadEnvFile();

const INTERESTING =
  /api\.autius\.com|\/api\/|graphql|calendar|calendario|lesson|auth|session|signin|sign-in/i;

const CALENDAR_URL =
  process.env.AUTIUS_CALENDAR_URL?.trim() || "https://app.autius.com/calendario";
const SIGNIN_URL =
  process.env.AUTIUS_SIGNIN_URL?.trim() || "https://app.autius.com/signin";

async function main(): Promise<void> {
  const outDir = rootPath("discovery");
  mkdirSync(outDir, { recursive: true });

  const entries: CapturedRequest[] = [];

  console.log("launching chromium…");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "es-ES",
  });
  const page = await context.newPage();

  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (!INTERESTING.test(url)) return;
      const req = res.request();
      const resourceType = req.resourceType();
      if (resourceType !== "xhr" && resourceType !== "fetch") return;

      const body = await res.text().catch(() => "");
      // skip huge binary-ish payloads
      if (body.length > 500_000) return;

      entries.push({
        url,
        method: req.method(),
        status: res.status(),
        reqHeaders: req.headers(),
        requestBody: req.postData(),
        responseBody: body,
        capturedAt: new Date().toISOString(),
      });
      console.log(`[${res.status()}] ${req.method()} ${url}`);
    } catch {
      // ignore mid-navigation races
    }
  });

  await page.goto(SIGNIN_URL, { waitUntil: "domcontentloaded" });

  console.log("");
  console.log("1. log in in the browser window");
  console.log("2. open the calendario page (or wait if redirected there)");
  console.log("3. browse a week/month so slots load");
  console.log("4. come back here and press enter");
  console.log("");

  // also navigate to calendar after a short delay hint — user may already be logged in
  try {
    await page.waitForURL(/calendario|signin|dashboard|\//, { timeout: 5_000 });
  } catch {
    /* ok */
  }

  const rl = createInterface({ input, output });
  await rl.question("press enter when the calendar has finished loading… ");
  rl.close();

  // one more nudge to the calendar url in case user stayed on signin
  if (!page.url().includes("calendario")) {
    console.log(`navigating to ${CALENDAR_URL}…`);
    await page.goto(CALENDAR_URL, { waitUntil: "networkidle" }).catch(() => undefined);
    await page.waitForTimeout(3_000);
  }

  const requestsPath = rootPath("discovery", "requests.json");
  writeFileSync(requestsPath, JSON.stringify(entries, null, 2), "utf8");

  const storagePath = rootPath("discovery", "storageState.json");
  await context.storageState({ path: storagePath });

  const summary = buildSummary(entries);
  const summaryPath = rootPath("discovery", "summary.md");
  writeFileSync(summaryPath, summary, "utf8");

  console.log("");
  console.log(`wrote ${entries.length} requests → ${requestsPath}`);
  console.log(`wrote storage state → ${storagePath}`);
  console.log(`wrote summary → ${summaryPath}`);

  await browser.close();
}

function buildSummary(entries: CapturedRequest[]): string {
  const lines: string[] = [
    "# discovery summary",
    "",
    `captured: ${entries.length} requests`,
    "",
    "## unique endpoints",
    "",
  ];

  const seen = new Set<string>();
  for (const e of entries) {
    let path = e.url;
    try {
      const u = new URL(e.url);
      path = `${u.origin}${u.pathname}`;
    } catch {
      /* keep raw */
    }
    const key = `${e.method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- \`${e.method}\` ${path} → ${e.status}`);
  }

  lines.push("", "## likely calendar / auth candidates", "");
  for (const e of entries) {
    if (
      /lesson|calendar|calendario|auth|session|sign-?in/i.test(e.url) &&
      e.status >= 200 &&
      e.status < 400
    ) {
      lines.push(`- \`${e.method}\` ${e.url} (${e.status})`);
    }
  }

  lines.push(
    "",
    "## next steps",
    "",
    "1. open `discovery/requests.json` and find the calendar list response",
    "2. note auth: cookie session vs bearer token",
    "3. if `npm run check` fails login, update `src/autius.ts` using the captured sign-in request",
    "",
  );

  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
