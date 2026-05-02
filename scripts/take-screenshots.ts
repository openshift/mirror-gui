import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, "../docs/screenshots");
const BASE_URL = `http://localhost:${process.env.E2E_PORT || "3000"}`;

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
    waitFor: "Environment",
  },
  {
    name: "dashboard-dark.png",
    url: "/",
    waitFor: "Environment",
    actions: async (page) => {
      await page.getByLabel("Theme selection").click();
      await page.getByRole("menuitem", { name: /Dark/ }).click();
      await page.waitForTimeout(500);
    },
  },
  {
    name: "overview.png",
    url: "/",
    waitFor: "Environment",
    actions: async (page) => {
      await page.getByLabel("Theme selection").click();
      await page.getByRole("menuitem", { name: /Light/ }).click();
      await page.waitForTimeout(300);
    },
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
    actions: async (page) => {
      const textarea = page.locator("textarea").first();
      if (await textarea.isVisible()) {
        await textarea.fill("");
      }
      await page.waitForTimeout(300);
    },
  },
  {
    name: "settings-registry.png",
    url: "/settings",
    waitFor: "Settings",
    actions: async (page) => {
      await page.getByRole("tab", { name: "Registry" }).click();
      await page.waitForTimeout(500);
      const verifyBtn = page.getByText("Verify All").first();
      if (await verifyBtn.isVisible()) {
        await verifyBtn.click();
        await page.waitForTimeout(8000);
      }
    },
  },
  {
    name: "settings-cache.png",
    url: "/settings",
    waitFor: "Settings",
    actions: async (page) => {
      await page.getByRole("tab", { name: "Cache" }).click();
      await page.waitForTimeout(500);
    },
  },
];

async function main() {
  console.log("Launching browser…");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
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

  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle", timeout: 30_000 });
  await page.getByLabel("Theme selection").click();
  await page.getByRole("menuitem", { name: /System/ }).click();

  await browser.close();
  console.log("\nAll screenshots captured.");
}

main().catch((err) => {
  console.error("Screenshot script failed:", err);
  process.exit(1);
});
