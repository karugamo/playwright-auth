#!/usr/bin/env node

import { chromium, firefox, webkit } from "@playwright/test";
import { Command } from "commander";
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { AuthData, createAuth, loadAuth } from "./lib";

const program = new Command();

program
  .name("playwright-auth")
  .description("CLI tool to manage browser authentication with Playwright")
  .version("1.0.0");

program
  .command("create")
  .description("Launch a browser using Playwright")
  .argument("<url>", "URL to navigate to")
  .option(
    "-b, --browser <type>",
    "browser to use (chrome, firefox, safari)",
    "chrome"
  )
  .option("-f, --file <filename>", "output file name", "auth.json")
  .action(async (url, options) => {
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
      await page.goto(url);

      // Keep the browser open
      console.log(
        "Browser launched successfully! Press Enter to save and finish..."
      );

      // Wait for user to press Enter
      await new Promise((resolve) => {
        process.stdin.once("data", resolve);
      });

      const { authData } = await createAuth(page);
      writeFileSync(options.file, JSON.stringify(authData, null, 2));

      await browser.close();

      console.log(`Saved authentication state to ${options.file}`);
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

      const auth = JSON.parse(readFileSync(file, "utf-8")) as AuthData;

      const context = await browser.newContext({
        storageState: file,
      });

      const page = await context.newPage();

      await loadAuth(page, auth);

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
