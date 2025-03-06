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
          const objectStoreNames = Object.keys(dbData);
          console.log(
            `Opening database: ${dbName} with ${objectStoreNames.length} object stores`
          );

          let db: IDBDatabase;

          // First try to open the database to check if we need to create object stores
          const needsUpgrade = await new Promise<boolean>((resolve) => {
            const request = indexedDB.open(dbName);
            request.onsuccess = (event: any) => {
              const tempDb = event.target.result;
              // Check if any object stores are missing
              const missingObjectStores = objectStoreNames.filter(
                (storeName) => !tempDb.objectStoreNames.contains(storeName)
              );
              tempDb.close();
              resolve(missingObjectStores.length > 0);
            };
            request.onerror = () => resolve(false);
          });

          if (needsUpgrade) {
            console.log(
              `Database "${dbName}" needs upgrade to create missing object stores`
            );
            // Get current version
            const getVersion = await new Promise<number>((resolve) => {
              const request = indexedDB.open(dbName);
              request.onsuccess = (event: any) => {
                const version = event.target.result.version;
                event.target.result.close();
                resolve(version);
              };
              request.onerror = () => resolve(1);
            });

            // Open with a higher version to trigger onupgradeneeded
            db = await new Promise((resolve, reject) => {
              const request = indexedDB.open(dbName, getVersion + 1);

              request.onupgradeneeded = (event: any) => {
                const db = event.target.result;

                // Create missing object stores
                for (const storeName of objectStoreNames) {
                  if (!db.objectStoreNames.contains(storeName)) {
                    console.log(`Creating missing object store: ${storeName}`);
                    db.createObjectStore(storeName, {
                      keyPath: "id",
                      autoIncrement: true,
                    });
                  }
                }
              };

              request.onsuccess = (event: any) => resolve(event.target.result);
              request.onerror = reject;
              request.onblocked = reject;
            });
          } else {
            // Just open the database normally if no upgrade needed
            db = await new Promise((resolve, reject) => {
              const request = indexedDB.open(dbName);
              request.onsuccess = (event: any) => resolve(event.target.result);
              request.onerror = reject;
              request.onblocked = reject;
            });
          }

          for (const storeName of objectStoreNames) {
            try {
              // Create a transaction for each object store
              console.log(`Processing object store: ${storeName}`);
              const transaction = db.transaction([storeName], "readwrite");
              const objectStore = transaction.objectStore(storeName);

              // Wait for the transaction to complete
              const transactionComplete = new Promise<void>(
                (resolve, reject) => {
                  transaction.oncomplete = () => {
                    console.log(
                      `Transaction completed for object store: ${storeName}`
                    );
                    resolve();
                  };
                  transaction.onerror = () =>
                    reject(
                      new Error(
                        `Transaction for object store ${storeName} failed`
                      )
                    );
                  transaction.onabort = () =>
                    reject(
                      new Error(
                        `Transaction for object store ${storeName} aborted`
                      )
                    );
                }
              );

              // Add all items to the object store
              const itemCount = Object.keys(dbData[storeName]).length;
              console.log(
                `Adding ${itemCount} items to object store: ${storeName}`
              );
              for (const key of Object.keys(dbData[storeName])) {
                const value = dbData[storeName][key];

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

              // Wait for this object store's transaction to complete before moving to the next
              await transactionComplete;
            } catch (storeError: any) {
              console.warn(
                `Error processing object store "${storeName}": ${storeError.message}`
              );
              // Continue with other object stores instead of failing the entire process
            }
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
        `Retry ${retryCount}/${maxRetries} failed: ${e.message}. Waiting before retrying...`
      );

      // Wait for half a second before retrying
      if (retryCount < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        console.log(`Retrying attempt ${retryCount + 1}/${maxRetries}...`);
      }
    }
  }

  if (!success) {
    console.error(`Failed to load IndexedDB data after ${maxRetries} retries`);
    throw new Error("Failed to load IndexedDB data after multiple retries");
  }
}
