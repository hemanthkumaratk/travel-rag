import { retrieveMovies, type MovieMatch } from "@/lib/rag";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT =
  "You are a helpful Indian cinema assistant. Answer using ONLY the movie context provided.\n" +
  "Rules:\n" +
  "- Give a medium-length answer: 3 to 5 sentences. Be informative but not verbose.\n" +
  "- If the context contains movies relevant to the question, recommend 1-2 and describe them (title, year, genre, director, cast if available).\n" +
  "- If the context does NOT contain enough information to answer (e.g., the user asks about an actor/genre not in the data), respond with: 'I couldn't find that in the dataset. The Indian cinema data I have doesn't include [the specific thing].' Then, suggest 2-3 popular actors, directors, or genres that DO appear in the provided context, as alternatives the user could ask about.\n" +
  "- Never invent movies, actors, or facts not in the context.";

function metadataField(metadata: Record<string, unknown>, key: string): string {
  const value = metadata?.[key];

  if (value === null || value === undefined) {
    return "";
  }

  return typeof value === "string" ? value.trim() : String(value);
}

function buildContext(movies: MovieMatch[]): string {
  if (movies.length === 0) {
    return "No movie context available.";
  }

  return movies
    .map((movie, index) => {
      const metadata = movie.metadata ?? {};
      const year = metadataField(metadata, "year");
      const lines = [`${index + 1}. ${movie.title}${year ? ` (${year})` : ""}`];

      const fields: Array<[string, string]> = [
        ["Genres", metadataField(metadata, "genres")],
        ["Director", metadataField(metadata, "directors")],
        ["Cast", metadataField(metadata, "cast")],
        ["Language", metadataField(metadata, "languages")],
      ];

      for (const [label, value] of fields) {
        if (value) {
          lines.push(`   ${label}: ${value}`);
        }
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const question =
    typeof body === "object" && body !== null
      ? (body as { question?: unknown }).question
      : undefined;

  if (typeof question !== "string" || question.trim().length === 0) {
    return Response.json(
      { error: "A non-empty 'question' string is required." },
      { status: 400 },
    );
  }

  const groqApiKey = process.env.GROQ_API_KEY;

  if (!groqApiKey) {
    return Response.json({ error: "GROQ_API_KEY is not configured." }, { status: 500 });
  }

  let movies: MovieMatch[];

  try {
    movies = await retrieveMovies(question.trim(), 5);
  } catch (error) {
    return Response.json(
      {
        error: "Failed to retrieve movies.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }

  const context = buildContext(movies);

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
            content: `Context:\n${context}\n\nQuestion: ${question.trim()}`,
          },
        ],
      }),
    });
  } catch (error) {
    return Response.json(
      {
        error: "Failed to reach Groq.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }

  if (!groqResponse.ok) {
    const errorBody = await groqResponse.text();

    return Response.json(
      {
        error: `Groq request failed with status ${groqResponse.status}.`,
        details: errorBody,
      },
      { status: 502 },
    );
  }

  const completion = (await groqResponse.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const answer = completion.choices?.[0]?.message?.content;

  if (!answer) {
    return Response.json(
      { error: "Groq returned an empty answer.", details: completion },
      { status: 502 },
    );
  }

  return Response.json({
    answer,
    sources: movies.map((movie) => ({
      title: movie.title,
      similarity: movie.similarity,
    })),
  });
}
