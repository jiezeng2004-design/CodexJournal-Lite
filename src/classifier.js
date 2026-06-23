'use strict';

// Lightweight, deterministic task classifier. No AI calls.
// taskType is one of:
//   thesis | document | code | environment | frontend | zotero | openclaw | codex | general

const TYPE_RULES = [
  { type: 'thesis', re: /(毕业论文|thesis|苜[蓁]?|紫花苜蓿|MsCCD|基因|耐旱|抗旱|答辩|开题|文献综述|论文章节)/i },
  { type: 'document', re: /(word|\.docx|论文排版|降重|答辩稿|ppt|pptx|演示文稿|wps|markdown|\.md\b|参考文献格式)/i },
  { type: 'zotero', re: /(zotero|参考文献|引文|citation|\.csl|ris|bibtex)/i },
  { type: 'openclaw', re: /(openclaw|clawd|open\s?claw|gateway|dashboard|127\.0\.0\.1:1879|18789|18790)/i },
  { type: 'codex', re: /(codex|computer\s?use|node_repl|setup refresh)/i },
  { type: 'frontend', re: /(前端|html|css|js|ts|react|vite|vue|tailwind|页面|布局|dev\s?server|npm\s+run\s+dev|localhost:?\d{2,5})/i },
  { type: 'environment', re: /(环境|排错|报错|权限|端口|防火墙|服务|计划任务|powershell|cmd|wsl|node\s?-?v|npm)/i },
  { type: 'code', re: /(代码|脚本|python|javascript|typescript|node\.js|function|class|import\s+|require\(|let\s+|const\s+|var\s+|\.py\b|\.js\b|\.ts\b|\.json\b|git\s+(add|commit|push|status|log))/i }
];

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'i', 'you', 'we', 'they',
  'this', 'that', 'these', 'those', 'it', 'its', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'and', 'or', 'but', 'if', 'as', 'by', 'from', 'into', 'about', 'over', 'under', 'up', 'down',
  'do', 'does', 'did', 'done', 'have', 'has', 'had', 'can', 'could', 'should', 'would', 'will',
  'shall', 'may', 'might', 'must', 'not', 'no', 'so', 'than', 'then', 'there', 'here', 'what',
  'which', 'who', 'whom', 'whose', 'why', 'how', 'when', 'where', 'all', 'any', 'some', 'my',
  'your', 'our', 'their', 'me', 'him', 'her', 'us', 'them', 'one', 'two', 'three',
  'user', 'users', 'admin', 'root', 'home', 'path', 'file', 'files', 'line', 'lines', 'use',
  'used', 'using', 'true', 'false', 'null', 'none', 'name', 'value', 'type', 'tool', 'call',
  'output', 'input', 'error', 'ok', 'yes', 'no', 'on', 'off', 'set', 'get', 'new', 'old',
  '请', '帮我', '你好', '我想', '可以', '好的', '谢谢', '一下', '这个', '那个', '现在', '然后',
  '因为', '所以', '如果', '但是', '而且', '或者', '已经', '需要', '想要', '感觉', '觉得',
  '问题', '怎么', '如何', '为什么', '什么', '哪里', '一下', '上面', '下面', '里面', '什么',
  '做', '是', '在', '有', '和', '与', '的', '了', '我', '你', '他', '她', '它', '们', '把',
  '一', '个', '些', '这', '那', '么', '说', '让', '给', '看', '想', '能', '会', '要', '就'
]);

const CN_HINT = /[一-鿿]/;

// Strip system / project context that Codex CLI injects into the first
// user message of every session. Without this filter the entire "AGENTS.md
// instructions" preamble, the "<INSTRUCTIONS>...</INSTRUCTIONS>" block and
// the "<environment_context>...</environment_context>" block dominate the
// user text, the title, the keyword extraction, and the task-type guess.
//
// We strip, in this order:
//   1. `# AGENTS.md instructions ...` heading line(s)
//   2. `<INSTRUCTIONS>...</INSTRUCTIONS>` block
//   3. `--- project-doc ---` fenced sections
//   4. `<environment_context>...</environment_context>` block
//   5. The "Codex agent history ... TRANSCRIPT END" approval-request prompt
//      (Codex injects this verbatim into the user message whenever it asks
//      the model to evaluate a previous action).
//   6. The ">>> TRANSCRIPT START ... <<< TRANSCRIPT END" transcript block
//      (paired with the above).
//   7. The "# Files mentioned / referenced by the user:" attachment header.
//   8. Any other multi-line `<tag>...</tag>` injection (permissions, app-
//      context, skills_instructions, plugins_instructions, etc.).
function stripProjectContext(text) {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/^[ \t]*#\s*AGENTS\.md[^\n]*\n+/gim, ' ');
  s = s.replace(/<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gi, ' ');
  // "--- project-doc ---" ... up to next "---" delimiter or end of string.
  s = s.replace(/(^|\r?\n)[ \t]*---[ \t]*project-doc[ \t]*---[\s\S]*?(?=(^|\r?\n)[ \t]*---[ \t]*\r?\n|$)/gi, ' ');
  s = s.replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, ' ');
  // "The following is the Codex agent history ..." approval-evaluation prompt.
  // Ends either with the in-prompt transcript closer (">>> TRANSCRIPT END"
  // or "<<< TRANSCRIPT END") or with the post-transcript approval request
  // (">>> APPROVAL REQUEST END"), depending on Codex CLI version.
  s = s.replace(/The following is the Codex agent history[\s\S]*?(>>>\s*(?:TRANSCRIPT END|APPROVAL REQUEST END)|<<<\s*TRANSCRIPT END)/gi, ' ');
  // ">>> TRANSCRIPT START ... <<< TRANSCRIPT END" or "... >>> APPROVAL REQUEST END".
  s = s.replace(/>>>\s*TRANSCRIPT START[\s\S]*?(>>>\s*(?:TRANSCRIPT END|APPROVAL REQUEST END)|<<<\s*TRANSCRIPT END)/gi, ' ');
  // ">>> APPROVAL REQUEST START ... >>> APPROVAL REQUEST END" block.
  s = s.replace(/>>>\s*APPROVAL REQUEST START[\s\S]*?>>>\s*APPROVAL REQUEST END/gi, ' ');
  // "Reviewed Codex session id: ..." - the user /review CLI invocation. Keep
  // the prefix as a marker of intent, but drop the trailing approval block
  // (handled above) and the boilerplate "Some conversation entries were
  // omitted. The Codex agent has requested the following action:" line.
  s = s.replace(/\bSome conversation entries were omitted\.[\s\S]*?action:\s*/gi, ' ');
  // "# Files mentioned by the user:" / "# Files referenced by the user:" header
  // and everything until the next blank line + capitalised heading, or EOS.
  s = s.replace(/^#\s*Files\s+(?:mentioned|referenced)\s+by\s+the\s+user:[\s\S]*?(?=\r?\n\r?\n[^\s]|\Z)/gim, ' ');
  // Generic multi-line <tag>...</tag> injection (permissive, last resort).
  s = s.replace(/<([A-Za-z][\w-]*)>[\s\S]{20,}?<\/\1>/g, ' ');
  // Collapse whitespace and strip control chars.
  s = s.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return s;
}

function isOnlyProjectContext(text) {
  if (!text) return true;
  const stripped = stripProjectContext(text);
  return stripped.length === 0;
}

function classifyText(text) {
  if (!text) return 'general';
  for (const rule of TYPE_RULES) {
    if (rule.re.test(text)) return rule.type;
  }
  return 'general';
}

// Credential-like tokens that should never be treated as keywords.
const CREDENTIAL_RE = /^(sk-[a-z0-9_\-]+|gh[pousr]_[a-z0-9]+|xox[baprs]-[a-z0-9\-]+|token|api_key|apikey|password|secret|access_token|refresh_token|bearer|authorization|connect\.sid|sessionid)$/i;

function isCredentialToken(token) {
  if (!token || typeof token !== 'string') return false;
  return CREDENTIAL_RE.test(token);
}

function tokenize(text) {
  if (!text) return [];
  const out = [];
  // English / file-path tokens
  const enTokens = text.toLowerCase().match(/[a-z][a-z0-9_.\-]{2,}/g) || [];
  for (const t of enTokens) {
    if (STOPWORDS.has(t)) continue;
    if (isCredentialToken(t)) continue;
    out.push(t);
  }
  // Chinese bigrams
  const cnRuns = text.match(/[一-鿿]{2,}/g) || [];
  for (const run of cnRuns) {
    if (run.length === 2) {
      if (!STOPWORDS.has(run)) out.push(run);
    } else {
      for (let i = 0; i < run.length - 1; i++) {
        const bg = run.slice(i, i + 2);
        if (!STOPWORDS.has(bg)) out.push(bg);
      }
    }
  }
  // File extensions as tokens
  const exts = text.match(/\.[a-z0-9]{1,5}\b/g) || [];
  for (const e of exts) out.push(e.toLowerCase());
  return out;
}

function topKeywords(text, maxN) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];
  const freq = new Map();
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  // Stable secondary sort: by token string for determinism.
  const arr = Array.from(freq.entries());
  arr.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  return arr.slice(0, maxN).map(([t, c]) => ({ token: t, count: c }));
}

function makeTitle(userText, maxLen) {
  const cap = maxLen || 50;
  if (!userText) return '(untitled)';
  // Always strip Codex CLI's project / environment preamble first.
  let cleaned = stripProjectContext(userText);
  if (!cleaned) return '(no user request)';
  if (cleaned.length <= cap) return cleaned;
  return cleaned.slice(0, cap - 1) + '…';
}

function summarize(text, maxChars) {
  if (!text) return '';
  const cap = maxChars || 300;
  const cleaned = String(text).replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (cleaned.length <= cap) return cleaned;
  return cleaned.slice(0, cap - 1) + '…';
}

function summarizeUser(text, maxChars) {
  return summarize(stripProjectContext(text), maxChars);
}

function summarizeAssistant(text, maxChars) {
  return summarize(stripProjectContext(text), maxChars);
}

function mergeUserText(userMessages) {
  if (!userMessages || userMessages.length === 0) return '';
  return userMessages
    .map((m) => stripProjectContext(m.content || ''))
    .filter(Boolean)
    .join('\n');
}

function mergeAssistantText(assistantMessages) {
  if (!assistantMessages || assistantMessages.length === 0) return '';
  return assistantMessages
    .map((m) => stripProjectContext(m.content || ''))
    .filter(Boolean)
    .join('\n');
}

function deriveTaskTypeAndKeywords(userText, assistantText) {
  const cleanUser = stripProjectContext(userText || '');
  const cleanAssistant = stripProjectContext(assistantText || '');
  // Prefer the cleaned user text; fall back to assistant only if user is empty.
  const sourceForType = cleanUser || cleanAssistant;
  const taskType = classifyText(sourceForType);
  const sourceForKeywords = cleanUser || cleanAssistant;
  const kws = topKeywords(sourceForKeywords, 12).map((k) => k.token);
  return { taskType, keywords: kws };
}

function detectProjectPath(text) {
  if (!text) return null;
  const m1 = text.match(/([A-Za-z]:[\\\/][^\s'"<>|?*\n]+)/);
  if (m1) return m1[1];
  const m2 = text.match(/(\/[^\s'"<>|?*\n]{4,})/);
  if (m2) return m2[1];
  return null;
}

module.exports = {
  classifyText,
  tokenize,
  topKeywords,
  makeTitle,
  summarize,
  summarizeUser,
  summarizeAssistant,
  mergeUserText,
  mergeAssistantText,
  deriveTaskTypeAndKeywords,
  detectProjectPath,
  stripProjectContext,
  isOnlyProjectContext
};
