 'use strict';

 // src/sources/claude.js
 //
 // Source module stub for Claude Code (Anthropic) AI coding sessions.
 //
 // Claude Code stores conversations in ~/.claude/sessions/ as JSONL files.
 // This module provides the source registry metadata and a read-only probe.
 //
 // Status: FRAMEWORK ONLY. Full parsing is not yet implemented.
 //
 // When parsing is implemented, the expected log shape is:
 //   ~/.claude/sessions/YYYY-MM-DD/
 //     conversation-{uuid}.jsonl
 //       {"role": "user", "content": "..."}
 //       {"role": "assistant", "content": "..."}
 //
 // The source must produce task records with the same 14-field schema
 // as Codex sessions (see src/writer.js task structure).

 const fs = require('fs');
 const path = require('path');

 function getSessionsDir() {
   const home = process.env.HOME || process.env.USERPROFILE || '';
   return path.join(home, '.claude', 'sessions');
 }

 function describe() {
   return {
     name: 'claude-code',
     type: 'claude',
     enabled: true,
     sessionsDir: getSessionsDir(),
     notes: 'Stub source module. Claude Code parsing is not yet implemented. Registering this source enables future archive integration.'
   };
 }

 // Read-only probe: walks ~/.claude/sessions, counts JSONL files.
 function probe() {
   const dir = getSessionsDir();
   const result = { source: 'claude-code', scannedAt: new Date().toISOString(), sessionsDir: dir, exists: false, files: 0, note: '' };
   try {
     if (fs.existsSync(dir)) {
       result.exists = true;
       const entries = fs.readdirSync(dir, { withFileTypes: true });
       for (const e of entries) {
         if (!e.isDirectory()) continue;
         const sub = path.join(dir, e.name);
         try {
           const files = fs.readdirSync(sub).filter(f => f.endsWith('.jsonl'));
           result.files += files.length;
         } catch (_) {}
       }
       result.note = result.files > 0 ? (result.files + ' session file(s) found') : 'No sessions found yet';
     } else {
       result.note = 'Sessions directory does not exist';
     }
   } catch (err) {
     result.note = 'Error: ' + err.message;
   }
   return result;
 }

 module.exports = { describe, probe, getSessionsDir };
