import { readFileSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const CSV_PATH = path.join(process.cwd(), "archive", "indian_cinema_dataset.csv");
const ROWS_TO_READ = 5;
const ROWS_TO_PRINT = 2;

function main() {
  let csv: string;

  try {
    csv = readFileSync(CSV_PATH, "utf8");
  } catch {
    console.error(`Could not read ${CSV_PATH}`);
    console.error("Run this from the project root and make sure archive/ is there.");
    process.exitCode = 1;
    return;
  }

  const { data, errors, meta } = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    preview: ROWS_TO_READ + 5, // room for the header row and blank lines
  });

  if (errors.length > 0) {
    console.warn("Parse warnings:");
    for (const error of errors.slice(0, 5)) {
      console.warn(`  row ${error.row ?? "?"}: ${error.message}`);
    }
  }

  const rows = data.slice(0, ROWS_TO_READ);

  console.log(`File: ${CSV_PATH}`);
  console.log(`Rows read: ${rows.length}\n`);

  console.log("Columns:");
  (meta.fields ?? []).forEach((field, index) => {
    console.log(`  ${index + 1}. ${field}`);
  });
  console.log(`Total columns: ${meta.fields?.length ?? 0}\n`);

  console.log(`First ${ROWS_TO_PRINT} rows:`);
  rows.slice(0, ROWS_TO_PRINT).forEach((row, index) => {
    console.log(`\n--- Row ${index + 1} ---`);
    console.log(JSON.stringify(row, null, 2));
  });
}

main();
