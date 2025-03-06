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
  await page.goto(authData.idbsUrl, { waitUntil: "domcontentloaded" });

  // Load IndexedDB data
  await page.evaluate(async (auth: AuthData) => {
    const indexedDB = window.indexedDB;
    const errors: Array<{
      dbName: string;
      table?: string;
      key?: string;
      error: string;
    }> = [];

    for (const dbName in auth.idbs) {
      try {
        const dbData = JSON.parse(auth.idbs[dbName]);
        const tables = Object.keys(dbData);

        const db: IDBDatabase = await new Promise((resolve, reject) => {
          let req = indexedDB.open(dbName as string);

          req.onupgradeneeded = (event: any) => {
            const db = event.target.result;
            resolve(db);
          };

          req.onsuccess = (event: any) => resolve(event.target.result);
          req.onerror = (event: any) =>
            reject(
              new Error(
                `Failed to open database '${dbName}': ${event.target.error}`
              )
            );
          req.onblocked = (event: any) =>
            reject(
              new Error(`Database '${dbName}' blocked: ${event.target.error}`)
            );
        });

        for (const table of tables) {
          try {
            const transaction = db.transaction([table], "readwrite");
            const objectStore = transaction.objectStore(table);

            transaction.onerror = (event: any) => {
              errors.push({
                dbName,
                table,
                error: `Transaction error: ${event.target.error}`,
              });
            };

            for (const key of Object.keys(dbData[table])) {
              try {
                const value = dbData[table][key];

                // Parse value in case of keyPath
                let parsedValue =
                  typeof value !== "string" ? JSON.stringify(value) : value;
                try {
                  parsedValue = JSON.parse(parsedValue);
                } catch (e) {
                  // value type is not json, nothing to do
                }

                const request =
                  objectStore.keyPath != null
                    ? objectStore.put(parsedValue)
                    : objectStore.put(parsedValue, key);

                request.onerror = (event: any) => {
                  errors.push({
                    dbName,
                    table,
                    key,
                    error: `Failed to put value: ${event.target.error}`,
                  });
                };

                await new Promise((resolve) => {
                  request.onsuccess = () => resolve(undefined);
                  transaction.oncomplete = () => resolve(undefined);
                });
              } catch (keyError: unknown) {
                errors.push({
                  dbName,
                  table,
                  key,
                  error: `Key error: ${
                    keyError instanceof Error
                      ? keyError.message
                      : String(keyError)
                  }`,
                });
              }
            }
          } catch (tableError: unknown) {
            errors.push({
              dbName,
              table,
              error: `Table error: ${
                tableError instanceof Error
                  ? tableError.message
                  : String(tableError)
              }`,
            });
          }
        }
      } catch (dbError: unknown) {
        errors.push({
          dbName,
          error: `Database error: ${
            dbError instanceof Error ? dbError.message : String(dbError)
          }`,
        });
      }
    }

    // If there were any errors, attach them to the window for retrieval
    if (errors.length > 0) {
      console.error("IndexedDB load errors:", errors);
      (window as any).__indexedDBLoadErrors = errors;
    }
  }, authData as any);

  // Check if there were any errors during the IndexedDB loading
  const errors = await page.evaluate(
    () => (window as any).__indexedDBLoadErrors || null
  );
  if (errors) {
    console.error("Failed to load some IndexedDB data:", errors);
    // You can choose to throw an error here if you want to fail the process
    // throw new Error(`Failed to load IndexedDB data: ${JSON.stringify(errors)}`);
  }

  await page.reload();
}
