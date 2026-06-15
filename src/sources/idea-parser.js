 'use strict';

 // src/sources/idea-parser.js
 //
 // Parse JetBrains AI Assistant log files into structured task records.
 //
 // Log line format (standard JetBrains):
 //   YYYY-MM-DD HH:MM:SS,mmm [   thread]   LEVEL - logger.name - free text message
 //
 // The parser reads ai-assistant.log or idea.log files, groups lines into
 // AI-assistant sessions (one request/response cycle), and returns task
 // records compatible with the CodexJournal-Lite task schema.
 //
 // Usage:
 //   const parser = require('./idea-parser');
 //   const tasks = parser.parseLogFile('/path/to/ai-assistant.log');
 //   // or scan a directory for all AI-related log files:
 //   const all = parser.parseLogDir('/path/to/JetBrains/log');

 const fs = require('fs');
 const path = require('path');
 const crypto = require('crypto');

 // Regex to parse standard JetBrains log line.
 // Groups: 1=date, 2=time, 3=millis, 4=thread, 5=level, 6=logger, 7=msg
 const LINE_RE = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}),(\d{3})\s+\[\s*(\d+)\]\s+(\w+)\s+-\s+([\w.#$]+)\s+-\s+(.+)$/;

 // Logger name prefixes that indicate AI-assistant activity.
 const AI_LOGGERS = new Set([
   'ai.assistant.session',
   'ai.assistant.prompt',
   'ai.assistant.llm',
   'ai.assistant.completion',
   'ai.assistant.stream',
   'ai.assistant.context',
   'ai.assistant.user',
   'ai.assistant.audit',
   'ai.assistant.config'
 ]);

 // Logger name regex for partial matches (e.g. JetBrains may prefix differently).
 const AI_LOGGER_RE = /ai\.assistant\./;

 // Session start markers in the message field (case-insensitive prefix).
 const SESSION_START_PATTERNS = [
   /^new\s+ai\s+assistant\s+session\s+opened/i,
   /^new\s+ai\s+assistant\s+chat\s+session\s+opened/i
 ];

 // Session end markers in the message field.
const SESSION_END_PATTERNS = [
  /chat\s+session\s+closed\s+by\s+user/i,
  /session\s+closed\s+by\s+user/i,
  /user\s+discarded\s+all/i
];

 // Minimum time gap (in ms) between consecutive AI lines to consider them
 // part of different sessions if no explicit session start/end is found.
 const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
 // After a session ends, absorb trailing metadata lines within this window.
 const SESSION_TRAILING_MS = 30 * 1000; // 30 seconds

 // -------- parsed line structure -------------------------------------
 function ParsedLine(raw, date, time, millis, thread, level, logger, msg) {
   this.raw = raw;
   this.date = date;
   this.time = time;
   this.millis = millis;
   this.timestampMs = new Date(date + 'T' + time + '.' + millis).getTime();
   this.thread = thread;
   this.level = level;
   this.logger = logger;
   this.msg = msg;
   this.isAi = false;
   this.isSessionStart = false;
   this.isSessionEnd = false;
 }

 // -------- line parsing --------------------------------------------

 function parseLine(raw) {
   const m = LINE_RE.exec(raw);
   if (!m) return null;
   const pl = new ParsedLine(raw, m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
   pl.isAi = AI_LOGGER_RE.test(pl.logger);
   if (pl.isAi) {
     for (const re of SESSION_START_PATTERNS) {
       if (re.test(pl.msg)) { pl.isSessionStart = true; break; }
     }
     if (!pl.isSessionStart) {
       for (const re of SESSION_END_PATTERNS) {
         if (re.test(pl.msg)) { pl.isSessionEnd = true; break; }
       }
     }
   }
   return pl;
 }

 // -------- session grouping ----------------------------------------
 //
 // Strategy: iterate sorted parsed lines.  Start a new session when:
 //   1. A line has isSessionStart === true, OR
 //   2. An AI line follows a non-AI line (or AI line from a different
 //      logger type after SESSION_TIMEOUT_MS has elapsed).
 // Close a session when:
 //   1. A line has isSessionEnd === true, OR
 //   2. A new session starts, OR
 //   3. SESSION_TIMEOUT_MS elapses between lines.

 function groupIntoSessions(lines) {
  const sessions = [];
  let current = null;
  let sessionClosedAt = 0;

  function flush() {
    if (current && current.aiLines.length > 0) {
      sessions.push(current);
    }
    current = null;
    sessionClosedAt = 0;
  }

  function ensureSession(line) {
    if (current) return;
    current = { start: line, end: null, aiLines: [line], allLines: [line] };
  }

  for (const pl of lines) {
    if (!pl.isAi) continue;

    if (pl.isSessionStart) {
      flush();
      current = { start: pl, end: null, aiLines: [pl], allLines: [pl] };
      continue;
    }

    if (sessionClosedAt > 0 && (pl.timestampMs - sessionClosedAt) <= SESSION_TRAILING_MS) {
      const lastSession = sessions[sessions.length - 1];
      if (lastSession) {
        lastSession.aiLines.push(pl);
        lastSession.allLines.push(pl);
        lastSession.end = pl;
      }
      continue;
    }

    if (current && current.aiLines.length > 0) {
      const last = current.aiLines[current.aiLines.length - 1];
      if (pl.timestampMs - last.timestampMs > 300000) {
        flush();
      }
    }

    ensureSession(pl);
    if (!current) continue;
    current.aiLines.push(pl);
    current.allLines.push(pl);

    if (pl.isSessionEnd) {
      current.end = pl;
      sessions.push(current);
      current = null;
      sessionClosedAt = pl.timestampMs;
    }
  }
  flush();
  return sessions;
}

// -------- task record extraction ------------------------------------

function extractTitle(session) {
  // Priority 1: explicit prompt lines.
  for (const pl of session.aiLines) {
    if (pl.logger !== 'ai.assistant.prompt') continue;
    const qm = pl.msg.match(/"([^"]+)"/);
    if (qm) return qm[1];
    const clean = pl.msg.replace(/^user\s+prompt:\s*/i, '').replace(/^sending\s+prompt\s+to\s+llm\s+model:\s*/i, '');
    if (clean.length > 0 && clean.length <= 80) return clean;
  }
  // Priority 2: session metadata (skip "New AI Assistant session opened").
  for (const pl of session.aiLines) {
    if (pl.logger !== 'ai.assistant.session') continue;
    if (/^new\s+ai\s+assistant\s+session/i.test(pl.msg)) continue;
    const qm = pl.msg.match(/"([^"]+)"/);
    if (qm) return qm[1];
    const clean = pl.msg.replace(/^(user\s+accepted|chat\s+history\s+compacted|daily\s+prompt\s+token)/i, '').trim();
    if (clean.length > 5 && clean.length <= 80) return clean;
  }
  // Priority 3: first non-session AI line.
  for (const pl of session.aiLines) {
    if (pl.logger === 'ai.assistant.session') continue;
    const clean = pl.msg.replace(/["']/g, '').trim();
    if (clean.length > 0 && clean.length <= 80) return clean;
  }
  return 'IDEA AI Assistant session';
}

 function extractKeywords(session) {
   const words = new Set();
   const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in',
     'for', 'on', 'this', 'that', 'with', 'from', 'by', 'at', 'and', 'or', 'be', 'it']);
   function addWords(text) {
     const tokens = (text || '').toLowerCase().split(/[^a-zA-Z0-9]+/).filter(Boolean);
     for (const t of tokens) {
       if (t.length >= 3 && !stopWords.has(t)) words.add(t);
     }
   }
   for (const pl of session.aiLines) {
     addWords(pl.msg);
   }
   return Array.from(words).slice(0, 10);
 }

 function classifyTaskType(session) {
   const text = session.aiLines.map(pl => pl.msg).join(' ').toLowerCase();
   if (/debug|error|exception|fix|bug|broken|wrong|issue/i.test(text)) return 'debug';
   if (/refactor|rewrite|improve|clean|optimize|extract/i.test(text)) return 'refactor';
   if (/explain|summarize|what is|how does|tell me|understand/i.test(text)) return 'explain';
   if (/test|assert|mock|coverage|spec/i.test(text)) return 'test';
   if (/write|create|implement|add|build|generate|make/i.test(text)) return 'codex';
   if (/config|configure|setup|install|docker|environment/i.test(text)) return 'environment';
   if (/document|doc|comment|readme|docs/i.test(text)) return 'document';
   if (/review|check|validate|audit|inspect/i.test(text)) return 'review';
   return 'general';
 }

 function buildUserSummary(session) {
   const prompts = session.aiLines
     .filter(pl => pl.logger === 'ai.assistant.prompt' || pl.logger === 'ai.assistant.session')
     .map(pl => pl.msg.replace(/"([^"]+)"/g, '$1').replace(/^(Sending prompt to LLM model|User prompt):\s*/i, ''))
     .filter(Boolean);
   if (prompts.length === 0) return 'AI Assistant interaction logged';
   return prompts.join('; ').slice(0, 300);
 }

 function buildAssistantSummary(session) {
   const responses = session.aiLines
     .filter(pl => pl.logger === 'ai.assistant.completion' || pl.logger === 'ai.assistant.stream' || pl.logger === 'ai.assistant.llm')
     .map(pl => pl.msg.replace(/"([^"]+)"/g, '$1'))
     .filter(Boolean);
   if (responses.length === 0) return 'Assistant processed the request';
   return responses.join('; ').slice(0, 300);
 }

 function shortHash(str) {
   return crypto.createHash('md5').update(String(str)).digest('hex').slice(0, 8);
 }

 function sessionToTask(session, filePath) {
   const first = session.aiLines[0];
   const last = session.aiLines[session.aiLines.length - 1];
   const title = extractTitle(session);
   const taskType = classifyTaskType(session);
   const keywords = extractKeywords(session);
   const date = first.date;
   const time = first.time;

   const hashInput = filePath + '|' + first.timestampMs + '|' + title;
   const id = 'idea_' + shortHash(hashInput);

   return {
     id,
     date,
     time,
     source: 'idea-ai',
     projectPath: null, // IDEA logs don't record project path per session
     title,
     taskType,
     keywords,
     userSummary: buildUserSummary(session),
     assistantSummary: buildAssistantSummary(session),
     rawFilePath: filePath,
     messageCount: session.aiLines.length,
     firstTimestamp: new Date(first.timestampMs).toISOString(),
     lastTimestamp: new Date(last.timestampMs).toISOString()
   };
 }

 // -------- main entry points ----------------------------------------

 function parseLogFile(filePath) {
   const tasks = [];
   let content;
   try {
     content = fs.readFileSync(filePath, 'utf8');
   } catch (err) {
     return { errors: [{ path: filePath, err: err.message }], tasks: [] };
   }

   const lines = content.split(/\r?\n/);
   const parsed = [];
   const errors = [];

   for (let i = 0; i < lines.length; i++) {
     const raw = lines[i];
     if (!raw.trim()) continue;
     const pl = parseLine(raw);
     if (pl) {
       parsed.push(pl);
     }
   }

   const sessions = groupIntoSessions(parsed);
   for (const session of sessions) {
     const task = sessionToTask(session, filePath);
     tasks.push(task);
   }

   return { tasks, errors, totalLines: lines.length, parsedLines: parsed.length, sessionsFound: sessions.length };
 }

 function parseLogDir(dirPath, recursive) {
   const allTasks = [];
   const allErrors = [];
   let totalFiles = 0;

   let entries;
   try {
     entries = fs.readdirSync(dirPath, { withFileTypes: true });
   } catch (err) {
     return { tasks: [], errors: [{ kind: 'readdir', path: dirPath, err: err.message }] };
   }

   const logFiles = [];
   for (const ent of entries) {
     if (!ent.isFile()) {
       if (recursive && ent.isDirectory()) {
         const sub = parseLogDir(path.join(dirPath, ent.name), recursive);
         allTasks.push(...sub.tasks);
         allErrors.push(...sub.errors);
         totalFiles += sub.totalFiles || 0;
       }
       continue;
     }
     const ext = path.extname(ent.name).toLowerCase();
     if (ext !== '.log' && ext !== '.txt') continue;
     // Focus on AI-relevant log files.
     const lower = ent.name.toLowerCase();
     if (!lower.includes('ai') && !lower.includes('assistant')) continue;
     logFiles.push(path.join(dirPath, ent.name));
   }

   for (const fp of logFiles) {
     totalFiles++;
     const result = parseLogFile(fp);
     allTasks.push(...result.tasks);
     if (result.errors && result.errors.length > 0) {
       allErrors.push(...result.errors);
     }
   }

   return { tasks: allTasks, errors: allErrors, totalFiles };
 }

 function parseLogFiles(filePaths) {
   const allTasks = [];
   const allErrors = [];
   for (const fp of filePaths) {
     const result = parseLogFile(fp);
     allTasks.push(...result.tasks);
     if (result.errors && result.errors.length > 0) {
       allErrors.push(...result.errors);
     }
   }
   return { tasks: allTasks, errors: allErrors, filesProcessed: filePaths.length };
 }

 // -------- exports ---------------------------------------------------

 module.exports = {
   parseLogFile,
   parseLogDir,
   parseLogFiles,
   // For testing only.
   _internal: {
     parseLine,
     groupIntoSessions,
     extractTitle,
     extractKeywords,
     classifyTaskType,
     buildUserSummary,
     buildAssistantSummary,
     sessionToTask,
     LINE_RE,
     AI_LOGGER_RE,
     SESSION_START_PATTERNS,
     SESSION_END_PATTERNS,
     SESSION_TIMEOUT_MS
   }
 };
