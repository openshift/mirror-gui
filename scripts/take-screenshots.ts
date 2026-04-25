import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, "../docs/screenshots");
const BASE_URL = "http://localhost:3001";

interface ScreenshotTask {
  name: string;
  url: string;
  waitFor: string;
  actions?: (page: import("playwright").Page) => Promise<void>;
}

const tasks: ScreenshotTask[] = [
  {
    name: "dashboard.png",
    url: "/",
    waitFor: "System Overview",
  },
  {
    name: "overview.png",
    url: "/",
    waitFor: "System Overview",
  },
  {
    name: "mirror-operations.png",
    url: "/operations",
    waitFor: "Mirror Operations",
  },
  {
    name: "config-edit-preview.png",
    url: "/config",
    waitFor: "Preview",
    actions: async (page) => {
      await page.getByRole("tab", { name: "Preview" }).click();
      await page.waitForTimeout(1500);
    },
  },
  {
    name: "config-upload-yaml.png",
    url: "/config",
    waitFor: "Load Configuration",
    actions: async (page) => {
      await page.getByRole("tab", { name: "Load Configuration" }).click();
      await page.waitForSelector("text=Upload YAML File", {
        timeout: 10_000,
      });
    },
  },
  {
    name: "config-add-operator.png",
    url: "/config",
    waitFor: "Operators",
    actions: async (page) => {
      await page.getByRole("tab", { name: "Operators" }).click();
      await page.waitForTimeout(1500);
    },
  },
  {
    name: "history.png",
    url: "/history",
    waitFor: "Operation History",
  },
  {
    name: "settings.png",
    url: "/settings",
    waitFor: "Settings",
  },
];

async function main() {
  console.log("Launching browser…");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  for (const task of tasks) {
    const url = `${BASE_URL}${task.url}`;
    console.log(`📸 ${task.name} — navigating to ${url}`);

    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForSelector(`text=${task.waitFor}`, { timeout: 15_000 });

    if (task.actions) {
      await task.actions(page);
    }

    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    const filepath = path.join(SCREENSHOTS_DIR, task.name);
    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`   ✅ saved ${filepath}`);
  }

  await browser.close();
  console.log("\nAll screenshots captured.");
}

main().catch((err) => {
  console.error("Screenshot script failed:", err);
  process.exit(1);
});
