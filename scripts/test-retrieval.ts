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
  "Best beaches in Kerala",
  "Heritage sites in Rajasthan",
  "Hill stations for trekking",
];

async function main() {
  const { retrieveDestinations } = await import("@/lib/rag");
  const { getQueryEmbedding } = await import("@/lib/embeddings");

  try {
    const probe = await getQueryEmbedding(QUERIES[0]);
    console.log(`Query embedding dimension: ${probe.length}`);
  } catch (error) {
    console.error("  query embedding failed:");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }

  for (const query of QUERIES) {
    console.log(`\nQuery: "${query}"`);

    let results;

    try {
      results = await retrieveDestinations(query, 5);
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

    results.forEach((destination, index) => {
      console.log(
        `  ${index + 1}. ${destination.title} — similarity ${destination.similarity.toFixed(3)}`,
      );
    });
  }
}

main();
