import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { createClient } from "@supabase/supabase-js";
import { getEmbedding } from "@/lib/embeddings";

// tsx does not load .env files on its own, so load the local env explicitly.
const ENV_PATH = path.join(process.cwd(), ".env.local");
const loadEnvFile = (process as unknown as { loadEnvFile?: (envPath: string) => void })
  .loadEnvFile;

if (existsSync(ENV_PATH) && loadEnvFile) {
  loadEnvFile(ENV_PATH);
}

const CSV_PATH = path.join(
  process.cwd(),
  "archive",
  "india_travel_tourism_rag_dataset.csv",
);
const BATCH_SIZE = 20;
const BOM = "\uFEFF";

type DestinationCsvRow = Record<string, string>;

type DestinationInsert = {
  record_id: string | null;
  destination: string;
  metadata: {
    destination: string;
    state_or_union_territory: string;
    destination_type: string;
    major_attractions: string;
    recommended_visit_season: string;
    travel_tips: string;
    travel_interests: string;
  };
  embedding: number[];
};

function field(row: DestinationCsvRow, key: string): string {
  return (row[key] ?? "").trim();
}

/** The exported CSV starts with a UTF-8 BOM before the record_id header. */
function stripBom(csv: string): string {
  return csv.startsWith(BOM) ? csv.slice(BOM.length) : csv;
}

function buildDestinationText(row: DestinationCsvRow): string {
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

function buildMetadata(row: DestinationCsvRow): DestinationInsert["metadata"] {
  return {
    destination: field(row, "destination"),
    state_or_union_territory: field(row, "state_or_union_territory"),
    destination_type: field(row, "destination_type"),
    major_attractions: field(row, "major_attractions"),
    recommended_visit_season: field(row, "recommended_visit_season"),
    travel_tips: field(row, "travel_tips"),
    travel_interests: field(row, "travel_interests"),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reads --limit=N (or --limit N) from the CLI; null when the flag is absent. */
function parseLimit(argv: string[]): number | null {
  const index = argv.findIndex((arg) => arg === "--limit" || arg.startsWith("--limit="));

  if (index === -1) {
    return null;
  }

  const flag = argv[index];
  const raw = flag.includes("=") ? flag.slice(flag.indexOf("=") + 1) : argv[index + 1];
  const limit = Number(raw);

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Invalid --limit value: ${raw ?? "(missing)"}. Expected a positive integer.`);
  }

  return limit;
}

async function main() {
  let csv: string;

  try {
    csv = stripBom(readFileSync(CSV_PATH, "utf8"));
  } catch {
    console.error(`Could not read ${CSV_PATH}`);
    console.error("Run this from the project root and make sure archive/ is there.");
    process.exitCode = 1;
    return;
  }

  const { data: parsedRows, errors } = Papa.parse<DestinationCsvRow>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  if (errors.length > 0) {
    console.warn(`CSV parse warnings: ${errors.length} (continuing)`);
  }

  console.log(`Parsed ${parsedRows.length} rows from ${path.basename(CSV_PATH)}\n`);

  let limit: number | null;

  try {
    limit = parseLimit(process.argv.slice(2));
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
    return;
  }

  const rows = limit === null ? parsedRows : parsedRows.slice(0, limit);

  if (limit !== null) {
    console.log(`Limiting to ${limit} rows for test run\n`);
  }

  // Ingestion runs server-side with the service role key, which bypasses RLS.
  // Never expose this key to the browser or prefix it with NEXT_PUBLIC_.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: preflightError } = await supabase.from("destinations").select("id").limit(1);

  if (preflightError) {
    console.error(`Cannot query the destinations table: ${preflightError.message}`);
    console.error(
      "Check NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local and the table name.",
    );
    process.exitCode = 1;
    return;
  }

  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  const firstInsertedDestinations: string[] = [];
  const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batchNumber = Math.floor(start / BATCH_SIZE) + 1;
    const batchRows = rows.slice(start, start + BATCH_SIZE);
    const payloads: DestinationInsert[] = [];

    for (const row of batchRows) {
      const destination = field(row, "destination");

      if (!destination) {
        skipped += 1;
        continue;
      }

      let embedding: number[];

      try {
        // Document side: RETRIEVAL_DOCUMENT, 768 dimensions, matching the
        // destinations.embedding vector(768) column.
        embedding = await getEmbedding(buildDestinationText(row));
      } catch (error) {
        failed += 1;
        console.error(`Embedding failed for "${destination}": ${errorMessage(error)}`);
        continue;
      }

      payloads.push({
        record_id: field(row, "record_id") || null,
        destination,
        metadata: buildMetadata(row),
        embedding,
      });
    }

    if (payloads.length > 0) {
      const { error } = await supabase
        .from("destinations")
        .upsert(payloads, { onConflict: "record_id" })
        .select("destination");

      if (!error) {
        inserted += payloads.length;
        for (const payload of payloads) {
          if (firstInsertedDestinations.length < 2) {
            firstInsertedDestinations.push(payload.destination);
          }
        }
      } else {
        console.warn(
          `Batch ${batchNumber} upsert failed (${error.message}); retrying rows individually.`,
        );

        for (const payload of payloads) {
          const { error: rowError } = await supabase
            .from("destinations")
            .upsert(payload, { onConflict: "record_id" })
            .select("destination");

          if (rowError) {
            failed += 1;
            console.error(`  "${payload.destination}" failed: ${rowError.message}`);
          } else {
            inserted += 1;
            if (firstInsertedDestinations.length < 2) {
              firstInsertedDestinations.push(payload.destination);
            }
          }
        }
      }
    }

    console.log(
      `Batch ${batchNumber}/${totalBatches}: inserted ${inserted}/${rows.length} (skipped ${skipped}, failed ${failed})`,
    );

    if (batchNumber === 1 && inserted === 0 && failed > 0) {
      console.error(
        "\nAborting: every insert in the first batch failed. Check the service role key and that record_id has a unique constraint.",
      );
      process.exitCode = 1;
      break;
    }
  }

  console.log("\n-------- Ingestion summary --------");
  console.log(`Total rows in CSV: ${rows.length}`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Skipped (empty destination): ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(
    `First inserted destinations: ${firstInsertedDestinations.length > 0 ? firstInsertedDestinations.join(", ") : "(none)"}`,
  );
}

main();
