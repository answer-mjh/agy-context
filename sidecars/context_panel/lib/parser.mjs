import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { formatLocalDateKey, toMillis } from './env.mjs';
import { estimateStepCost, getModelSpec } from './pricing.mjs';
import {
  countLines,
  estimateMediaTokens,
  estimateTokens,
  parseUserInputContent,
  unwrapToolArgs,
} from './tokenizer.mjs';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.ico', '.avif']);

/**
 * Convert a transcript media URI (plain path or file:// URL) into a local path.
 */
export function localPathFromUri(uri) {
  let value = String(uri || '').trim();
  if (!value) return '';
  if (/^file:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      value = decodeURIComponent(url.pathname || '');
      if (/^\/[A-Za-z]:/.test(value)) value = value.slice(1);
      if (url.hostname && url.hostname !== 'localhost') value = `//${url.hostname}${value}`;
    } catch {
      return '';
    }
  }
  return value.replace(/\//g, '\\');
}

/**
 * Parse Antigravity tool result content: extracts Created At / Completed At wall-clock
 * duration, exit code, error status, and strips redundant header lines for display.
 */
export function parseToolResultContent(rawContent, status, explicitError) {
  const raw = typeof rawContent === 'string' ? rawContent : '';
  let createdAtMs = 0;
  let completedAtMs = 0;
  const createdMatch = raw.match(/Created At:\s*([^\r\n]+)/);
  const completedMatch = raw.match(/Completed At:\s*([^\r\n]+)/);
  if (createdMatch) createdAtMs = toMillis(createdMatch[1].trim());
  if (completedMatch) completedAtMs = toMillis(completedMatch[1].trim());
  const durationMs =
    createdAtMs > 0 && completedAtMs >= createdAtMs ? completedAtMs - createdAtMs : 0;

  let exitCode = null;
  const exitMatch = raw.match(/Command exited with code\s+(-?\d+)/i);
  if (exitMatch) {
    exitCode = Number(exitMatch[1]);
  }

  const isError =
    Boolean(explicitError) ||
    status === 'ERROR' ||
    (exitCode !== null && exitCode !== 0) ||
    /^\s*(Error:|Tool execution was canceled)/m.test(raw);

  // Strip repeated Created At / Completed At headers for cleaner preview
  const cleanedBody = raw
    .replace(/^(?:Created At:[^\r\n]*\r?\nCompleted At:[^\r\n]*\r?\n)+/, '')
    .trim();

  return {
    raw,
    cleanedBody,
    durationMs,
    exitCode,
    isError,
    lineCount: countLines(cleanedBody || raw),
  };
}

/**
 * Extract primary executable / command name from a shell command line.
 */
export function extractPrimaryProgram(commandLine) {
  if (!commandLine || typeof commandLine !== 'string') return 'shell';
  let s = commandLine.trim();
  if (!s) return 'shell';

  // Handle PowerShell here-string piped to python/node/etc., e.g. `@' ... '@ | python -`
  const herePipe = s.match(/'@\s*\|\s*([A-Za-z0-9_.\-]+)/);
  if (herePipe) return normalizeProgramName(herePipe[1]);

  // Split by chaining operators and inspect the first meaningful command
  const segments = s.split(/\s*(?:&&|\|\||;|\r?\n)\s*/);
  for (let seg of segments) {
    seg = seg.trim();
    if (!seg || seg.startsWith('#')) continue;
    // Skip pure variable assignments (`$x = ...` or `FOO=bar ...`)
    if (/^\$[A-Za-z_]\w*\s*=/.test(seg)) continue;
    seg = seg.replace(/^(?:[A-Za-z_]\w*=\S+\s+)+/, '').trim();
    if (!seg) continue;
    // Skip `cd ...` if there are subsequent commands
    if (/^(?:cd|Set-Location|pushd)\b/i.test(seg) && segments.length > 1) continue;
    // Strip leading call operator `&` or quotes
    seg = seg.replace(/^&\s*/, '').trim();
    const tokenMatch = seg.match(/^"([^"]+)"|^'([^']+)'|^([^\s|<>]+)/);
    const token = tokenMatch ? (tokenMatch[1] || tokenMatch[2] || tokenMatch[3]) : '';
    if (token) {
      return normalizeProgramName(token);
    }
  }
  return 'shell';
}

function normalizeProgramName(rawToken) {
  const cleaned = String(rawToken || '').replace(/\\n|\\r|\\t/g, ' ').trim().split(/\s+/)[0] || '';
  const base = basename(cleaned.replace(/\\/g, '/')).replace(/\.(exe|cmd|bat|ps1|sh)$/i, '').replace(/[^A-Za-z0-9_.-]/g, '');
  return base.toLowerCase() || 'shell';
}

/**
 * Detect skill name when reading a SKILL.md or invoking a skill path.
 */
export function detectSkillFromToolCall(toolName, args) {
  if (toolName === 'read_file' || toolName === 'view_file') {
    const filePath = String(args.Path || args.AbsolutePath || args.path || '');
    const normalized = filePath.replace(/\\/g, '/');
    const match = normalized.match(/\/skills\/([^/]+)\/SKILL\.md$/i);
    if (match) {
      return {
        skillName: match[1],
        path: filePath,
      };
    }
  }
  return null;
}

/**
 * Extract file operation metadata (Read / Written / Searched / Images) from a tool call.
 */
export function extractFileOpsFromToolCall(toolName, args, resultBody) {
  const ops = [];
  const name = String(toolName || '').toLowerCase();

  if (name === 'read_file' || name === 'view_file' || name === 'view_file_outline' || name === 'view_code_item') {
    const filePath = String(args.Path || args.AbsolutePath || args.path || '').trim();
    if (filePath) {
      const ext = extname(filePath).toLowerCase();
      const kind = IMAGE_EXTS.has(ext) ? 'images' : 'read';
      ops.push({ path: filePath, kind, tool: toolName, addedLines: 0, removedLines: 0 });
    }
  } else if (name === 'write_file' || name === 'write_to_file') {
    const filePath = String(args.Path || args.TargetFile || args.path || '').trim();
    if (filePath) {
      const content = typeof args.Content === 'string' ? args.Content : (typeof args.CodeContent === 'string' ? args.CodeContent : '');
      ops.push({
        path: filePath,
        kind: 'written',
        tool: toolName,
        addedLines: countLines(content),
        removedLines: 0,
      });
    }
  } else if (name === 'edit_file' || name === 'replace_file_content' || name === 'multi_replace_file_content') {
    const filePath = String(args.Path || args.TargetFile || args.path || '').trim();
    if (filePath) {
      let added = 0;
      let removed = 0;
      if (typeof args.Target === 'string' || typeof args.Replacement === 'string') {
        const oldLines = args.Target ? countLines(String(args.Target)) : 0;
        const newLines = args.Replacement ? countLines(String(args.Replacement)) : 0;
        added = Math.max(0, newLines - oldLines) + Math.min(oldLines, newLines);
        removed = oldLines;
        // More accurate diff approximation: count distinct lines
        const diff = approximateLineDiff(String(args.Target || ''), String(args.Replacement || ''));
        added = diff.added;
        removed = diff.removed;
      } else if (Array.isArray(args.ReplacementChunks)) {
        for (const ch of args.ReplacementChunks) {
          const diff = approximateLineDiff(String(ch?.TargetContent || ''), String(ch?.ReplacementContent || ''));
          added += diff.added;
          removed += diff.removed;
        }
      } else if (typeof args.TargetContent === 'string' || typeof args.ReplacementContent === 'string') {
        const diff = approximateLineDiff(String(args.TargetContent || ''), String(args.ReplacementContent || ''));
        added = diff.added;
        removed = diff.removed;
      }
      ops.push({ path: filePath, kind: 'written', tool: toolName, addedLines: added, removedLines: removed });
    }
  } else if (name === 'grep_search' || name === 'find_by_name' || name === 'list_dir') {
    const searchRoot = String(args.SearchPath || args.SearchDirectory || args.DirectoryPath || '').trim();
    if (searchRoot) {
      ops.push({ path: searchRoot, kind: 'searched', tool: toolName, addedLines: 0, removedLines: 0 });
    }
    // Extract matched file paths from grep/find output lines if present
    if (typeof resultBody === 'string' && resultBody.length > 0) {
      const matchedFiles = new Set();
      const lines = resultBody.split(/\r?\n/).slice(0, 120);
      for (const line of lines) {
        const m = line.match(/^([A-Za-z]:\\[^:*?"<>|\r\n]+|\/[^:\r\n]+\.[A-Za-z0-9]{1,8})(?::\d+)?/);
        if (m && m[1] !== searchRoot) {
          matchedFiles.add(m[1]);
        }
      }
      for (const fp of matchedFiles) {
        ops.push({ path: fp, kind: 'searched', tool: toolName, addedLines: 0, removedLines: 0 });
      }
    }
  }

  return ops;
}

function approximateLineDiff(oldText, newText) {
  if (oldText === newText) return { added: 0, removed: 0 };
  const oldArr = oldText ? oldText.split(/\r?\n/) : [];
  const newArr = newText ? newText.split(/\r?\n/) : [];
  const oldCounts = new Map();
  for (const line of oldArr) oldCounts.set(line, (oldCounts.get(line) || 0) + 1);
  let common = 0;
  for (const line of newArr) {
    const c = oldCounts.get(line) || 0;
    if (c > 0) {
      common++;
      oldCounts.set(line, c - 1);
    }
  }
  return {
    added: Math.max(0, newArr.length - common),
    removed: Math.max(0, oldArr.length - common),
  };
}

/**
 * Parse a JSONL transcript file into normalized steps and structured tool pairings.
 */
export function parseTranscriptFile(filePath, options = {}) {
  const { keepFullText = false } = options;
  if (!existsSync(filePath)) {
    return null;
  }

  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return null;
  }

  const rawText = readFileSync(filePath, 'utf8');
  const lines = rawText.split(/\r?\n/);
  const steps = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      steps.push(obj);
    } catch {
      // Skip malformed partial line (e.g., while Antigravity is mid-write)
    }
  }

  const normalizedSteps = [];
  let turnIndex = 0;
  let currentUserSnippet = '';
  let lastModel = '';
  let pendingToolCalls = [];
  let pendingCallStepIdx = -1;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const stepIndex = Number.isInteger(s.step_index) ? s.step_index : i;
    const type = String(s.type || 'GENERIC');
    const source = String(s.source || 'SYSTEM');
    const status = String(s.status || 'DONE');
    const createdAt = String(s.created_at || '');
    const createdMs = toMillis(createdAt);
    const dateKey = formatLocalDateKey(createdAt);

    if (type === 'USER_INPUT') {
      turnIndex++;
      pendingToolCalls = [];
      const parsed = parseUserInputContent(s.content || '');
      currentUserSnippet = parsed.cleanText.replace(/\s+/g, ' ').slice(0, 140);
      const media = Array.isArray(s.media) ? s.media : [];
      const tokensEst = estimateTokens(parsed.rawText) + estimateMediaTokens(media);

      normalizedSteps.push({
        stepIndex,
        turnIndex,
        type,
        source,
        status,
        createdAt,
        createdMs,
        dateKey,
        cleanText: keepFullText ? parsed.cleanText : parsed.cleanText.slice(0, 240),
        rawText: keepFullText ? parsed.rawText : '',
        settingsChange: parsed.settingsChange,
        media,
        tokensEst,
        mediaTokensEst: estimateMediaTokens(media),
      });
      continue;
    }

    if (type === 'PLANNER_RESPONSE') {
      const model = String(s.model || lastModel || '');
      const modelSwitched = Boolean(lastModel && model && model !== lastModel);
      if (model) lastModel = model;

      const inputTokens = Math.max(0, Number(s.input_tokens) || 0);
      const cacheReadTokens = Math.max(0, Number(s.cache_read_tokens) || 0);
      const outputTokens = Math.max(0, Number(s.output_tokens) || 0);
      const totalPromptTokens = inputTokens + cacheReadTokens;
      const totalBillableTokens = totalPromptTokens + outputTokens;
      const { cost, spec } = estimateStepCost(model, inputTokens, cacheReadTokens, outputTokens);

      const thinking = typeof s.thinking === 'string' ? s.thinking : '';
      const content = typeof s.content === 'string' ? s.content : '';
      const rawCalls = Array.isArray(s.tool_calls) ? s.tool_calls : [];
      const toolCalls = rawCalls.map((tc, idx) => {
        const name = String(tc?.name || 'unknown');
        const args = unwrapToolArgs(tc?.args);
        const argsStr = JSON.stringify(args);
        return {
          callIndex: idx,
          name,
          args,
          argsTokensEst: estimateTokens(name) + estimateTokens(argsStr),
          skill: detectSkillFromToolCall(name, args),
        };
      });

      const thinkingTokensEst = estimateTokens(thinking);
      const answerTokensEst = estimateTokens(content);
      const toolCallTokensEst = toolCalls.reduce((acc, tc) => acc + tc.argsTokensEst, 0);

      // Prepare queue to pair subsequent GENERIC steps with these tool calls
      pendingToolCalls = toolCalls.slice();
      pendingCallStepIdx = stepIndex;

      normalizedSteps.push({
        stepIndex,
        turnIndex: Math.max(1, turnIndex),
        type,
        source,
        status,
        createdAt,
        createdMs,
        dateKey,
        model,
        modelLabel: spec.label,
        contextWindow: spec.contextWindow,
        maxOutput: spec.maxOutput,
        modelSwitched,
        prevModel: modelSwitched ? lastModel : '',
        inputTokens,
        cacheReadTokens,
        outputTokens,
        totalPromptTokens,
        totalBillableTokens,
        cost,
        thinking: keepFullText ? thinking : thinking.slice(0, 220),
        content: keepFullText ? content : content.slice(0, 220),
        hasThinking: thinking.trim().length > 0,
        hasAnswer: content.trim().length > 0,
        hasTools: toolCalls.length > 0,
        thinkingTokensEst,
        answerTokensEst,
        toolCallTokensEst,
        toolCalls,
        userSnippet: currentUserSnippet,
      });
      continue;
    }

    if (type === 'GENERIC') {
      const pairedCall = pendingToolCalls.length > 0 ? pendingToolCalls.shift() : null;
      const parsedResult = parseToolResultContent(s.content || '', status, s.error);
      const media = Array.isArray(s.media) ? s.media : [];
      const tokensEst = estimateTokens(s.content || '');
      const mediaTokensEst = estimateMediaTokens(media);
      const toolName = pairedCall ? pairedCall.name : 'tool_result';
      const args = pairedCall ? pairedCall.args : {};
      const skill = pairedCall ? pairedCall.skill : null;
      const fileOps = pairedCall ? extractFileOpsFromToolCall(toolName, args, parsedResult.cleanedBody) : [];

      const seenMediaPaths = new Set(fileOps.filter(op => op.kind === 'images').map(op => op.path));
      for (const item of media) {
        const localPath = localPathFromUri(item?.uri);
        if (!localPath || seenMediaPaths.has(localPath)) continue;
        seenMediaPaths.add(localPath);
        fileOps.push({ path: localPath, kind: 'images', tool: toolName, addedLines: 0, removedLines: 0 });
      }

      let commandInfo = null;
      if (toolName === 'run_command') {
        const cmdLine = String(args.CommandLine || '');
        commandInfo = {
          commandLine: cmdLine,
          summary: String(args.toolSummary || ''),
          program: extractPrimaryProgram(cmdLine),
          exitCode: parsedResult.exitCode,
          isError: parsedResult.isError,
          durationMs: parsedResult.durationMs,
          stepIndex,
          turnIndex: Math.max(1, turnIndex),
          createdAt,
        };
      }

      normalizedSteps.push({
        stepIndex,
        turnIndex: Math.max(1, turnIndex),
        type,
        source,
        status,
        createdAt,
        createdMs,
        dateKey,
        pairedCallStepIdx: pairedCall ? pendingCallStepIdx : -1,
        toolName,
        toolArgs: keepFullText ? args : (toolName === 'run_command' ? { CommandLine: args.CommandLine, toolSummary: args.toolSummary } : args),
        isSkillLoad: Boolean(skill),
        skillName: skill ? skill.skillName : '',
        skillPath: skill ? skill.path : '',
        fileOps,
        commandInfo,
        durationMs: parsedResult.durationMs,
        exitCode: parsedResult.exitCode,
        isError: parsedResult.isError,
        lineCount: parsedResult.lineCount,
        resultBody: keepFullText ? parsedResult.cleanedBody : parsedResult.cleanedBody.slice(0, 240),
        rawResult: keepFullText ? parsedResult.raw : '',
        media,
        tokensEst,
        mediaTokensEst,
        isMedia: media.length > 0,
        truncated: Array.isArray(s.truncated_fields) && s.truncated_fields.length > 0,
      });
      continue;
    }

    if (type === 'CHECKPOINT') {
      const model = String(s.model || lastModel || '');
      if (model) lastModel = model;
      pendingToolCalls = [];
      pendingCallStepIdx = -1;

      const inputTokens = Math.max(0, Number(s.input_tokens) || 0);
      const cacheReadTokens = Math.max(0, Number(s.cache_read_tokens) || 0);
      const outputTokens = Math.max(0, Number(s.output_tokens) || 0);
      const totalPromptTokens = inputTokens + cacheReadTokens;
      const totalBillableTokens = totalPromptTokens + outputTokens;
      const { cost, spec } = estimateStepCost(model, inputTokens, cacheReadTokens, outputTokens);
      const content = typeof s.content === 'string' ? s.content : '';
      const tokensEst = estimateTokens(content);

      normalizedSteps.push({
        stepIndex,
        turnIndex: Math.max(1, turnIndex),
        type,
        source,
        status,
        createdAt,
        createdMs,
        dateKey,
        model,
        modelLabel: spec.label,
        contextWindow: spec.contextWindow,
        maxOutput: spec.maxOutput,
        inputTokens,
        cacheReadTokens,
        outputTokens,
        totalPromptTokens,
        totalBillableTokens,
        cost,
        content: keepFullText ? content : content.slice(0, 260),
        tokensEst,
        isCheckpoint: true,
      });
      continue;
    }

    if (type === 'SYSTEM_MESSAGE' || type === 'ERROR_MESSAGE') {
      const text = String(s.content || s.error || '');
      const tokensEst = estimateTokens(text);
      normalizedSteps.push({
        stepIndex,
        turnIndex: Math.max(1, turnIndex),
        type,
        source,
        status,
        createdAt,
        createdMs,
        dateKey,
        content: keepFullText ? text : text.slice(0, 260),
        error: String(s.error || ''),
        tokensEst,
      });
      continue;
    }

    // Fallback for any future step type
    const text = String(s.content || '');
    normalizedSteps.push({
      stepIndex,
      turnIndex: Math.max(1, turnIndex),
      type,
      source,
      status,
      createdAt,
      createdMs,
      dateKey,
      content: keepFullText ? text : text.slice(0, 200),
      tokensEst: estimateTokens(text),
    });
  }

  return {
    filePath,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    steps: normalizedSteps,
  };
}
