import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { resolveSummariesDbPath } from './env.mjs';

let sqliteModulePromise = null;

async function loadNodeSqlite() {
  if (!sqliteModulePromise) {
    sqliteModulePromise = import('node:sqlite').catch(() => null);
  }
  return sqliteModulePromise;
}

function parseWorkspaceLabel(workspaceUris, projectId) {
  if (workspaceUris && typeof workspaceUris === 'string') {
    let first = '';
    const trimmed = workspaceUris.trim();
    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'string') {
          first = arr[0].trim();
        }
      } catch {
        // fall through to delimiter split
      }
    }
    if (!first) {
      first = trimmed.split(/[\n,;]+/).map(s => s.trim().replace(/^[\["']+|[\]"']+$/g, '')).filter(Boolean)[0] || '';
    }
    if (first) {
      let cleaned = first.replace(/^file:\/\/\//i, '').replace(/^file:\/\//i, '');
      try {
        cleaned = decodeURIComponent(cleaned);
      } catch {
        // ignore bad percent encoding
      }
      const norm = cleaned.replace(/[\\/]+$/, '');
      return {
        workspacePath: norm,
        workspaceName: basename(norm) || norm,
      };
    }
  }
  if (projectId && projectId !== 'outside-of-project') {
    return {
      workspacePath: projectId,
      workspaceName: projectId,
    };
  }
  return {
    workspacePath: '',
    workspaceName: 'Workspace',
  };
}

/**
 * Read conversation metadata from conversation_summaries.db in read-only mode.
 * Gracefully degrades to an empty map if SQLite is unavailable or locked.
 */
export async function readConversationMetaMap() {
  const map = new Map();
  const dbPath = resolveSummariesDbPath();
  if (!existsSync(dbPath)) {
    return map;
  }

  const sqlite = await loadNodeSqlite();
  if (!sqlite?.DatabaseSync) {
    return map;
  }

  let db = null;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    const stmt = db.prepare(`
      SELECT
        conversation_id,
        title,
        preview,
        step_count,
        last_modified_time,
        workspace_uris,
        status,
        project_id,
        agent_name,
        parent_conversation_id,
        nesting_depth,
        last_user_input_time
      FROM conversation_summaries
    `);
    const rows = stmt.all();
    for (const row of rows) {
      if (!row?.conversation_id) continue;
      const ws = parseWorkspaceLabel(row.workspace_uris, row.project_id);
      map.set(String(row.conversation_id), {
        conversationId: String(row.conversation_id),
        title: String(row.title || '').trim(),
        preview: String(row.preview || '').trim(),
        stepCount: Number(row.step_count) || 0,
        lastModifiedTime: String(row.last_modified_time || ''),
        workspaceUris: String(row.workspace_uris || ''),
        workspacePath: ws.workspacePath,
        workspaceName: ws.workspaceName,
        status: String(row.status || ''),
        projectId: String(row.project_id || ''),
        agentName: String(row.agent_name || ''),
        parentConversationId: String(row.parent_conversation_id || ''),
        nestingDepth: Number(row.nesting_depth) || 0,
        lastUserInputTime: String(row.last_user_input_time || ''),
      });
    }
  } catch {
    // Graceful fallback: caller will derive titles/timestamps from transcript files
  } finally {
    try {
      db?.close();
    } catch {
      // ignore close errors
    }
  }

  return map;
}
