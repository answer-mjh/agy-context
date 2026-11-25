/**
 * Model context window limits and per-1M token pricing (USD).
 * Reference rates based on public provider pricing / models.dev conventions.
 */

const MODEL_SPECS = [
  // Gemini 4 / Next / Neon family
  {
    match: /gemini[-_ ]?4.*flash/i,
    label: 'Gemini 4 Flash',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    inputPerM: 0.30,
    cacheReadPerM: 0.03,
    outputPerM: 2.50,
  },
  {
    match: /gemini[-_ ]?4/i,
    label: 'Gemini 4',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    inputPerM: 1.50,
    cacheReadPerM: 0.15,
    outputPerM: 12.00,
  },
  // Gemini 3 family
  {
    match: /gemini[-_ ]?3.*flash/i,
    label: 'Gemini 3 Flash',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    inputPerM: 0.30,
    cacheReadPerM: 0.03,
    outputPerM: 2.50,
  },
  {
    match: /gemini[-_ ]?3/i,
    label: 'Gemini 3 Pro',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    inputPerM: 1.25,
    cacheReadPerM: 0.125,
    outputPerM: 10.00,
  },
  // Gemini 2.5 family
  {
    match: /gemini[-_ ]?2\.5[-_ ]?flash[-_ ]?lite/i,
    label: 'Gemini 2.5 Flash Lite',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    inputPerM: 0.10,
    cacheReadPerM: 0.01,
    outputPerM: 0.40,
  },
  {
    match: /gemini[-_ ]?2\.5[-_ ]?flash/i,
    label: 'Gemini 2.5 Flash',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    inputPerM: 0.30,
    cacheReadPerM: 0.03,
    outputPerM: 2.50,
  },
  {
    match: /gemini[-_ ]?2\.5[-_ ]?pro/i,
    label: 'Gemini 2.5 Pro',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    inputPerM: 1.25,
    cacheReadPerM: 0.125,
    outputPerM: 10.00,
  },
  // Claude 4 / 3.7 / 3.5 family
  {
    match: /claude.*opus/i,
    label: 'Claude Opus',
    contextWindow: 200_000,
    maxOutput: 32_768,
    inputPerM: 15.00,
    cacheReadPerM: 1.50,
    outputPerM: 75.00,
  },
  {
    match: /claude.*sonnet/i,
    label: 'Claude Sonnet',
    contextWindow: 200_000,
    maxOutput: 64_000,
    inputPerM: 3.00,
    cacheReadPerM: 0.30,
    outputPerM: 15.00,
  },
  {
    match: /claude.*haiku/i,
    label: 'Claude Haiku',
    contextWindow: 200_000,
    maxOutput: 16_384,
    inputPerM: 0.80,
    cacheReadPerM: 0.08,
    outputPerM: 4.00,
  },
  // OpenAI GPT / o-series
  {
    match: /gpt[-_ ]?5|o3|o4/i,
    label: 'OpenAI Frontier',
    contextWindow: 400_000,
    maxOutput: 65_536,
    inputPerM: 2.00,
    cacheReadPerM: 0.20,
    outputPerM: 10.00,
  },
  {
    match: /gpt[-_ ]?4o/i,
    label: 'GPT-4o',
    contextWindow: 128_000,
    maxOutput: 16_384,
    inputPerM: 2.50,
    cacheReadPerM: 1.25,
    outputPerM: 10.00,
  },
  // DeepSeek
  {
    match: /deepseek/i,
    label: 'DeepSeek',
    contextWindow: 128_000,
    maxOutput: 8_192,
    inputPerM: 0.27,
    cacheReadPerM: 0.07,
    outputPerM: 1.10,
  },
];

const DEFAULT_SPEC = {
  label: 'Antigravity Model',
  contextWindow: 1_000_000,
  maxOutput: 65_536,
  inputPerM: 1.25,
  cacheReadPerM: 0.125,
  outputPerM: 10.00,
  isFallback: true,
};

export function getModelSpec(modelId) {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  if (!id) {
    return { ...DEFAULT_SPEC, id: 'unknown' };
  }
  for (const spec of MODEL_SPECS) {
    if (spec.match.test(id)) {
      return {
        id,
        label: spec.label,
        contextWindow: spec.contextWindow,
        maxOutput: spec.maxOutput,
        inputPerM: spec.inputPerM,
        cacheReadPerM: spec.cacheReadPerM,
        outputPerM: spec.outputPerM,
        isFallback: false,
      };
    }
  }
  return { ...DEFAULT_SPEC, id, label: id };
}

/**
 * Compute estimated USD cost for a step.
 * In Antigravity transcripts, `input_tokens` is uncached input,
 * `cache_read_tokens` is cached input, and `output_tokens` is completion output.
 */
export function estimateStepCost(modelId, inputTokens = 0, cacheReadTokens = 0, outputTokens = 0) {
  const spec = getModelSpec(modelId);
  const uncachedIn = Math.max(0, Number(inputTokens) || 0);
  const cachedIn = Math.max(0, Number(cacheReadTokens) || 0);
  const out = Math.max(0, Number(outputTokens) || 0);
  const cost =
    (uncachedIn / 1_000_000) * spec.inputPerM +
    (cachedIn / 1_000_000) * spec.cacheReadPerM +
    (out / 1_000_000) * spec.outputPerM;
  return {
    cost,
    spec,
  };
}
