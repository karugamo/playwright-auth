#!/usr/bin/env node

import { chromium } from "@playwright/test";
import { Command } from "commander";

const program = new Command();

program
  .name("playwright-auth")
  .description("CLI tool to manage browser authentication with Playwright")
  .version("1.0.0");

program
  .command("create")
  .description("Launch a non-headless Chrome browser using Playwright")
  .action(async () => {
    try {
      console.log("Launching Chrome browser...");

      const browser = await chromium.launch({
        headless: false,
        args: ["--disable-blink-features=AutomationControlled"],
      });

      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto("https://www.google.com");

      // Keep the browser open
      console.log(
        "Browser launched successfully! Close the browser window to exit."
      );

      await page.waitForEvent("close", { timeout: 0 });

      // Save storage state to file
      await context.storageState({ path: "auth.json" });
      console.log("Saved authentication state to auth.json");
      process.exit(0);
    } catch (error) {
      console.error("Error launching browser:", error);
      process.exit(1);
    }
  });

program
  .command("load")
  .description("Launch browser with saved authentication state")
  .argument("<file>", "Path to the authentication state file")
  .action(async (file) => {
    try {
      console.log("Launching Chrome browser with saved auth state...");

      const browser = await chromium.launch({
        headless: false,
        args: ["--disable-blink-features=AutomationControlled"],
      });

      const context = await browser.newContext({
        storageState: file,
      });

      const page = await context.newPage();
      await page.goto("https://www.google.com");

      console.log(
        "Browser launched successfully! Close the browser window to exit."
      );

      await page.waitForEvent("close", { timeout: 0 });
      process.exit(0);
    } catch (error) {
      console.error("Error launching browser:", error);
      process.exit(1);
    }
  });

program.parse();
