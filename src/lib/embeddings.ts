import { pipeline, env, type FeatureExtractionPipeline } from "@xenova/transformers";

// Vercel's serverless runtime lacks libonnxruntime.so. Force the WASM backend
// before any pipeline is created so the native binary is never requested.
env.backends.setPriority(["wasm", "cpu"]);
env.backends.onnx.wasm.numThreads = 1;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

// The pipeline loads the model on first use, so create it once and reuse it.
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_ID, { device: "cpu" });
  }

  return extractorPromise;
}

/**
 * Turns a piece of text into a 384-dimensional embedding vector using a local
 * MiniLM model (no API calls).
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });

  return Array.from(output.data);
}