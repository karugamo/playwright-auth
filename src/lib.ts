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
  await page.evaluate(() => {
    window.stop();
  });

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
  }, authData);

  await page.reload();
}
