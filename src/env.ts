import fs from "node:fs";
import path from "node:path";

/**
 * Loads .env into process.env for standalone scripts (Next.js loads .env itself, but
 * our tsx scripts run outside Next, so they need this). Uses Node's built-in
 * process.loadEnvFile (stable since Node 21) -- no dotenv dependency needed.
 */
export function loadEnv(): void {
  const envPath = path.resolve(".env");
  if (fs.existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}
