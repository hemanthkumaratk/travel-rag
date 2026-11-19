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

const CSV_PATH = path.join(process.cwd(), "archive", "indian_cinema_dataset.csv");
const BATCH_SIZE = 20;

type MovieCsvRow = Record<string, string>;

type MovieInsert = {
  wikidata_id: string | null;
  title: string;
  metadata: {
    year: string;
    genres: string;
    directors: string;
    cast: string;
    languages: string;
    imdb_id: string;
    wikidata_url: string;
  };
  embedding: number[];
};

function buildMovieText(row: MovieCsvRow): string {
  const year = (row.release_date ?? "").slice(0, 4);
  const genres = (row.genres ?? "").replace(/,/g, " ");
  const directors = (row.directors ?? "").replace(/,/g, " ");
  const cast = (row.cast ?? "").replace(/,/g, " ");

  return `Title: ${row.title}. Year: ${year}. Genres: ${genres}. Director: ${directors}. Cast: ${cast}. Language: ${row.languages}.`;
}

function buildMetadata(row: MovieCsvRow): MovieInsert["metadata"] {
  return {
    year: (row.release_date ?? "").slice(0, 4),
    genres: row.genres ?? "",
    directors: row.directors ?? "",
    cast: row.cast ?? "",
    languages: row.languages ?? "",
    imdb_id: row.imdb_id ?? "",
    wikidata_url: row.wikidata_url ?? "",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  const { data: rows, errors } = Papa.parse<MovieCsvRow>(csv, {
    header: true,
    skipEmptyLines: true,
  });

  if (errors.length > 0) {
    console.warn(`CSV parse warnings: ${errors.length} (continuing)`);
  }

  console.log(`Parsed ${rows.length} rows from ${path.basename(CSV_PATH)}\n`);

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

  const { error: preflightError } = await supabase.from("movies").select("id").limit(1);

  if (preflightError) {
    console.error(`Cannot query the movies table: ${preflightError.message}`);
    console.error(
      "Check NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local and the table name.",
    );
    process.exitCode = 1;
    return;
  }

  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  const firstInsertedTitles: string[] = [];
  const totalBatches = Math.ceil(rows.length / BATCH_SIZE);

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batchNumber = Math.floor(start / BATCH_SIZE) + 1;
    const batchRows = rows.slice(start, start + BATCH_SIZE);
    const payloads: MovieInsert[] = [];

    for (const row of batchRows) {
      const title = (row.title ?? "").trim();

      if (!title) {
        skipped += 1;
        continue;
      }

      let embedding: number[];

      try {
        embedding = await getEmbedding(buildMovieText(row));
      } catch (error) {
        failed += 1;
        console.error(`Embedding failed for "${title}": ${errorMessage(error)}`);
        continue;
      }

      payloads.push({
        wikidata_id: row.wikidata_id?.trim() || null,
        title,
        metadata: buildMetadata(row),
        embedding,
      });
    }

    if (payloads.length > 0) {
      const { error } = await supabase
        .from("movies")
        .upsert(payloads, { onConflict: "wikidata_id" })
        .select("title");

      if (!error) {
        inserted += payloads.length;
        for (const payload of payloads) {
          if (firstInsertedTitles.length < 2) {
            firstInsertedTitles.push(payload.title);
          }
        }
      } else {
        console.warn(
          `Batch ${batchNumber} upsert failed (${error.message}); retrying rows individually.`,
        );

        for (const payload of payloads) {
          const { error: rowError } = await supabase
            .from("movies")
            .upsert(payload, { onConflict: "wikidata_id" })
            .select("title");

          if (rowError) {
            failed += 1;
            console.error(`  "${payload.title}" failed: ${rowError.message}`);
          } else {
            inserted += 1;
            if (firstInsertedTitles.length < 2) {
              firstInsertedTitles.push(payload.title);
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
        "\nAborting: every insert in the first batch failed. Check the service role key and that wikidata_id has a unique constraint.",
      );
      process.exitCode = 1;
      break;
    }
  }

  console.log("\n-------- Ingestion summary --------");
  console.log(`Total rows in CSV: ${rows.length}`);
  console.log(`Inserted: ${inserted}`);
  console.log(`Skipped (empty title): ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(
    `First inserted titles: ${firstInsertedTitles.length > 0 ? firstInsertedTitles.join(", ") : "(none)"}`,
  );
}

main();
