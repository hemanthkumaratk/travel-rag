import { getQueryEmbedding } from "./embeddings";
import { supabase } from "./supabase";

export type DestinationMatch = {
  id: number;
  title: string;
  metadata: Record<string, unknown>;
  similarity: number;
};

/** Shape returned by the match_destinations RPC. */
type DestinationRow = {
  id: number;
  title?: string | null;
  destination?: string | null;
  metadata?: Record<string, unknown> | null;
  similarity: number;
};

/**
 * Embeds the natural-language query and returns the closest destinations from
 * Supabase via the match_destinations RPC.
 */
const SIMILARITY_THRESHOLD = 0.5;

function displayTitle(row: DestinationRow): string {
  const metadataDestination = row.metadata?.destination;

  if (typeof metadataDestination === "string" && metadataDestination.trim()) {
    return metadataDestination.trim();
  }

  return (row.title ?? row.destination ?? "").trim();
}

export async function retrieveDestinations(
  query: string,
  matchCount = 5,
): Promise<DestinationMatch[]> {
  const embedding = await getQueryEmbedding(query);

  // Over-fetch so that weak matches and duplicate destinations can be dropped
  // without returning fewer than matchCount when possible.
  const { data, error } = await supabase.rpc("match_destinations", {
    query_embedding: embedding,
    match_count: matchCount * 2,
  });

  if (error) {
    throw new Error(`match_destinations RPC failed: ${error.message}`);
  }

  const matches = (data ?? []) as DestinationRow[];
  const seenTitles = new Set<string>();
  const results: DestinationMatch[] = [];

  for (const match of matches) {
    if (match.similarity < SIMILARITY_THRESHOLD) {
      continue;
    }

    const title = displayTitle(match);
    const titleKey = title.toLowerCase();

    if (!titleKey || seenTitles.has(titleKey)) {
      continue;
    }

    seenTitles.add(titleKey);
    results.push({
      id: match.id,
      title,
      metadata: match.metadata ?? {},
      similarity: match.similarity,
    });

    if (results.length === matchCount) {
      break;
    }
  }

  return results;
}
