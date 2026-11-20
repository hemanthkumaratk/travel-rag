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
  "Recommend a beach destination in Kerala",
  "Tell me about a heritage place in Rajasthan",
];

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b";
const SYSTEM_PROMPT =
  "You are a helpful India travel assistant. Answer using ONLY the destination context provided.\n" +
  "Rules:\n" +
  "- Give a medium-length answer: 3 to 5 sentences. Be informative but not verbose.\n" +
  "- If the context contains destinations relevant to the question, recommend 1-2 and describe them (destination, state, type, attractions, best season if available).\n" +
  "- If the context does NOT contain enough information to answer (e.g., the user asks about a state, trip type, or season not in the data), respond with: 'I couldn't find that in the dataset. The India travel data I have doesn't include [the specific thing].' Then, suggest 2-3 destinations, states, or destination types that DO appear in the provided context, as alternatives the user could ask about.\n" +
  "- Never invent destinations, attractions, or facts not in the context.";

function metadataField(metadata: Record<string, unknown>, key: string): string {
  const value = metadata?.[key];

  if (value === null || value === undefined) {
    return "";
  }

  return typeof value === "string" ? value.trim() : String(value);
}

async function main() {
  const { retrieveDestinations } = await import("@/lib/rag");

  const groqApiKey = process.env.GROQ_API_KEY;

  if (!groqApiKey) {
    console.error("GROQ_API_KEY is not set in .env.local.");
    process.exitCode = 1;
    return;
  }

  for (const question of QUERIES) {
    console.log(`\n========== Question: "${question}" ==========\n`);

    let destinations;

    try {
      destinations = await retrieveDestinations(question, 5);
    } catch (error) {
      console.error("Retrieval failed:");
      console.error(error);
      process.exitCode = 1;
      return;
    }

    console.log(`Retrieved ${destinations.length} destinations:`);

    if (destinations.length === 0) {
      console.log("  (no results)");
    }

    destinations.forEach((destination, index) => {
      console.log(
        `  ${index + 1}. ${destination.title} — similarity ${destination.similarity.toFixed(3)}`,
      );
    });

    const context =
      destinations.length === 0
        ? "No destination context available."
        : destinations
            .map((destination, index) => {
              const metadata = destination.metadata ?? {};
              const lines = [`${index + 1}. ${destination.title}`];

              const fields: Array<[string, string]> = [
                ["State", metadataField(metadata, "state_or_union_territory")],
                ["Type", metadataField(metadata, "destination_type")],
                ["Attractions", metadataField(metadata, "major_attractions")],
                ["Best season", metadataField(metadata, "recommended_visit_season")],
                ["Description", metadataField(metadata, "destination_description")],
                ["Tips", metadataField(metadata, "travel_tips")],
              ];

              for (const [label, value] of fields) {
                if (value) {
                  lines.push(`   ${label}: ${value}`);
                }
              }

              return lines.join("\n");
            })
            .join("\n\n");

    let groqResponse: Response;

    try {
      groqResponse = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.3,
          max_tokens: 400,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Context:\n${context}\n\nQuestion: ${question}`,
            },
          ],
        }),
      });
    } catch (error) {
      console.error("Failed to reach Groq:");
      console.error(error);
      process.exitCode = 1;
      return;
    }

    if (!groqResponse.ok) {
      console.error(`Groq request failed with status ${groqResponse.status}:`);
      console.error(await groqResponse.text());
      process.exitCode = 1;
      return;
    }

    const completion = (await groqResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const answer = completion.choices?.[0]?.message?.content;

    if (!answer) {
      console.error("Groq returned no answer:");
      console.error(JSON.stringify(completion, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log("\nGroq answer:");
    console.log(answer);
  }
}

main();
