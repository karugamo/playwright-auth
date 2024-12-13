#!/usr/bin/env node

import { chromium, firefox, webkit } from "@playwright/test";
import { Command } from "commander";
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

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

      console.log("Extracting IndexedDB data...");

      // Execute IndexedDB extraction code
      const idbs = await page.evaluate(async () => {
        const indexedDB = window.indexedDB;
        const dbs = await indexedDB.databases();

        const idbs: Record<string, string> = {};

        for (let dbIndex = 0; dbIndex < dbs.length; dbIndex++) {
          const dbInfo = dbs[dbIndex];
          const db: IDBDatabase = await new Promise((resolve, reject) => {
            let req = indexedDB.open(dbInfo.name as string, dbInfo.version);
            req.onsuccess = (event: any) => {
              resolve(event.target.result);
            };
            req.onupgradeneeded = (event: any) => {
              resolve(event.target.result);
            };
            req.onerror = (e) => {
              reject(e);
            };
          });

          let dbRes: { [k: string]: any } = {};

          for (
            let objectStorageIndex = 0;
            objectStorageIndex < db.objectStoreNames.length;
            objectStorageIndex++
          ) {
            const objectStorageName = db.objectStoreNames[objectStorageIndex];
            let objectStorageRes: { [k: string]: any } = {};

            // Open a transaction to access the firebaseLocalStorage object store
            const transaction = db.transaction([objectStorageName], "readonly");
            const objectStore = transaction.objectStore(objectStorageName);

            // Get all keys and values from the object store
            const getAllKeysRequest = objectStore.getAllKeys();
            const getAllValuesRequest = objectStore.getAll();

            const keys: any = await new Promise((resolve, reject) => {
              getAllKeysRequest.onsuccess = (event: any) => {
                resolve(event.target.result);
              };
              getAllKeysRequest.onerror = (e) => {
                reject(e);
              };
            });

            const values: any = await new Promise((resolve, reject) => {
              getAllValuesRequest.onsuccess = (event: any) => {
                resolve(event.target.result);
              };
              getAllValuesRequest.onerror = (e) => {
                reject(e);
              };
            });

            for (let i = 0; i < keys.length; i++) {
              objectStorageRes[keys[i]] = JSON.stringify(values[i]);
            }

            dbRes[objectStorageName] = objectStorageRes;
          }
          idbs[db.name] = JSON.stringify(dbRes);
        }

        return idbs;
      });

      console.log(
        `IndexedDB data extracted successfully! Found ${
          Object.keys(idbs).length
        } databases`
      );

      await context.storageState({ path: "auth.json" });
      const authData = JSON.parse(readFileSync("auth.json", "utf-8"));

      authData.idbs = idbs;
      authData.idbsUrl = url;

      writeFileSync("auth.json", JSON.stringify(authData, null, 2));

      await browser.close();

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

      const auth = JSON.parse(readFileSync(file, "utf-8")) as {
        idbs: Record<string, string>;
        idbsUrl: string;
      };

      const context = await browser.newContext({
        storageState: file,
      });

      const page = await context.newPage();

      await page.goto(auth.idbsUrl);

      // Load IndexedDB data
      await page.evaluate(async (auth) => {
        const indexedDB = window.indexedDB;

        for (const dbName in auth.idbs) {
          const dbData = JSON.parse(auth.idbs[dbName]);
          const tables = Object.keys(dbData);

          const db: IDBDatabase = await new Promise((resolve, reject) => {
            let req = indexedDB.open(dbName as string);
            req.onsuccess = (event: any) => {
              resolve(event.target.result);
            };
            req.onupgradeneeded = (event: any) => {
              resolve(event.target.result);
            };
            req.onerror = (e) => {
              reject(e);
            };
            req.onblocked = (event: any) => {
              reject(event);
            };
          });

          for (const table of [tables[0]]) {
            const transaction = db.transaction([table], "readwrite");
            const objectStore = transaction.objectStore(table);

            for (const key of Object.keys(dbData[table])) {
              const value = dbData[table][key];

              // Parse value in case of keyPath
              let parsedValue =
                typeof value !== "string" ? JSON.stringify(value) : value;
              try {
                parsedValue = JSON.parse(parsedValue);
              } catch (e) {
                // value type is not json, nothing to do
              }

              if (objectStore.keyPath != null) {
                objectStore.put(parsedValue);
              } else {
                objectStore.put(parsedValue, key);
              }

              await new Promise((resolve) => {
                transaction.oncomplete = () => resolve(undefined);
              });
            }
          }
        }
      }, auth);

      // reload page
      await page.reload();

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
