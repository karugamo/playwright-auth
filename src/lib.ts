import { Page } from "@playwright/test";
import { readFileSync } from "fs";

export type AuthData = {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{
      name: string;
      value: string;
    }>;
  }>;
  idbs: Record<string, string>;
  idbsUrl: string;
};

export async function createAuth(page: Page): Promise<{ authData: AuthData }> {
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

        const transaction = db.transaction([objectStorageName], "readonly");
        const objectStore = transaction.objectStore(objectStorageName);

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

  const context = page.context();
  const authData = await context.storageState();

  return {
    authData: {
      ...authData,
      idbs,
      idbsUrl: page.url(),
    },
  };
}

export async function loadAuth(page: Page, authData: AuthData): Promise<void> {
  // Retry mechanism
  const maxRetries = 3;
  let retryCount = 0;
  let success = false;

  console.log(`Starting auth loading process with ${maxRetries} max retries`);

  while (retryCount < maxRetries && !success) {
    try {
      console.log(
        `Attempt ${retryCount + 1}/${maxRetries}: Navigating to ${
          authData.idbsUrl
        }`
      );
      await page.goto(authData.idbsUrl, { waitUntil: "domcontentloaded" });

      console.log(`Loading IndexedDB data...`);
      // Load IndexedDB data
      await page.evaluate(async (auth: AuthData) => {
        const indexedDB = window.indexedDB;
        console.log(`Processing ${Object.keys(auth.idbs).length} databases`);

        for (const dbName in auth.idbs) {
          const dbData = JSON.parse(auth.idbs[dbName]);
          const tables = Object.keys(dbData);
          console.log(
            `Opening database: ${dbName} with ${tables.length} tables`
          );

          const db: IDBDatabase = await new Promise((resolve, reject) => {
            let req = indexedDB.open(dbName as string);

            req.onsuccess = (event: any) => resolve(event.target.result);
            req.onerror = reject;
            req.onblocked = reject;
          });

          for (const table of tables) {
            // Create a transaction for each table
            console.log(`Processing table: ${table}`);
            const transaction = db.transaction([table], "readwrite");
            const objectStore = transaction.objectStore(table);

            // Wait for the transaction to complete
            const transactionComplete = new Promise<void>((resolve, reject) => {
              transaction.oncomplete = () => {
                console.log(`Transaction completed for table: ${table}`);
                resolve();
              };
              transaction.onerror = () =>
                reject(new Error(`Transaction for table ${table} failed`));
              transaction.onabort = () =>
                reject(new Error(`Transaction for table ${table} aborted`));
            });

            // Add all items to the object store
            const itemCount = Object.keys(dbData[table]).length;
            console.log(`Adding ${itemCount} items to table: ${table}`);
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
            }

            // Wait for this table's transaction to complete before moving to the next table
            await transactionComplete;
          }
        }
        console.log(`All IndexedDB data loaded successfully`);
      }, authData as any); // Add type assertion to fix the implicit any error

      console.log(`Reloading page to apply changes`);
      await page.reload();
      success = true;
      console.log(`Auth loading completed successfully`);
    } catch (e: any) {
      retryCount++;
      console.warn(
        `Retry ${retryCount}/${maxRetries} failed: ${e.message}. Retrying...`
      );
    }
  }

  if (!success) {
    console.error(`Failed to load IndexedDB data after ${maxRetries} retries`);
    throw new Error("Failed to load IndexedDB data after multiple retries");
  }
}
