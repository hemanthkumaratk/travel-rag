import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { getEmbedding } from "@/lib/embeddings";

// tsx does not load .env files on its own, so load the local env explicitly.
const ENV_PATH = path.join(process.cwd(), ".env.local");
const loadEnvFile = (process as unknown as { loadEnvFile?: (path: string) => void })
  .loadEnvFile;

if (existsSync(ENV_PATH) && loadEnvFile) {
  loadEnvFile(ENV_PATH);
}

const CSV_PATH = path.join(process.cwd(), "archive", "indian_cinema_dataset.csv");
const ROWS_TO_READ = 3;

function buildMovieText(row: Record<string, string>): string {
  const year = (row.release_date ?? "").slice(0, 4);
  const genres = (row.genres ?? "").replace(/,/g, " ");
  const directors = (row.directors ?? "").replace(/,/g, " ");
  const cast = (row.cast ?? "").replace(/,/g, " ");

  return `Title: ${row.title}. Year: ${year}. Genres: ${genres}. Director: ${directors}. Cast: ${cast}. Language: ${row.languages}.`;
}

async function main() {
  let csv: string;

  try {
    csv = readFileSync(CSV_PATH, "utf8");
  } catch {
    console.error(`Could not read ${CSV_PATH}`);
    console.error("Run this from the project root and make sure archive/ is there.");
    process.exitCode = 1;
    return;
  }

  const { data } = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    preview: ROWS_TO_READ + 5,
  });

  const rows = data.slice(0, ROWS_TO_READ);

  for (const row of rows) {
    const text = buildMovieText(row);

    console.log(`\n${row.title}`);
    console.log(`  text: ${text}`);

    let embedding: number[];

    try {
      embedding = await getEmbedding(text);
    } catch (error) {
      console.error("  embedding failed:");
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
      return;
    }

    console.log(`  first 5 numbers: [${embedding.slice(0, 5).join(", ")}]`);
    console.log(`  vector length: ${embedding.length}`);
  }
}

main();
