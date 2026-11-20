import { getQueryEmbedding } from "./embeddings";
import { supabase } from "./supabase";

export type MovieMatch = {
  id: number;
  title: string;
  metadata: Record<string, unknown>;
  similarity: number;
};

/**
 * Embeds the natural-language query and returns the closest movies from
 * Supabase via the match_movies RPC.
 */
const SIMILARITY_THRESHOLD = 0.5;

export async function retrieveMovies(query: string, matchCount = 5): Promise<MovieMatch[]> {
  const embedding = await getQueryEmbedding(query);

  // Over-fetch so that weak matches and duplicate titles can be dropped
  // without returning fewer than matchCount when possible.
  const { data, error } = await supabase.rpc("match_movies", {
    query_embedding: embedding,
    match_count: matchCount * 2,
  });

  if (error) {
    throw new Error(`match_movies RPC failed: ${error.message}`);
  }

  const matches = (data ?? []) as MovieMatch[];
  const seenTitles = new Set<string>();
  const results: MovieMatch[] = [];

  for (const match of matches) {
    if (match.similarity < SIMILARITY_THRESHOLD) {
      continue;
    }

    const titleKey = match.title.trim().toLowerCase();

    if (seenTitles.has(titleKey)) {
      continue;
    }

    seenTitles.add(titleKey);
    results.push(match);

    if (results.length === matchCount) {
      break;
    }
  }

  return results;
}
