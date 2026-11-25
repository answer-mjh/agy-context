import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveBrainDir } from './env.mjs';
import { readConversationMetaMap } from './sqlite-meta.mjs';

const EMPTY_COMPOSITION = Object.freeze({
  systemBase: 0,
  toolDefs: 0,
  tools: 0,
  user: 0,
  injected: 0,
  skills: 0,
  assistant: 0,
  thinking: 0,
  media: 0,
  other: 0,
  total: 0,
});

const COMP_KEYS = Object.keys(EMPTY_COMPOSITION);
const MAX_REPORT_CHARS = 12000;
const MAX_TIMELINE = 400;

function toMs(value) {
  const ms = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function shortId(id) {
  return String(id || '').slice(0, 8);
}

function unquoteValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return String(value);
  let out = value.trim();
  for (let i = 0; i < 3; i++) {
    if (out.length >= 2 && out.startsWith('"') && out.endsWith('"')) {
      try {
        const parsed = JSON.parse(out);
        if (typeof parsed !== 'string') break;
        out = parsed.trim();
        continue;
      } catch {
        out = out.endsWith('"') ? out.slice(1, -1) : out.slice(1);
        break;
      }
    }
    break;
  }
  if (out.startsWith('"')) out = out.slice(1);
  if (out.endsWith('"')) out = out.slice(0, -1);
  if (out.includes('\\n') || out.includes('\\"') || out.includes('\\\\')) {
    out = out
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return out;
}

function truncate(text, max) {
  const str = String(text || '').trim();
  if (!max || str.length <= max) return str;
  return `${str.slice(0, Math.max(0, max - 1))}…`;
}

function isRunningStatus(status) {
  const s = String(status || '').toUpperCase();
  return Boolean(s) && !s.includes('IDLE');
}

function normalizeComposition(comp) {
  const out = {};
  for (const key of COMP_KEYS) out[key] = Math.max(0, Number(comp?.[key]) || 0);
  if (!out.total) {
    out.total = COMP_KEYS.reduce((acc, key) => (key === 'total' ? acc : acc + out[key]), 0);
  }
  return out;
}

function sumCompositions(nodes) {
  const out = {};
  for (const key of COMP_KEYS) out[key] = 0;
  for (const node of nodes) {
    const comp = node.composition || {};
    for (const key of COMP_KEYS) out[key] += Math.max(0, Number(comp[key]) || 0);
  }
  out.total = COMP_KEYS.reduce((acc, key) => (key === 'total' ? acc : acc + out[key]), 0);
  return out;
}

function parseArgs(args) {
  if (!args || typeof args !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(args)) out[key] = unquoteValue(value);
  return out;
}

function extractMessage(step) {
  const content = String(step?.content || '');
  if (step?.source !== 'SYSTEM' && step?.type !== 'SYSTEM_MESSAGE') return null;
  const match = /\[Message\]\s+timestamp=([^\s]+)\s+sender=([^\s]+)\s+priority=([^\s]+)\s+content=([\s\S]*)$/.exec(content);
  if (!match) return null;
  return {
    ts: toMs(match[1]) || toMs(step.created_at),
    sender: match[2].trim(),
    priority: match[3].trim(),
    content: String(match[4] || '').trim(),
  };
}

function extractSubagentList(content) {
  const match = /You have \d+ active subagent\(s\):\s*(\[[\s\S]*?\])/.exec(String(content || '').trim());
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && typeof item === 'object' && typeof item.conversationId === 'string')
      .map(item => ({
        conversationId: item.conversationId,
        role: typeof item.role === 'string' ? item.role : '',
        type: typeof item.type === 'string' ? item.type : '',
      }));
  } catch {
    return [];
  }
}

function collectConversationIds(content) {
  const ids = [];
  const re = /"conversationId"\s*:\s*"([0-9a-fA-F-]{16,})"/g;
  let match;
  while ((match = re.exec(String(content || ''))) !== null) {
    if (!ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

export function resolveFamily(currentId, sessions, metaMap) {
  const convId = String(currentId || '');
  if (!convId) return { rootId: '', ids: [] };

  const known = new Set(sessions.map(s => s.id));
  if (metaMap) for (const id of metaMap.keys()) known.add(id);

  const parentOf = (id) => String(metaMap?.get(id)?.parentConversationId || '');
  let rootId = convId;
  const seen = new Set([convId]);
  while (parentOf(rootId) && !seen.has(parentOf(rootId))) {
    rootId = parentOf(rootId);
    seen.add(rootId);
  }

  const childrenMap = new Map();
  for (const id of known) {
    const parent = parentOf(id);
    if (!parent) continue;
    if (!childrenMap.has(parent)) childrenMap.set(parent, []);
    childrenMap.get(parent).push(id);
  }

  const ids = [];
  const queue = [{ id: rootId, depth: 0 }];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || ids.some(entry => entry.id === item.id)) continue;
    ids.push(item);
    const children = childrenMap.get(item.id) || [];
    for (const child of children.sort()) queue.push({ id: child, depth: item.depth + 1 });
  }

  if (ids.length === 0) ids.push({ id: convId, depth: 0 });
  return { rootId, ids };
}

export class FleetStore {
  constructor(projectionStore, detailStore = null) {
    this.projectionStore = projectionStore;
    this.detailStore = detailStore;
    this.metaCache = { at: 0, map: null };
    this.transcriptCache = new Map();
  }

  async getMetaMap() {
    const now = Date.now();
    if (this.metaCache.map && now - this.metaCache.at < 3000) return this.metaCache.map;
    const map = await readConversationMetaMap();
    this.metaCache = { at: now, map };
    return map;
  }

  readTranscript(convId) {
    const path = join(resolveBrainDir(), convId, '.system_generated', 'logs', 'transcript.jsonl');
    if (!existsSync(path)) return [];
    let stat;
    try {
      stat = statSync(path);
    } catch {
      return [];
    }
    const cached = this.transcriptCache.get(convId);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.steps;

    let text = '';
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      return [];
    }
    const steps = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') steps.push(parsed);
      } catch {
        // ignore partial writes
      }
    }
    this.transcriptCache.set(convId, { mtimeMs: stat.mtimeMs, size: stat.size, steps });
    return steps;
  }

  buildNodes(familyIds, sessions, metaMap, currentId) {
    const sessionMap = new Map(sessions.map(s => [s.id, s]));
    return familyIds.map(({ id, depth }) => {
      const session = sessionMap.get(id) || null;
      const meta = metaMap.get(id) || null;
      const agentName = String(meta?.agentName || '');
      const title = agentName
        ? agentName
        : (meta?.title || session?.title || shortId(id));
      const composition = normalizeComposition(session?.latestComposition);
      const status = String(meta?.status || session?.status || '');
      return {
        id,
        shortId: shortId(id),
        title,
        role: '',
        agentName,
        parentId: String(meta?.parentConversationId || ''),
        depth,
        isCurrent: id === currentId,
        isRoot: depth === 0,
        status,
        running: isRunningStatus(status),
        modelLabel: session?.latestModelLabel || '',
        workspaceName: session?.workspaceName || meta?.workspaceName || '',
        steps: Number(session?.stepCount) || 0,
        requests: Number(session?.requestsCount) || 0,
        turns: Number(session?.turnsCount) || 0,
        toolCalls: Number(session?.toolCallsCount) || 0,
        firstMs: Number(session?.firstMs) || 0,
        lastMs: Number(session?.lastMs) || 0,
        activeMs: Number(session?.activeDurationMs) || 0,
        billableTokens: Number(session?.totalBillableTokens) || 0,
        cost: Number(session?.totalCost) || 0,
        promptTokens: Number(session?.latestPromptTokens) || 0,
        contextWindow: Number(session?.contextWindow) || 0,
        usagePct: Math.max(0, Math.min(100, Number(session?.windowUsagePct) || 0)),
        composition,
      };
    });
  }

  async hydrateContext(nodes, metaMap) {
    if (!this.detailStore) return;
    await Promise.all(nodes.map(async (node) => {
      try {
        const snap = await this.detailStore.getContextSnapshot(node.id, metaMap.get(node.id) || null);
        if (!snap?.composition?.total) return;
        node.composition = normalizeComposition(snap.composition);
        node.contextWindow = snap.contextWindow || node.contextWindow;
        node.promptTokens = snap.promptTokens || node.promptTokens;
        node.usagePct = Number.isFinite(snap.usagePct) ? snap.usagePct : node.usagePct;
        node.contextSource = snap.source;
      } catch {
        // keep the projection fallback
      }
    }));
  }

  collectCollaboration(familyIds, familySet) {
    const delegations = [];
    const sends = [];
    const messages = [];
    const manageEntries = [];
    const firstInbound = new Map();

    for (const id of familyIds) {
      const steps = this.readTranscript(id);
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const msg = extractMessage(step);
        if (msg && familySet.has(msg.sender) && msg.sender !== id) {
          if (!firstInbound.has(id)) firstInbound.set(id, msg);
          if (i > 0) {
            messages.push({ ts: msg.ts, from: msg.sender, to: id, content: msg.content, priority: msg.priority });
          }
        }
        const content = String(step.content || '');
        if (content.includes('active subagent(s):')) {
          for (const entry of extractSubagentList(content)) manageEntries.push({ parentId: id, ...entry });
        }
        const calls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
        for (const call of calls) {
          if (!call || typeof call.name !== 'string') continue;
          const args = parseArgs(call.args);
          const ts = toMs(step.created_at);
          if (call.name === 'invoke_subagent') {
            const nextIds = collectConversationIds(steps[i + 1]?.content || '');
            delegations.push({
              parentId: id,
              ts,
              prompt: args.Prompt || '',
              role: args.Role || '',
              type: args.TypeName || '',
              model: args.Model || '',
              childId: nextIds[0] || '',
            });
          } else if (call.name === 'send_message') {
            const recipient = String(args.Recipient || '').trim().split(/\s+/)[0];
            if (familySet.has(recipient)) {
              sends.push({ ts, from: id, to: recipient, content: args.Message || '', priority: 'MESSAGE_PRIORITY_HIGH' });
            }
          }
        }
      }
    }

    return { delegations, sends, messages, manageEntries, firstInbound };
  }

  async getSummary(currentId) {
    const [sessions, metaMap] = await Promise.all([
      this.projectionStore.listSessions(),
      this.getMetaMap(),
    ]);
    const family = resolveFamily(currentId, sessions, metaMap);
    if (!family.ids.length) {
      return {
        rootId: '', agents: 0, children: 0, running: 0, steps: 0, requests: 0,
        billableTokens: 0, cost: 0, activeMs: 0, hasChildren: false,
      };
    }
    const nodes = this.buildNodes(family.ids, sessions, metaMap, currentId);
    const children = family.ids.filter(entry => entry.depth > 0).length;
    return {
      rootId: family.rootId,
      agents: nodes.length,
      children,
      running: nodes.filter(node => node.running).length,
      steps: nodes.reduce((acc, node) => acc + node.steps, 0),
      requests: nodes.reduce((acc, node) => acc + node.requests, 0),
      billableTokens: nodes.reduce((acc, node) => acc + node.billableTokens, 0),
      cost: nodes.reduce((acc, node) => acc + node.cost, 0),
      activeMs: nodes.reduce((acc, node) => acc + node.activeMs, 0),
      hasChildren: children > 0,
    };
  }

  async getFleet(currentId) {
    const [sessions, metaMap] = await Promise.all([
      this.projectionStore.listSessions(),
      this.getMetaMap(),
    ]);
    if (!sessions.length && !metaMap.size) return null;

    const family = resolveFamily(currentId, sessions, metaMap);
    const familyIds = family.ids.map(entry => entry.id);
    const familySet = new Set(familyIds);
    const nodes = this.buildNodes(family.ids, sessions, metaMap, currentId);
    await this.hydrateContext(nodes, metaMap);

    const collab = this.collectCollaboration(familyIds, familySet);
    const claimed = new Set();

    for (const delegation of collab.delegations) {
      if (delegation.childId && familySet.has(delegation.childId)) claimed.add(delegation.childId);
    }

    for (const delegation of collab.delegations) {
      if (delegation.childId && familySet.has(delegation.childId)) continue;
      const candidates = nodes.filter(node =>
        node.parentId === delegation.parentId &&
        !claimed.has(node.id) &&
        (!delegation.type || !node.agentName || node.agentName === delegation.type)
      );
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => Math.abs((a.firstMs || 0) - delegation.ts) - Math.abs((b.firstMs || 0) - delegation.ts));
      delegation.childId = candidates[0].id;
      claimed.add(candidates[0].id);
    }

    const delegationByChild = new Map();
    for (const delegation of collab.delegations) {
      if (delegation.childId) delegationByChild.set(delegation.childId, delegation);
    }
    const manageByChild = new Map();
    for (const entry of collab.manageEntries) {
      if (familySet.has(entry.conversationId)) manageByChild.set(entry.conversationId, entry);
    }

    const tasks = [];
    const timeline = [];

    for (const node of nodes) {
      const parentId = node.parentId;
      if (!parentId || !familySet.has(parentId)) continue;
      const delegation = delegationByChild.get(node.id) || null;
      const manage = manageByChild.get(node.id) || null;
      const inbound = collab.firstInbound.get(node.id) || null;
      const role = delegation?.role || manage?.role || '';
      const type = node.agentName || delegation?.type || manage?.type || '';
      const brief = inbound?.content || delegation?.prompt || '';
      const replies = collab.messages
        .filter(msg => msg.from === node.id && msg.to === parentId)
        .sort((a, b) => a.ts - b.ts);
      const lastReply = replies[replies.length - 1] || null;
      const childSteps = this.readTranscript(node.id);
      const lastModelText = [...childSteps]
        .reverse()
        .find(step => step.type === 'PLANNER_RESPONSE' && typeof step.content === 'string')?.content || '';
      const completionSignal = /COMPLETED|TASK_COMPLETED|sent the (final )?(report|result)|final report|已完成|报告已发送/i
        .test(`${lastReply?.content || ''}\n${lastModelText}`);
      const completed = Boolean(lastReply) && !node.running && completionSignal;
      const startedMs = delegation?.ts || node.firstMs;
      const completedMs = completed ? lastReply.ts : 0;

      if (role) node.role = role;
      node.taskTitle = role || type || node.shortId;
      node.taskStatus = completed ? 'completed' : 'in_progress';

      tasks.push({
        id: node.id,
        agentId: node.id,
        parentId,
        title: node.taskTitle,
        agentName: type,
        role,
        brief: truncate(brief, 2400),
        status: completed ? 'completed' : 'in_progress',
        startedMs,
        completedMs,
        report: truncate(lastReply?.content || '', MAX_REPORT_CHARS),
      });

      timeline.push({
        id: `delegate-${node.id}`,
        ts: startedMs,
        kind: 'delegate',
        from: parentId,
        to: node.id,
        agentId: node.id,
        taskId: node.id,
        title: role || type || node.shortId,
        detail: truncate(brief, 4000),
      });
    }

    for (const send of collab.sends) {
      timeline.push({
        id: `send-${send.ts}-${send.from}-${send.to}-${timeline.length}`,
        ts: send.ts,
        kind: 'message',
        from: send.from,
        to: send.to,
        agentId: send.from,
        taskId: send.to,
        title: '',
        detail: truncate(send.content, 4000),
      });
    }

    for (const msg of collab.messages) {
      const complete = /COMPLETED|TASK_COMPLETED/i.test(msg.content);
      timeline.push({
        id: `msg-${msg.ts}-${msg.from}-${msg.to}-${timeline.length}`,
        ts: msg.ts,
        kind: complete ? 'complete' : 'message',
        from: msg.from,
        to: msg.to,
        agentId: msg.from,
        taskId: msg.from,
        title: '',
        detail: truncate(msg.content, 8000),
      });
    }

    const normalizeDetail = (text) => String(text || '')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    const chosen = new Map();
    for (const item of timeline.sort((a, b) => a.ts - b.ts)) {
      const key = `${item.from}|${item.to}|${normalizeDetail(item.detail)}`;
      const prev = chosen.get(key);
      if (!prev) {
        chosen.set(key, item);
        continue;
      }
      const prevScore = prev.detail.length + (prev.kind === 'complete' ? 100000 : 0);
      const nextScore = item.detail.length + (item.kind === 'complete' ? 100000 : 0);
      if (nextScore >= prevScore) chosen.set(key, item);
    }
    const deduped = [...chosen.values()].sort((a, b) => a.ts - b.ts);

    const limitedTimeline = deduped.slice(-MAX_TIMELINE);
    const messagesCount = limitedTimeline.filter(item => item.kind !== 'delegate').length;
    const summary = {
      rootId: family.rootId,
      agents: nodes.length,
      children: tasks.length,
      running: nodes.filter(node => node.running).length,
      steps: nodes.reduce((acc, node) => acc + node.steps, 0),
      requests: nodes.reduce((acc, node) => acc + node.requests, 0),
      messages: messagesCount,
      tasks: tasks.length,
      completedTasks: tasks.filter(task => task.status === 'completed').length,
      billableTokens: nodes.reduce((acc, node) => acc + node.billableTokens, 0),
      cost: nodes.reduce((acc, node) => acc + node.cost, 0),
      activeMs: nodes.reduce((acc, node) => acc + node.activeMs, 0),
      hasChildren: tasks.length > 0,
      composition: sumCompositions(nodes),
    };

    const edges = nodes
      .filter(node => node.parentId && familySet.has(node.parentId))
      .map(node => ({ from: node.parentId, to: node.id }));

    return {
      currentId,
      rootId: family.rootId,
      generatedAt: Date.now(),
      summary,
      agents: nodes,
      edges,
      tasks,
      timeline: limitedTimeline,
    };
  }
}
