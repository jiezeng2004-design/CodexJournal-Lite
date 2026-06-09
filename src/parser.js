'use strict';

const fs = require('fs');

// Parse a single jsonl/transcript file into a normalized list of messages.
// Each message: { timestamp (Date|null), role, kind, content, raw, lineNo }.
// A single bad line must NOT crash the whole file.
//
// Recognized Codex roll-out shapes:
//   1. Top-level event:
//        { "timestamp": "...", "type": "session_meta",  "payload": { cwd, ... } }
//        { "timestamp": "...", "type": "event_msg",     "payload": { type: "user_message"|"agent_message"|"agent_reasoning"|..., message|sender|... } }
//        { "timestamp": "...", "type": "response_item", "payload": { type: "message"|"reasoning"|"function_call"|..., role, content, ... } }
//        { "timestamp": "...", "type": "turn_context",  "payload": { ... } }
//   2. Generic OpenAI-style:
//        { "timestamp": "...", "role": "user|assistant|system", "content": "..." | [...] }

const KIND_FROM_ROLE = {
  user: 'user',
  assistant: 'assistant',
  system: 'system',
  developer: 'system',
  tool: 'assistant',
  function: 'assistant',
  model: 'assistant',
  ai: 'assistant',
  human: 'user'
};

function readLines(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line == null) continue;
    if (line.trim().length === 0) continue;
    out.push({ line, lineNo: i + 1 });
  }
  return out;
}

function parseTimestamp(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    let n = value;
    if (n > 1e12) {
      const d = new Date(n);
      return isNaN(d.getTime()) ? null : d;
    }
    if (n > 1e9) {
      const d = new Date(n * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      const ms = s.length <= 10 ? n * 1000 : n;
      const d2 = new Date(ms);
      if (!isNaN(d2.getTime())) return d2;
    }
    return null;
  }
  return null;
}

function extractTimestamp(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const candidates = [
    obj.timestamp,
    obj.time,
    obj.ts,
    obj.created_at,
    obj.createdAt,
    obj.event_time,
    obj.eventTime,
    obj.payload && obj.payload.timestamp
  ];
  for (const c of candidates) {
    const d = parseTimestamp(c);
    if (d) return d;
  }
  return null;
}

function extractContentPart(part) {
  if (part == null) return '';
  if (typeof part === 'string') return part;
  if (typeof part === 'object') {
    if (typeof part.text === 'string') return part.text;
    if (typeof part.input_text === 'string') return part.input_text;
    if (typeof part.output_text === 'string') return part.output_text;
    if (typeof part.content === 'string') return part.content;
    if (Array.isArray(part.content)) {
      return part.content.map(extractContentPart).filter(Boolean).join('\n');
    }
  }
  return '';
}

function extractContentArray(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.map(extractContentPart).filter(Boolean).join('\n');
}

function extractSessionMetaCwd(obj) {
  if (!obj || obj.type !== 'session_meta') return null;
  const p = obj.payload;
  if (!p) return null;
  if (typeof p.cwd === 'string') return p.cwd;
  if (typeof p.working_directory === 'string') return p.working_directory;
  return null;
}

function detectEventMessageKind(obj) {
  // Returns one of: 'user' | 'assistant' | 'system' | 'other'
  if (!obj || typeof obj !== 'object') return 'other';
  const top = obj.type;
  const payload = obj.payload;
  if (top === 'event_msg' && payload && typeof payload === 'object') {
    const pt = payload.type;
    if (pt === 'user_message') return 'user';
    if (pt === 'agent_message' || pt === 'agent_reasoning') return 'assistant';
    // task_started / token_count / thread_name_updated / exec_command_end / ...
    return 'other';
  }
  if (top === 'response_item' && payload && typeof payload === 'object') {
    const pt = payload.type;
    if (pt === 'message') {
      const role = payload.role || (payload.message && payload.message.role);
      return kindFromRoleString(role);
    }
    if (pt === 'reasoning') return 'assistant';
    if (pt === 'function_call' || pt === 'function_call_output' || pt === 'web_search_call') return 'other';
    return 'other';
  }
  if (top === 'session_meta' || top === 'turn_context') return 'other';
  // Fallback: top-level role
  return kindFromRoleString(obj.role || (payload && payload.role));
}

function kindFromRoleString(role) {
  if (typeof role !== 'string') return 'other';
  return KIND_FROM_ROLE[role.toLowerCase()] || 'other';
}

function extractEventMessageContent(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const top = obj.type;
  const payload = obj.payload;
  if (top === 'event_msg' && payload && typeof payload === 'object') {
    const pt = payload.type;
    if (pt === 'user_message') {
      // Codex CLI shape: payload.message is array of {type, text} | strings
      if (typeof payload.message === 'string') return payload.message;
      if (Array.isArray(payload.message)) return extractContentArray(payload.message);
      if (Array.isArray(payload.content)) return extractContentArray(payload.content);
      if (typeof payload.text === 'string') return payload.text;
      return '';
    }
    if (pt === 'agent_message') {
      if (typeof payload.message === 'string') return payload.message;
      if (Array.isArray(payload.message)) return extractContentArray(payload.message);
      if (Array.isArray(payload.content)) return extractContentArray(payload.content);
      if (typeof payload.text === 'string') return payload.text;
      return '';
    }
    if (pt === 'agent_reasoning') {
      if (typeof payload.text === 'string') return payload.text;
      if (Array.isArray(payload.content)) return extractContentArray(payload.content);
      return '';
    }
    return '';
  }
  if (top === 'response_item' && payload && typeof payload === 'object') {
    const pt = payload.type;
    if (pt === 'message') {
      // payload.message.content[] or payload.content[]
      if (payload.message) {
        if (typeof payload.message.content === 'string') return payload.message.content;
        if (Array.isArray(payload.message.content)) return extractContentArray(payload.message.content);
        if (typeof payload.message.text === 'string') return payload.message.text;
      }
      if (typeof payload.content === 'string') return payload.content;
      if (Array.isArray(payload.content)) return extractContentArray(payload.content);
      return '';
    }
    if (pt === 'reasoning') {
      if (Array.isArray(payload.summary)) return payload.summary.map(extractContentPart).filter(Boolean).join('\n');
      if (typeof payload.text === 'string') return payload.text;
      if (Array.isArray(payload.content)) return extractContentArray(payload.content);
      return '';
    }
    return '';
  }
  // Generic fallback
  if (typeof obj.content === 'string') return obj.content;
  if (Array.isArray(obj.content)) return extractContentArray(obj.content);
  if (typeof obj.text === 'string') return obj.text;
  return '';
}

function parseFile(filePath) {
  const messages = [];
  const errors = [];
  let lines;
  try {
    lines = readLines(filePath);
  } catch (err) {
    return { messages, errors: [{ lineNo: 0, err: err.message }] };
  }
  for (const { line, lineNo } of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      errors.push({ lineNo, err: 'json-parse: ' + err.message, raw: line.slice(0, 200) });
      continue;
    }
    const ts = extractTimestamp(obj);
    const kind = detectEventMessageKind(obj);
    const role = kind; // alias for compatibility
    let content = extractEventMessageContent(obj);
    if (!content && kind === 'user') content = '';
    messages.push({
      timestamp: ts,
      role,
      kind,
      content: content || '',
      raw: obj,
      lineNo
    });
  }
  return { messages, errors };
}

module.exports = {
  parseFile,
  parseTimestamp,
  extractTimestamp,
  extractSessionMetaCwd,
  detectEventMessageKind,
  extractEventMessageContent
};
