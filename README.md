# playwright-auth 🔐✨

Helper to manage browser authentication with Playwright including IndexedDB data. This makes it work with Firebase Auth.

## Library Usage

```ts
import { createAuth, loadAuth } from "playwright-auth";

const { authData } = await createAuth(page);
await loadAuth(page, authData);
```

## CLI Usage

Install with

```
npm install -g playwright-auth
```

Create a new storage state file:

```
playwright-auth create
```

Load a storage state file:

```
playwright-auth load <file>
```

## Development

1. Clone this repository
2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

4. Link the CLI globally (optional):

```bash
npm link
```
