/**
 * Runs the hourly pipeline once, locally:  npm run refresh
 * Needs GITHUB_TOKEN (and optionally ANTHROPIC_API_KEY). Writes to ./.data
 * unless BLOB_READ_WRITE_TOKEN is set.
 */
import { refreshUniverse } from "../src/lib/server/pipeline";

refreshUniverse()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((err) => {
    console.error("refresh failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
