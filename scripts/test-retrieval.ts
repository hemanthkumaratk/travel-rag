import { existsSync } from "node:fs";
import path from "node:path";

// tsx does not load .env files on its own, so load the local env explicitly
// before importing the Supabase client (which validates env vars on import).
const ENV_PATH = path.join(process.cwd(), ".env.local");
const loadEnvFile = (process as unknown as { loadEnvFile?: (path: string) => void })
  .loadEnvFile;

if (existsSync(ENV_PATH) && loadEnvFile) {
  loadEnvFile(ENV_PATH);
}

const QUERIES = [
  "Mohanlal action movie",
  "Drama film about family",
  "Rajinikanth",
];

async function main() {
  const { retrieveMovies } = await import("@/lib/rag");

  for (const query of QUERIES) {
    console.log(`\nQuery: "${query}"`);

    let results;

    try {
      results = await retrieveMovies(query, 5);
    } catch (error) {
      console.error("  retrieval failed:");
      console.error(error);
      process.exitCode = 1;
      return;
    }

    if (results.length === 0) {
      console.log("  (no results)");
      continue;
    }

    results.forEach((movie, index) => {
      console.log(
        `  ${index + 1}. ${movie.title} — similarity ${movie.similarity.toFixed(3)}`,
      );
    });
  }
}

main();
