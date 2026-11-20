import { GoogleGenAI } from "@google/genai";

const MODEL_ID = "gemini-embedding-001";
const EMBEDDING_DIMENSION = 768;

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add GEMINI_API_KEY to .env.local (or to the Vercel project env vars).",
    );
  }

  if (!client) {
    client = new GoogleGenAI({ apiKey });
  }

  return client;
}

/** The SDK reports HTTP failures as a JSON string; surface the readable part. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  try {
    const parsed = JSON.parse(message) as { error?: { message?: string; status?: string } };
    if (parsed.error?.message) {
      return `${parsed.error.message}${parsed.error.status ? ` (${parsed.error.status})` : ""}`;
    }
  } catch {
    // Not JSON: keep the original message.
  }

  return message;
}

async function embed(text: string, taskType: TaskType): Promise<number[]> {
  if (!text.trim()) {
    throw new Error("Cannot embed empty text.");
  }

  // Resolved outside the try so a missing key is reported as-is, not wrapped.
  const ai = getClient();

  let values: number[] | undefined;

  try {
    const response = await ai.models.embedContent({
      model: MODEL_ID,
      contents: text,
      config: {
        taskType,
        outputDimensionality: EMBEDDING_DIMENSION,
      },
    });

    values = response.embeddings?.[0]?.values;
  } catch (error) {
    throw new Error(`Gemini embedding request (${taskType}) failed: ${describeError(error)}`);
  }

  if (!values || values.length === 0) {
    throw new Error("Gemini returned no embedding values.");
  }

  if (values.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Gemini returned a ${values.length}-dimensional embedding, expected ${EMBEDDING_DIMENSION}. ` +
        `The movies.embedding column must be vector(${EMBEDDING_DIMENSION}).`,
    );
  }

  return values;
}

/** Embedding for a stored document (movies.embedding). */
export function getEmbedding(text: string): Promise<number[]> {
  return embed(text, "RETRIEVAL_DOCUMENT");
}

/** Embedding for a user query; must match the dimension of getEmbedding. */
export function getQueryEmbedding(text: string): Promise<number[]> {
  return embed(text, "RETRIEVAL_QUERY");
}
