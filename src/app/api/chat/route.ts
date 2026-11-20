import { retrieveDestinations, type DestinationMatch } from "@/lib/rag";

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

function buildContext(destinations: DestinationMatch[]): string {
  if (destinations.length === 0) {
    return "No destination context available.";
  }

  return destinations
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

  let destinations: DestinationMatch[];

  try {
    destinations = await retrieveDestinations(question.trim(), 5);
  } catch (error) {
    return Response.json(
      {
        error: "Failed to retrieve destinations.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }

  const context = buildContext(destinations);

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
    sources: destinations.map((destination) => ({
      title: destination.title,
      similarity: destination.similarity,
    })),
  });
}
