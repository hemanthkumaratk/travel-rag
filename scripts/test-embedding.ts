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

const CSV_PATH = path.join(
  process.cwd(),
  "archive",
  "india_travel_tourism_rag_dataset.csv",
);
const ROWS_TO_READ = 3;
const BOM = "\uFEFF";

function field(row: Record<string, string>, key: string): string {
  return (row[key] ?? "").trim();
}

/** Mirrors the document text built by scripts/ingest.ts. */
function buildDestinationText(row: Record<string, string>): string {
  const parts: Array<[string, string]> = [
    ["Destination", field(row, "destination")],
    ["State", field(row, "state_or_union_territory")],
    ["Type", field(row, "destination_type")],
    ["Attractions", field(row, "major_attractions")],
    ["Best season", field(row, "recommended_visit_season")],
    ["Description", field(row, "destination_description")],
    ["Tips", field(row, "travel_tips")],
    ["Interests", field(row, "travel_interests")],
  ];

  const sentences = parts
    .filter(([, value]) => value)
    // Values often end in a full stop; the join adds the separator instead.
    .map(([label, value]) => `${label}: ${value.replace(/\.\s*$/, "")}`);

  return `${sentences.join(". ")}.`;
}

async function main() {
  let csv: string;

  try {
    csv = readFileSync(CSV_PATH, "utf8");

    // The exported CSV starts with a UTF-8 BOM before the record_id header.
    if (csv.charCodeAt(0) === 0xfeff) {
      csv = csv.slice(BOM.length);
    }
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
    const text = buildDestinationText(row);

    console.log(`\n${row.destination}`);
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
