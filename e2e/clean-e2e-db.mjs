import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(currentDir, '../backend');

for (const suffix of ['', '-shm', '-wal']) {
  const target = path.join(backendDir, `e2e_playwright.db${suffix}`);
  fs.rmSync(target, { force: true });
}
