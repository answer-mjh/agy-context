/**
 * Model directory, localized effort display names, context window limits,
 * quota pools, and verified dated pricing (USD per 1M tokens).
 * Aligned with antigravity-context-monitor rates and catalog mappings.
 */

const CARBON_RATE_CHANGE = Date.parse('2026-12-01T00:00:00Z');
const ARGON_RATE_CHANGE = Date.parse('2026-12-01T00:00:00Z');
const FLASH_RATE_CHANGE = Date.parse('2027-01-01T00:00:00Z');
const FLASH36_PROMO_START = Date.parse('2026-08-13T00:00:00Z');

const FAMILY_SPECS = {
  'gemini-4-neon': {
    baseLabel: 'Gemini 4 Neon',
    quotaPool: 'gemini',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    pricing: () => ({ inputPerM: 3.00, outputPerM: 15.00, cacheReadPerM: 0.15 }),
  },
  'gemini-4-hydrogen': {
    baseLabel: 'Gemini 4 Hydrogen',
    quotaPool: 'gemini',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    pricing: () => ({ inputPerM: 1.50, outputPerM: 7.50, cacheReadPerM: 0.075 }),
  },
  'gemini-4-carbon': {
    baseLabel: 'Gemini 4 Carbon',
    quotaPool: 'gemini',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    pricing: (atMs) => (atMs < CARBON_RATE_CHANGE
      ? { inputPerM: 2.00, outputPerM: 10.00, cacheReadPerM: 0.10 }
      : { inputPerM: 4.00, outputPerM: 20.00, cacheReadPerM: 0.20 }),
  },
  'gemini-4-argon': {
    baseLabel: 'Gemini 4 Argon',
    quotaPool: 'gemini',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    pricing: (atMs) => (atMs < ARGON_RATE_CHANGE
      ? { inputPerM: 2.00, outputPerM: 10.00, cacheReadPerM: 0.10 }
      : { inputPerM: 4.00, outputPerM: 20.00, cacheReadPerM: 0.20 }),
  },
  'claude-opus-5-5': {
    baseLabel: 'Claude Opus 5.5',
    quotaPool: 'premium',
    contextWindow: 200_000,
    maxOutput: 32_768,
    pricing: () => ({ inputPerM: 4.00, outputPerM: 20.00, cacheReadPerM: 0.20 }),
  },
  'claude-sonnet-5-5': {
    baseLabel: 'Claude Sonnet 5.5',
    quotaPool: 'premium',
    contextWindow: 200_000,
    maxOutput: 64_000,
    pricing: () => ({ inputPerM: 2.00, outputPerM: 10.00, cacheReadPerM: 0.10 }),
  },
  'claude-opus-4-6': {
    baseLabel: 'Claude Opus 4.6',
    quotaPool: 'premium',
    contextWindow: 200_000,
    maxOutput: 32_768,
    pricing: () => ({ inputPerM: 5.00, outputPerM: 25.00, cacheReadPerM: 0.50 }),
  },
  'claude-sonnet-4-6': {
    baseLabel: 'Claude Sonnet 4.6',
    quotaPool: 'premium',
    contextWindow: 200_000,
    maxOutput: 64_000,
    pricing: () => ({ inputPerM: 3.00, outputPerM: 15.00, cacheReadPerM: 0.30 }),
  },
  'claude-haiku': {
    baseLabel: 'Claude Haiku',
    quotaPool: 'premium',
    contextWindow: 200_000,
    maxOutput: 16_384,
    pricing: () => ({ inputPerM: 0.80, outputPerM: 4.00, cacheReadPerM: 0.08 }),
  },
  'gemini-3.8-flash': {
    baseLabel: 'Gemini 3.8 Flash',
    quotaPool: 'gemini',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    pricing: (atMs) => (atMs < FLASH_RATE_CHANGE
      ? { inputPerM: 0.75, outputPerM: 3.75, cacheReadPerM: 0.075 }
      : { inputPerM: 1.50, outputPerM: 7.50, cacheReadPerM: 0.15 }),
  },
  'gemini-3.7-flash': {
    baseLabel: 'Gemini 3.7 Flash',
    quotaPool: 'gemini',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    pricing: (atMs) => (atMs < FLASH_RATE_CHANGE
      ? { inputPerM: 0.75, outputPerM: 3.75, cacheReadPerM: 0.075 }
      : { inputPerM: 1.50, outputPerM: 7.50, cacheReadPerM: 0.15 }),
  },
  'gemini-3.6-flash': {
    baseLabel: 'Gemini 3.6 Flash',
    quotaPool: 'gemini',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    pricing: (atMs) => (atMs >= FLASH36_PROMO_START && atMs < FLASH_RATE_CHANGE
      ? { inputPerM: 0.75, outputPerM: 3.75, cacheReadPerM: 0.075 }
      : { inputPerM: 1.50, outputPerM: 7.50, cacheReadPerM: 0.15 }),
  },
  'gemini-3.5-flash': {
    baseLabel: 'Gemini 3.5 Flash',
    quotaPool: 'gemini',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    pricing: () => ({ inputPerM: 1.50, outputPerM: 9.00, cacheReadPerM: 0.15 }),
  },
  'gemini-3.1-pro': {
    baseLabel: 'Gemini 3.1 Pro',
    quotaPool: 'gemini',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    pricing: () => ({ inputPerM: 2.00, outputPerM: 12.00, cacheReadPerM: 0.20 }),
  },
  'gemini-3.1-flash-image': {
    baseLabel: 'Gemini 3.1 Flash Image',
    quotaPool: 'gemini',
    contextWindow: 1_000_000,
    maxOutput: 32_768,
    pricing: () => ({ inputPerM: 0.50, outputPerM: 3.00, cacheReadPerM: 0.05 }),
  },
  'gemini-3-flash': {
    baseLabel: 'Gemini 3 Flash',
    quotaPool: 'gemini',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    pricing: () => ({ inputPerM: 0.50, outputPerM: 3.00, cacheReadPerM: 0.05 }),
  },
  'gemini-2.5-flash-lite': {
    baseLabel: 'Gemini 2.5 Flash Lite',
    quotaPool: 'gemini',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    pricing: () => ({ inputPerM: 0.10, outputPerM: 0.40, cacheReadPerM: 0.01 }),
  },
  'gemini-2.5-flash': {
    baseLabel: 'Gemini 2.5 Flash',
    quotaPool: 'gemini',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    pricing: () => ({ inputPerM: 0.30, outputPerM: 2.50, cacheReadPerM: 0.03 }),
  },
  'gemini-2.5-pro': {
    baseLabel: 'Gemini 2.5 Pro',
    quotaPool: 'gemini',
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    pricing: () => ({ inputPerM: 1.25, outputPerM: 10.00, cacheReadPerM: 0.125 }),
  },
  'gpt-oss-120b': {
    baseLabel: 'GPT-OSS 120B',
    quotaPool: 'premium',
    contextWindow: 128_000,
    maxOutput: 16_384,
    pricing: () => ({ inputPerM: 0.09, outputPerM: 0.36, cacheReadPerM: 0 }),
  },
  'openai-frontier': {
    baseLabel: 'OpenAI Frontier',
    quotaPool: 'premium',
    contextWindow: 400_000,
    maxOutput: 65_536,
    pricing: () => ({ inputPerM: 2.00, outputPerM: 10.00, cacheReadPerM: 0.20 }),
  },
  'gpt-4o': {
    baseLabel: 'GPT-4o',
    quotaPool: 'premium',
    contextWindow: 128_000,
    maxOutput: 16_384,
    pricing: () => ({ inputPerM: 2.50, outputPerM: 10.00, cacheReadPerM: 1.25 }),
  },
  deepseek: {
    baseLabel: 'DeepSeek',
    quotaPool: 'other',
    contextWindow: 128_000,
    maxOutput: 8_192,
    pricing: () => ({ inputPerM: 0.27, outputPerM: 1.10, cacheReadPerM: 0.07 }),
  },
};

const EFFORT_LABELS = {
  low: { en: 'Low', zh: '低' },
  medium: { en: 'Medium', zh: '中' },
  high: { en: 'High', zh: '高' },
  xhigh: { en: 'XHigh', zh: '超高' },
  thinking: { en: 'Thinking', zh: '思考' },
  tiered: { en: 'Tiered', zh: '分级' },
  'tiered-high': { en: 'Tiered High', zh: '分级高' },
  'tiered-xhigh': { en: 'Tiered XHigh', zh: '分级超高' },
};

// Exact Antigravity placeholder catalog IDs -> family, effort, and optional custom title
const CATALOG_MODELS = {
  MODEL_PLACEHOLDER_M532: { family: 'gemini-4-neon', effort: 'high' },
  MODEL_PLACEHOLDER_M533: { family: 'gemini-4-neon', effort: 'medium' },
  MODEL_PLACEHOLDER_M534: { family: 'gemini-4-neon', effort: 'low' },
  MODEL_PLACEHOLDER_M535: { family: 'gemini-4-neon', effort: 'xhigh' },
  MODEL_PLACEHOLDER_M537: {
    family: 'gemini-4-neon',
    effort: '',
    labelEn: 'Orchestrator (Neon)',
    labelZh: 'Orchestrator (Neon)',
    provenance: 'mapped_base',
  },
  MODEL_PLACEHOLDER_M525: { family: 'gemini-4-hydrogen', effort: 'high' },
  MODEL_PLACEHOLDER_M526: { family: 'gemini-4-hydrogen', effort: 'medium' },
  MODEL_PLACEHOLDER_M527: { family: 'gemini-4-hydrogen', effort: 'low' },
  MODEL_PLACEHOLDER_M528: { family: 'gemini-4-hydrogen', effort: 'xhigh' },
  MODEL_PLACEHOLDER_M530: { family: 'gemini-4-hydrogen', effort: 'tiered-high' },
  MODEL_PLACEHOLDER_M531: { family: 'gemini-4-hydrogen', effort: 'tiered-xhigh' },
  MODEL_PLACEHOLDER_M578: {
    family: 'gemini-4-hydrogen',
    effort: '',
    labelEn: 'Gemini 4 Hydrogen (Sonar)',
    labelZh: 'Gemini 4 Hydrogen (Sonar)',
  },
  MODEL_PLACEHOLDER_M669: {
    family: 'gemini-4-hydrogen',
    effort: '',
    labelEn: 'Gemini 4 Hydrogen (Orchestrator)',
    labelZh: 'Gemini 4 Hydrogen (Orchestrator)',
    provenance: 'mapped_base',
  },
  MODEL_PLACEHOLDER_M427: { family: 'gemini-4-carbon', effort: 'high' },
  MODEL_PLACEHOLDER_M437: { family: 'gemini-4-carbon', effort: 'medium' },
  MODEL_PLACEHOLDER_M438: { family: 'gemini-4-carbon', effort: 'low' },
  MODEL_PLACEHOLDER_M667: {
    family: 'gemini-4-carbon',
    effort: '',
    labelEn: 'Orchestrator (Carbon)',
    labelZh: 'Orchestrator (Carbon)',
    provenance: 'mapped_base',
  },
  MODEL_PLACEHOLDER_M417: { family: 'gemini-4-argon', effort: 'high' },
  MODEL_PLACEHOLDER_M418: { family: 'gemini-4-argon', effort: 'medium' },
  MODEL_PLACEHOLDER_M419: { family: 'gemini-4-argon', effort: 'low' },
  MODEL_PLACEHOLDER_M681: {
    family: 'gemini-4-argon',
    effort: '',
    labelEn: 'Orchestrator (Argon)',
    labelZh: 'Orchestrator (Argon)',
    provenance: 'mapped_base',
  },
  MODEL_PLACEHOLDER_M400: { family: 'claude-opus-5-5', effort: 'low' },
  MODEL_PLACEHOLDER_M401: { family: 'claude-opus-5-5', effort: 'medium' },
  MODEL_PLACEHOLDER_M402: { family: 'claude-opus-5-5', effort: 'high' },
  MODEL_PLACEHOLDER_M403: { family: 'claude-sonnet-5-5', effort: 'low' },
  MODEL_PLACEHOLDER_M404: { family: 'claude-sonnet-5-5', effort: 'medium' },
  MODEL_PLACEHOLDER_M405: { family: 'claude-sonnet-5-5', effort: 'high' },
  MODEL_PLACEHOLDER_M26: { family: 'claude-opus-4-6', effort: 'thinking' },
  MODEL_PLACEHOLDER_M35: { family: 'claude-sonnet-4-6', effort: 'thinking' },
  MODEL_PLACEHOLDER_M318: { family: 'gemini-3.8-flash', effort: 'high' },
  MODEL_PLACEHOLDER_M319: { family: 'gemini-3.8-flash', effort: 'medium' },
  MODEL_PLACEHOLDER_M320: { family: 'gemini-3.8-flash', effort: 'low' },
  MODEL_PLACEHOLDER_M322: { family: 'gemini-3.8-flash', effort: 'tiered' },
  MODEL_PLACEHOLDER_M298: { family: 'gemini-3.7-flash', effort: 'high' },
  MODEL_PLACEHOLDER_M299: { family: 'gemini-3.7-flash', effort: 'medium' },
  MODEL_PLACEHOLDER_M300: { family: 'gemini-3.7-flash', effort: 'low' },
  MODEL_PLACEHOLDER_M71: { family: 'gemini-3.6-flash', effort: 'high' },
  MODEL_PLACEHOLDER_M72: { family: 'gemini-3.6-flash', effort: 'medium' },
  MODEL_PLACEHOLDER_M73: { family: 'gemini-3.6-flash', effort: 'low' },
  MODEL_PLACEHOLDER_M264: { family: 'gemini-3.6-flash', effort: 'high' },
  MODEL_PLACEHOLDER_M265: { family: 'gemini-3.6-flash', effort: 'medium' },
  MODEL_PLACEHOLDER_M266: { family: 'gemini-3.6-flash', effort: 'low' },
  MODEL_PLACEHOLDER_M196: { family: 'gemini-3.6-flash', effort: 'tiered' },
  MODEL_PLACEHOLDER_M84: { family: 'gemini-3.5-flash', effort: 'high' },
  MODEL_PLACEHOLDER_M20: { family: 'gemini-3.5-flash', effort: 'medium' },
  MODEL_PLACEHOLDER_M187: { family: 'gemini-3.5-flash', effort: 'low' },
  MODEL_PLACEHOLDER_M133: { family: 'gemini-3.5-flash', effort: 'high' },
  MODEL_PLACEHOLDER_M132: { family: 'gemini-3.5-flash', effort: 'high' },
  MODEL_PLACEHOLDER_M16: { family: 'gemini-3.1-pro', effort: 'high' },
  MODEL_PLACEHOLDER_M37: { family: 'gemini-3.1-pro', effort: 'high' },
  MODEL_PLACEHOLDER_M36: { family: 'gemini-3.1-pro', effort: 'low' },
  MODEL_PLACEHOLDER_M18: { family: 'gemini-3-flash', effort: '' },
  MODEL_PLACEHOLDER_M47: { family: 'gemini-3-flash', effort: '' },
  MODEL_PLACEHOLDER_M21: { family: 'gemini-3.1-flash-image', effort: '' },
  MODEL_OPENAI_GPT_OSS_120B_MEDIUM: { family: 'gpt-oss-120b', effort: 'medium' },
};

// Canonical active alias map (response slugs + retired IDs -> active placeholder ID)
const SLUG_TO_CATALOG_ID = {
  'gemini-pro-orchestrator-neon': 'MODEL_PLACEHOLDER_M537',
  'gemini-pro-orchestrator': 'MODEL_PLACEHOLDER_M667',
  'gemini-pro-orchestrator-argon': 'MODEL_PLACEHOLDER_M681',
  'gemini-flash-worker-agy': 'MODEL_PLACEHOLDER_M669',
  'orchestrator-neon': 'MODEL_PLACEHOLDER_M537',
  'orchestrator-carbon': 'MODEL_PLACEHOLDER_M667',
  'orchestrator-argon': 'MODEL_PLACEHOLDER_M681',
  'gemini-4-neon-high': 'MODEL_PLACEHOLDER_M532',
  'gemini-4-neon-medium': 'MODEL_PLACEHOLDER_M533',
  'gemini-4-neon-low': 'MODEL_PLACEHOLDER_M534',
  'gemini-4-neon-xhigh': 'MODEL_PLACEHOLDER_M535',
  'gemini-4-hydrogen-high': 'MODEL_PLACEHOLDER_M525',
  'gemini-4-hydrogen-medium': 'MODEL_PLACEHOLDER_M526',
  'gemini-4-hydrogen-low': 'MODEL_PLACEHOLDER_M527',
  'gemini-4-hydrogen-xhigh': 'MODEL_PLACEHOLDER_M528',
  'gemini-4-hydrogen-tiered-high': 'MODEL_PLACEHOLDER_M530',
  'gemini-4-hydrogen-tiered-xhigh': 'MODEL_PLACEHOLDER_M531',
  'gemini-4-hydrogen-sonar': 'MODEL_PLACEHOLDER_M578',
  'gemini-4-hydrogen-orchestrator': 'MODEL_PLACEHOLDER_M669',
  'gemini-4-carbon-high': 'MODEL_PLACEHOLDER_M427',
  'gemini-4-carbon-medium': 'MODEL_PLACEHOLDER_M437',
  'gemini-4-carbon-low': 'MODEL_PLACEHOLDER_M438',
  'gemini-4-argon-high': 'MODEL_PLACEHOLDER_M417',
  'gemini-4-argon-medium': 'MODEL_PLACEHOLDER_M418',
  'gemini-4-argon-low': 'MODEL_PLACEHOLDER_M419',
  'claude-opus-5-5-low': 'MODEL_PLACEHOLDER_M400',
  'claude-opus-5-5-medium': 'MODEL_PLACEHOLDER_M401',
  'claude-opus-5-5-high': 'MODEL_PLACEHOLDER_M402',
  'claude-sonnet-5-5-low': 'MODEL_PLACEHOLDER_M403',
  'claude-sonnet-5-5-medium': 'MODEL_PLACEHOLDER_M404',
  'claude-sonnet-5-5-high': 'MODEL_PLACEHOLDER_M405',
  'claude-opus-4-6-thinking': 'MODEL_PLACEHOLDER_M26',
  'claude-sonnet-4-6-thinking': 'MODEL_PLACEHOLDER_M35',
  'claude-sonnet-4-6': 'MODEL_PLACEHOLDER_M35',
  'gemini-3.8-flash-high': 'MODEL_PLACEHOLDER_M318',
  'gemini-3.8-flash-medium': 'MODEL_PLACEHOLDER_M319',
  'gemini-3.8-flash-low': 'MODEL_PLACEHOLDER_M320',
  'gemini-3.8-flash-tiered': 'MODEL_PLACEHOLDER_M322',
  'gemini-3.7-flash-high': 'MODEL_PLACEHOLDER_M298',
  'gemini-3.7-flash-medium': 'MODEL_PLACEHOLDER_M299',
  'gemini-3.7-flash-low': 'MODEL_PLACEHOLDER_M300',
  'gemini-3.6-flash-high': 'MODEL_PLACEHOLDER_M71',
  'gemini-3.6-flash-medium': 'MODEL_PLACEHOLDER_M72',
  'gemini-3.6-flash-low': 'MODEL_PLACEHOLDER_M73',
  'gemini-3.6-flash-tiered': 'MODEL_PLACEHOLDER_M196',
  'gemini-3.5-flash-high': 'MODEL_PLACEHOLDER_M84',
  'gemini-3-flash-agent': 'MODEL_PLACEHOLDER_M84',
  'gemini-3.5-flash-medium': 'MODEL_PLACEHOLDER_M20',
  'gemini-3.5-flash-low': 'MODEL_PLACEHOLDER_M187',
  'gemini-3-flash-a': 'MODEL_PLACEHOLDER_M84',
  'gemini-3-flash-b': 'MODEL_PLACEHOLDER_M84',
  'gemini-3.1-pro-high': 'MODEL_PLACEHOLDER_M16',
  'gemini-pro-agent': 'MODEL_PLACEHOLDER_M16',
  'gemini-pro-default': 'MODEL_PLACEHOLDER_M16',
  'gemini-3.1-pro-low': 'MODEL_PLACEHOLDER_M36',
  'gemini-3-flash': 'MODEL_PLACEHOLDER_M18',
  'gemini-3.1-flash-image': 'MODEL_PLACEHOLDER_M21',
  'gpt-oss-120b-medium': 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
};

const FAMILY_MATCHERS = [
  { match: /gemini[-_ ]?4.*neon/i, family: 'gemini-4-neon' },
  { match: /gemini[-_ ]?4.*hydrogen/i, family: 'gemini-4-hydrogen' },
  { match: /gemini[-_ ]?4.*carbon/i, family: 'gemini-4-carbon' },
  { match: /gemini[-_ ]?4.*argon/i, family: 'gemini-4-argon' },
  { match: /claude.*opus.*5[-_. ]?5/i, family: 'claude-opus-5-5' },
  { match: /claude.*sonnet.*5[-_. ]?5/i, family: 'claude-sonnet-5-5' },
  { match: /claude.*opus/i, family: 'claude-opus-4-6' },
  { match: /claude.*sonnet/i, family: 'claude-sonnet-4-6' },
  { match: /claude.*haiku/i, family: 'claude-haiku' },
  { match: /gemini[-_ ]?3\.8[-_ ]?flash/i, family: 'gemini-3.8-flash' },
  { match: /gemini[-_ ]?3\.7[-_ ]?flash/i, family: 'gemini-3.7-flash' },
  { match: /gemini[-_ ]?3\.6[-_ ]?flash/i, family: 'gemini-3.6-flash' },
  { match: /gemini[-_ ]?3\.5[-_ ]?flash/i, family: 'gemini-3.5-flash' },
  { match: /gemini[-_ ]?3\.1[-_ ]?flash[-_ ]?image/i, family: 'gemini-3.1-flash-image' },
  { match: /gemini[-_ ]?3\.1[-_ ]?pro/i, family: 'gemini-3.1-pro' },
  { match: /gemini[-_ ]?3.*flash/i, family: 'gemini-3-flash' },
  { match: /gemini[-_ ]?3/i, family: 'gemini-3.1-pro' },
  { match: /gemini[-_ ]?2\.5[-_ ]?flash[-_ ]?lite/i, family: 'gemini-2.5-flash-lite' },
  { match: /gemini[-_ ]?2\.5[-_ ]?flash/i, family: 'gemini-2.5-flash' },
  { match: /gemini[-_ ]?2\.5[-_ ]?pro/i, family: 'gemini-2.5-pro' },
  { match: /gpt[-_ ]?oss[-_ ]?120b/i, family: 'gpt-oss-120b' },
  { match: /gpt[-_ ]?5|o3|o4/i, family: 'openai-frontier' },
  { match: /gpt[-_ ]?4o/i, family: 'gpt-4o' },
  { match: /deepseek/i, family: 'deepseek' },
];

const DEFAULT_SPEC = {
  label: 'Antigravity Model',
  labelEn: 'Antigravity Model',
  labelZh: 'Antigravity 模型',
  quotaPool: 'other',
  contextWindow: 1_000_000,
  maxOutput: 65_536,
  inputPerM: 1.50,
  cacheReadPerM: 0.15,
  outputPerM: 7.50,
  isFallback: true,
  pricingProvenance: 'fallback',
};

function normalizeLookupSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\((高)\)/g, '-high')
    .replace(/\((中)\)/g, '-medium')
    .replace(/\((低)\)/g, '-low')
    .replace(/\((超高)\)/g, '-xhigh')
    .replace(/\((思考)\)/g, '-thinking')
    .replace(/[()]/g, ' ')
    .replace(/(\d+)\.(\d+)/g, (m, a, b) => {
      // Keep Gemini 3.x / 2.5 dots intact, dash Claude 5.5 / 4.6
      return m;
    })
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function detectEffort(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (/(?:^|[-_\s(（])(?:tiered[-_\s]*xhigh|分级超高)(?:$|[)）])/i.test(s)) return 'tiered-xhigh';
  if (/(?:^|[-_\s(（])(?:tiered[-_\s]*high|分级高)(?:$|[)）])/i.test(s)) return 'tiered-high';
  if (/(?:^|[-_\s(（])(?:tiered|分级)(?:$|[)）])/i.test(s)) return 'tiered';
  if (/(?:^|[-_\s(（])(?:extra[-_\s]*high|xhigh|超高)(?:$|[)）])/i.test(s)) return 'xhigh';
  if (/(?:^|[-_\s(（])(?:high|高)(?:$|[)）])/i.test(s)) return 'high';
  if (/(?:^|[-_\s(（])(?:medium|med|中)(?:$|[)）])/i.test(s)) return 'medium';
  if (/(?:^|[-_\s(（])(?:low|低)(?:$|[)）])/i.test(s)) return 'low';
  if (/(?:^|[-_\s(（])(?:thinking|思考)(?:$|[)）])/i.test(s)) return 'thinking';
  return '';
}

function resolveAtMs(at) {
  if (at instanceof Date && Number.isFinite(at.getTime())) return at.getTime();
  if (typeof at === 'number' && Number.isFinite(at)) return at;
  if (typeof at === 'string' && at.trim()) {
    const parsed = Date.parse(at.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function buildLabels(baseLabel, effort, overrideEn, overrideZh) {
  if (overrideEn) {
    return { labelEn: overrideEn, labelZh: overrideZh || overrideEn };
  }
  if (effort && EFFORT_LABELS[effort]) {
    const ef = EFFORT_LABELS[effort];
    return {
      labelEn: `${baseLabel} (${ef.en})`,
      labelZh: `${baseLabel} (${ef.zh})`,
    };
  }
  return { labelEn: baseLabel, labelZh: baseLabel };
}

/**
 * Resolve canonical identity, localized En/Zh labels, quota pool, context limit,
 * and effective pricing (honoring historical effective-date cutovers via `options.at`).
 */
export function resolveModelMeta(modelId, options = {}) {
  const id = typeof modelId === 'string' ? modelId.trim() : '';
  const atMs = resolveAtMs(options?.at);
  if (!id) {
    return {
      ...DEFAULT_SPEC,
      id: 'unknown',
      canonicalKey: 'unknown',
      effort: '',
    };
  }

  const upper = id.toUpperCase();
  let catalogId = CATALOG_MODELS[upper] ? upper : '';
  let slug = normalizeLookupSlug(id);
  if (!catalogId && slug) {
    catalogId = SLUG_TO_CATALOG_ID[slug]
      || SLUG_TO_CATALOG_ID[slug.replace(/claude-(\w+)-(\d+)\.(\d+)/g, 'claude-$1-$2-$3')]
      || '';
  }

  if (catalogId && CATALOG_MODELS[catalogId]) {
    const entry = CATALOG_MODELS[catalogId];
    const fam = FAMILY_SPECS[entry.family];
    if (fam) {
      const prices = fam.pricing(atMs);
      const { labelEn, labelZh } = buildLabels(fam.baseLabel, entry.effort, entry.labelEn, entry.labelZh);
      // Unify retired placeholder IDs with their active sibling canonical key
      const canonicalKey = SLUG_TO_CATALOG_ID[slug] || catalogId;
      return {
        id,
        canonicalKey,
        family: entry.family,
        effort: entry.effort || '',
        label: labelEn,
        labelEn,
        labelZh,
        quotaPool: fam.quotaPool,
        contextWindow: fam.contextWindow,
        maxOutput: fam.maxOutput,
        inputPerM: prices.inputPerM,
        cacheReadPerM: prices.cacheReadPerM,
        outputPerM: prices.outputPerM,
        isFallback: false,
        pricingProvenance: entry.provenance || 'official',
      };
    }
  }

  for (const matcher of FAMILY_MATCHERS) {
    if (matcher.match.test(id)) {
      const fam = FAMILY_SPECS[matcher.family];
      const effort = detectEffort(id);
      const prices = fam.pricing(atMs);
      const { labelEn, labelZh } = buildLabels(fam.baseLabel, effort);
      const canonicalKey = effort ? `${matcher.family}-${effort}` : matcher.family;
      return {
        id,
        canonicalKey: SLUG_TO_CATALOG_ID[canonicalKey] || canonicalKey,
        family: matcher.family,
        effort,
        label: labelEn,
        labelEn,
        labelZh,
        quotaPool: fam.quotaPool,
        contextWindow: fam.contextWindow,
        maxOutput: fam.maxOutput,
        inputPerM: prices.inputPerM,
        cacheReadPerM: prices.cacheReadPerM,
        outputPerM: prices.outputPerM,
        isFallback: false,
        pricingProvenance: 'official',
      };
    }
  }

  const lower = id.toLowerCase();
  const fallbackPool = /(?:claude|anthropic|gpt|openai|\bo[134]\b|codex|opus|sonnet|haiku)/.test(lower)
    ? 'premium'
    : (/(?:gemini|gemma|neon|hydrogen|carbon|argon)/.test(lower) ? 'gemini' : 'other');
  return {
    ...DEFAULT_SPEC,
    id,
    canonicalKey: id,
    effort: detectEffort(id),
    label: id,
    labelEn: id,
    labelZh: id,
    quotaPool: fallbackPool,
  };
}

export function getModelSpec(modelId, options = {}) {
  return resolveModelMeta(modelId, options);
}

/**
 * Compute estimated USD cost for a step.
 * Matches Context Monitor's `costFromTokens`: bills uncached `inputTokens`,
 * `cacheReadTokens`, and `outputTokens` (which already include thinking tokens),
 * while not billing `cacheCreationTokens`.
 */
export function estimateStepCost(modelId, inputTokens = 0, cacheReadTokens = 0, outputTokens = 0, options = {}) {
  const spec = resolveModelMeta(modelId, options);
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
