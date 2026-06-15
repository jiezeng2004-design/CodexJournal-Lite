 'use strict';

 // src/sources/idea-parser.test.js
 //
 // Offline test for the IDEA AI Assistant log parser.
 // Uses the synthetic log tree under test-fixtures/idea-logs/.
 // Run via: `npm run test:sources` (or directly: `node src/sources/idea-parser.test.js`)
 //
 // exit 0 on success, exit 1 on any failure

 const fs = require('fs');
 const path = require('path');
 const parser = require('./idea-parser');

 let passed = 0;
 let failed = 0;
 const failures = [];

 function check(label, cond, detail) {
   if (cond) {
     passed += 1;
     process.stdout.write('  [PASS] ' + label + '\n');
   } else {
     failed += 1;
     failures.push({ label, detail: detail || '(no detail)' });
     process.stdout.write('  [FAIL] ' + label + (detail ? (' :: ' + detail) : '') + '\n');
   }
 }

 function section(name) {
   process.stdout.write('\n--- ' + name + ' ---\n');
 }

 const projectRoot = path.resolve(__dirname, '..', '..');
 const aiLog = path.join(projectRoot, 'test-fixtures', 'idea-logs', 'JetBrains', 'PyCharm2025.3', 'log', 'ai-assistant.log');
 const ideaLog = path.join(projectRoot, 'test-fixtures', 'idea-logs', 'JetBrains', 'PyCharm2025.3', 'log', 'idea.log');

 section('fixture paths');
 check('ai-assistant.log exists', fs.existsSync(aiLog), aiLog);
 check('idea.log exists', fs.existsSync(ideaLog), ideaLog);

 // -------- parse ai-assistant.log (2 sessions) -----------------------
 section('parse ai-assistant.log');

 const aiResult = parser.parseLogFile(aiLog);
 check('parseLogFile returns an object', aiResult && typeof aiResult === 'object');
 check('ai-assistant.log: 2 sessions found', aiResult.sessionsFound === 2,
   'got ' + aiResult.sessionsFound);
 check('ai-assistant.log: 2 tasks extracted', aiResult.tasks.length === 2,
   'got ' + aiResult.tasks.length + ' tasks');
 check('ai-assistant.log: no errors', aiResult.errors.length === 0,
   'errors: ' + JSON.stringify(aiResult.errors));
 check('ai-assistant.log: parsed lines > 0', aiResult.parsedLines > 0,
   'parsedLines=' + aiResult.parsedLines);

 const task0 = aiResult.tasks[0];
 const task1 = aiResult.tasks[1];

 // Task 0: "summarize the current open file"
 check('task0: title from prompt', task0.title === 'summarize the current open file',
   'got: ' + task0.title);
 check('task0: source is idea-ai', task0.source === 'idea-ai', task0.source);
 check('task0: date is 2026-02-15', task0.date === '2026-02-15', task0.date);
 check('task0: taskType is explain', task0.taskType === 'explain', task0.taskType);
 check('task0: messageCount >= 5', task0.messageCount >= 5,
   'msgCount=' + task0.messageCount);
 check('task0: has keywords', Array.isArray(task0.keywords) && task0.keywords.length >= 3,
   'keywords=' + JSON.stringify(task0.keywords));
 check('task0: userSummary is non-empty', typeof task0.userSummary === 'string' && task0.userSummary.length > 10,
   'userSummary=' + task0.userSummary.slice(0, 60));
 check('task0: assistantSummary is non-empty', typeof task0.assistantSummary === 'string' && task0.assistantSummary.length > 10,
   'assistantSummary=' + task0.assistantSummary.slice(0, 60));
 check('task0: firstTimestamp is valid ISO', task0.firstTimestamp && !isNaN(Date.parse(task0.firstTimestamp)),
   'firstTimestamp=' + task0.firstTimestamp);
 check('task0: lastTimestamp is valid ISO', task0.lastTimestamp && !isNaN(Date.parse(task0.lastTimestamp)),
   'lastTimestamp=' + task0.lastTimestamp);
 check('task0: firstTimestamp <= lastTimestamp',
   new Date(task0.firstTimestamp).getTime() <= new Date(task0.lastTimestamp).getTime(),
   task0.firstTimestamp + ' > ' + task0.lastTimestamp);
 check('task0: id starts with idea_', task0.id.startsWith('idea_'), task0.id);
 check('task0: rawFilePath includes ai-assistant', task0.rawFilePath && task0.rawFilePath.indexOf('ai-assistant.log') >= 0,
   'rawFilePath=' + task0.rawFilePath);
 check('task0: projectPath is null', task0.projectPath === null, String(task0.projectPath));

 // Task 1: "refactor this helper to be async"
 check('task1: title from prompt', task1.title === 'refactor this helper to be async',
   'got: ' + task1.title);
 check('task1: source is idea-ai', task1.source === 'idea-ai', task1.source);
 check('task1: date is 2026-02-15', task1.date === '2026-02-15', task1.date);
 check('task1: taskType is refactor', task1.taskType === 'refactor', task1.taskType);
 check('task1: messageCount >= 8', task1.messageCount >= 8,
   'msgCount=' + task1.messageCount);
 check('task1: id is different from task0', task1.id !== task0.id,
   task1.id + ' vs ' + task0.id);
 check('task1: firstTimestamp > task0.lastTimestamp',
   new Date(task1.firstTimestamp).getTime() > new Date(task0.lastTimestamp).getTime(),
   task1.firstTimestamp + ' <= ' + task0.lastTimestamp);

 // -------- parse idea.log (no AI sessions) -------------------------
 section('parse idea.log (no false positives)');

 const ideaResult = parser.parseLogFile(ideaLog);
 check('idea.log: 0 sessions', ideaResult.sessionsFound === 0,
   'got ' + ideaResult.sessionsFound);
 check('idea.log: 0 tasks', ideaResult.tasks.length === 0,
   'got ' + ideaResult.tasks.length + ' tasks');
 check('idea.log: no errors', ideaResult.errors.length === 0,
   'errors: ' + JSON.stringify(ideaResult.errors));

 // -------- parseLogDir ---------------------------------------------
 section('parseLogDir');

 const logDir = path.dirname(aiLog);
 const dirResult = parser.parseLogDir(logDir);
 check('parseLogDir returns same tasks as parseLogFile', dirResult.tasks.length >= 2,
   'got ' + dirResult.tasks.length + ' tasks');
 check('dirResult: no errors', Array.isArray(dirResult.errors) && dirResult.errors.length === 0,
   'errors: ' + JSON.stringify(dirResult.errors));
 check('dirResult: totalFiles >= 1', dirResult.totalFiles >= 1,
   'totalFiles=' + dirResult.totalFiles);

 // -------- parseLogFiles -------------------------------------------
 section('parseLogFiles (batch)');

 const batchResult = parser.parseLogFiles([aiLog, ideaLog]);
 check('batch: total tasks = 2', batchResult.tasks.length === 2,
   'got ' + batchResult.tasks.length);
 check('batch: filesProcessed = 2', batchResult.filesProcessed === 2,
   'filesProcessed=' + batchResult.filesProcessed);
 check('batch: no errors', batchResult.errors.length === 0,
   'errors: ' + JSON.stringify(batchResult.errors));

 // -------- classifyTaskType ----------------------------------------
 section('_internal: classifyTaskType');

 const internal = parser._internal;
 check('classifyTaskType("debug") returns "debug"',
   internal.classifyTaskType({ aiLines: [{ msg: 'This is a debug task for fixing a bug' }] }) === 'debug');
 check('classifyTaskType("refactor") returns "refactor"',
   internal.classifyTaskType({ aiLines: [{ msg: 'Refactor this class to improve performance' }] }) === 'refactor');
 check('classifyTaskType("explain") returns "explain"',
   internal.classifyTaskType({ aiLines: [{ msg: 'Explain how this algorithm works' }] }) === 'explain');
 check('classifyTaskType("codex") returns "codex"',
   internal.classifyTaskType({ aiLines: [{ msg: 'Write a new component for the login page' }] }) === 'codex');
 check('classifyTaskType("test") returns "test"',
   internal.classifyTaskType({ aiLines: [{ msg: 'Write unit tests for the service layer' }] }) === 'test');
 check('classifyTaskType("environment") returns "environment"',
   internal.classifyTaskType({ aiLines: [{ msg: 'Configure Docker for the development environment' }] }) === 'environment');
 check('classifyTaskType("general") returns "general"',
   internal.classifyTaskType({ aiLines: [{ msg: 'Hello world, how are you?' }] }) === 'general');

 // -------- extractTitle (prompt priority) --------------------------
 section('_internal: extractTitle');

 function makeSession(lines) {
   return { aiLines: lines.map(function(l) { return { logger: 'ai.assistant.prompt', msg: l }; }) };
 }
 check('extractTitle: extracts quoted text',
   internal.extractTitle({ aiLines: [{ logger: 'ai.assistant.prompt', msg: 'User prompt: "hello world"' }] }) === 'hello world');
 check('extractTitle: cleans prompt prefix',
   internal.extractTitle({ aiLines: [{ logger: 'ai.assistant.prompt', msg: 'User prompt: write tests' }] }) === 'write tests');
 check('extractTitle: non-prompt fallback to non-session lines',
   internal.extractTitle({ aiLines: [
     { logger: 'ai.assistant.session', msg: 'New AI Assistant session opened' },
     { logger: 'ai.assistant.completion', msg: 'LLM response received, 1 completion candidate returned' }
   ] }) === 'LLM response received, 1 completion candidate returned');

 // -------- extractKeywords -----------------------------------------
 section('_internal: extractKeywords');

 const kwResult = internal.extractKeywords({ aiLines: [{ msg: 'Fix the authentication bug in the login module' }] });
 check('extractKeywords: returns array of keywords', Array.isArray(kwResult));
 check('extractKeywords: contains "authentication"', kwResult.indexOf('authentication') >= 0,
   'got: ' + JSON.stringify(kwResult));
 check('extractKeywords: contains "login"', kwResult.indexOf('login') >= 0,
   'got: ' + JSON.stringify(kwResult));
 check('extractKeywords: excludes stop words like "the"', kwResult.indexOf('the') === -1,
   'got: ' + JSON.stringify(kwResult));

 // -------- edge cases ---------------------------------------------
 section('edge cases');

 // Empty file
 const emptyResult = parser.parseLogFile(aiLog + '.nonexistent');
 check('parseLogFile: returns tasks/errors on nonexistent file',
   Array.isArray(emptyResult.tasks) && Array.isArray(emptyResult.errors) && emptyResult.errors.length >= 1,
   'tasks=' + emptyResult.tasks.length + ' errors=' + emptyResult.errors.length);

 // Empty directory
 const emptyDir = path.join(projectRoot, 'reports', '.tmp');
 const emptyDirResult = parser.parseLogDir(emptyDir, false);
 check('parseLogDir: empty dir returns 0 tasks', emptyDirResult.tasks.length === 0,
   'got ' + emptyDirResult.tasks.length + ' tasks');

 section('result');
 process.stdout.write('\n');
 process.stdout.write('passed: ' + passed + '\n');
 process.stdout.write('failed: ' + failed + '\n');
 if (failed > 0) {
   process.stdout.write('\nFAILURES:\n');
   for (const f of failures) {
     process.stdout.write('  - ' + f.label + ' :: ' + f.detail + '\n');
   }
   process.exit(1);
 }
 process.exit(0);
