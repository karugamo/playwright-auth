#!/usr/bin/env node

import { chromium, firefox, webkit } from "@playwright/test";
import { Command } from "commander";
import { execSync } from "child_process";

const program = new Command();

program
  .name("playwright-auth")
  .description("CLI tool to manage browser authentication with Playwright")
  .version("1.0.0");

program
  .command("create")
  .description("Launch a browser using Playwright")
  .option(
    "-b, --browser <type>",
    "browser to use (chrome, firefox, safari)",
    "chrome"
  )
  .action(async (options) => {
    try {
      console.log("Checking for Playwright browsers...");
      execSync(`npx playwright install chromium firefox webkit`, {
        stdio: "inherit",
      });

      const browserChoice = options.browser.toLowerCase() as string;
      const browserType =
        {
          chrome: chromium,
          firefox: firefox,
          safari: webkit,
        }[browserChoice] || chromium;

      if (!browserType) {
        console.error(
          "Invalid browser choice. Must be chrome, firefox, or safari"
        );
        process.exit(1);
      }

      console.log(`\nLaunching ${browserChoice} browser...`);

      const browser = await browserType.launch({
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
      console.error("Error:", error);
      process.exit(1);
    }
  });

program
  .command("load")
  .description("Launch browser with saved authentication state")
  .argument("<file>", "Path to the authentication state file")
  .option(
    "-b, --browser <type>",
    "browser to use (chrome, firefox, safari)",
    "chrome"
  )
  .action(async (file, options) => {
    try {
      const browserChoice = options.browser.toLowerCase() as string;
      const browserType =
        {
          chrome: chromium,
          firefox: firefox,
          safari: webkit,
        }[browserChoice] || chromium;

      if (!browserType) {
        console.error(
          "Invalid browser choice. Must be chrome, firefox, or safari"
        );
        process.exit(1);
      }

      console.log(
        `Launching ${browserChoice} browser with saved auth state...`
      );

      const browser = await browserType.launch({
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
