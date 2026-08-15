/**
 * Zero-dependency `.env` loader.
 *
 * The platform reads all configuration from `process.env` (see the LLM layer's
 * `providerFromEnv`). But a `.env` file on disk is NOT automatically loaded by
 * Node — something has to read it into `process.env` first. This helper does
 * that using Node's built-in `process.loadEnvFile` (Node ≥ 20.12 / 21.7), with
 * no third-party `dotenv` dependency.
 *
 * It walks up from the current working directory to find the nearest `.env`
 * (so it works whether you run from the repo root or a package folder), loads
 * it if present, and is a silent no-op when absent — preserving the "runs fully
 * offline on the mock with zero config" behaviour.
 *
 * Values already present in `process.env` win over the file (real environment /
 * CI secrets are authoritative); `loadEnvFile` does not overwrite existing keys.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Find and load the nearest `.env` file, searching from `startDir` upward.
 * Returns the path that was loaded, or `undefined` if none was found.
 */
export function loadDotEnv(startDir: string = process.cwd()): string | undefined {
  let dir = startDir;
  // Walk up to the filesystem root looking for a .env.
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      try {
        // Built-in, no dependency. Does not overwrite existing process.env keys.
        (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(candidate);
        return candidate;
      } catch {
        // Malformed file or unsupported runtime — degrade to no-op.
        return undefined;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined; // reached the root
    dir = parent;
  }
}
