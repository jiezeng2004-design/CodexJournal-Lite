'use strict';

const os = require('os');
const path = require('path');

// Redaction rules for CodeXJournal-Lite.
// Goal: never leak real keys, tokens, cookies, or the local Windows username.

const REDACTED = '<REDACTED>';
const USER_PLACEHOLDER = '<USER>';

// Order matters: do the more specific patterns first, then the catch-alls.

const PATTERNS = [
  // sk-xxx, sk-proj-xxx, sk-live / sk-test prefixed keys (case-insensitive).
  {
    name: 'openai-style-key',
    re: /sk-[A-Za-z0-9_\-]{8,}/g,
    replace: () => 'sk-' + REDACTED
  },
  // Generic API key assignment: API_KEY=... or apikey:"..."
  {
    name: 'api-key-assignment',
    re: /\b(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([^\s'"]{6,})['"]?/gi,
    replace: (m) => m.replace(/([^\s'"]+)$/, REDACTED)
  },
  // OPENAI_API_KEY=...
  {
    name: 'openai-env-var',
    re: /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|AZURE_OPENAI_API_KEY|COHERE_API_KEY|HUGGINGFACE_API_KEY|REPLICATE_API_TOKEN|TAVILY_API_KEY|SERPER_API_KEY)\s*[:=]\s*['"]?([^\s'"]{4,})['"]?/gi,
    replace: (m) => m.replace(/([^\s'"]+)$/, REDACTED)
  },
  // Bearer tokens
  {
    name: 'bearer',
    re: /\bBearer\s+[A-Za-z0-9._\-+/=]{6,}/gi,
    replace: () => 'Bearer ' + REDACTED
  },
  // Authorization header value
  {
    name: 'authorization-header',
    re: /\bauthorization\s*[:=]\s*['"]?([^\s'"]{6,})['"]?/gi,
    replace: (m) => m.replace(/([^\s'"]+)$/, REDACTED)
  },
  // Cookie / Set-Cookie / connect.sid / sessionid / session
  {
    name: 'cookie-pair',
    re: /\b(cookie|set-cookie|session|sessionid|connect\.sid)\s*[:=]\s*['"]?([^\s'"]{4,})['"]?/gi,
    replace: (m) => m.replace(/([^\s'"]+)$/, REDACTED)
  },
  // token=xxx or "token":"xxx" (only when value is long-ish)
  {
    name: 'token-pair',
    re: /\btoken\s*[:=]\s*['"]?([A-Za-z0-9._\-+/=]{8,})['"]?/gi,
    replace: (m) => m.replace(/([A-Za-z0-9._\-+/=]+)$/, REDACTED)
  },
  // GitHub-style personal access tokens (ghp_/gho_/ghu_/ghs_/ghr_)
  {
    name: 'github-pat',
    re: /\bgh[pousr]_[A-Za-z0-9]{20,}/gi,
    replace: () => REDACTED
  },
  // Slack tokens
  {
    name: 'slack-token',
    re: /\bxox[baprs]-[A-Za-z0-9-]{8,}/g,
    replace: () => REDACTED
  }
];

function getLocalUserNames() {
  const names = new Set();
  try {
    if (os.userInfo && os.userInfo().username) names.add(os.userInfo().username);
  } catch (_) {}
  if (process.env && process.env.USERNAME) names.add(process.env.USERNAME);
  if (process.env && process.env.USER) names.add(process.env.USER);
  // Also try homedir basename
  try {
    const home = os.homedir();
    if (home) {
      const base = path.basename(home);
      if (base) names.add(base);
    }
  } catch (_) {}
  const filtered = new Set();
  for (const n of names) {
    if (!n) continue;
    if (/^(public|administrator|default|user|all\susers)$/i.test(n)) continue;
    // Skip generic / system account names but keep short or non-ASCII names.
    filtered.add(n);
  }
  return Array.from(filtered);
}

function redactText(input, opts) {
  if (input == null) return input;
  let s = typeof input === 'string' ? input : String(input);
  for (const p of PATTERNS) {
    s = s.replace(p.re, p.replace);
  }
  // Windows path username
  const users = (opts && opts.localUserNames) || getLocalUserNames();
  for (const u of users) {
    if (!u) continue;
    // Escape regex special chars in username
    const esc = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // What can legitimately follow a Windows user-profile path segment?
    //   - a path separator (single or double backslash, forward slash)
    //   - end of string
    //   - a PowerShell / cmd prompt suffix (`>`, `$`)
    //   - whitespace
    //   - quotes (`"`, `'`, `` ` ``) when the path is interpolated into a
    //     command line, markdown, or JSON string
    //   - punctuation that commonly follows the username in a command
    //     (`:`, `;`, `,`, `.`, `)`, `]`)
    // This lets us catch `C:\Users\foo>` (PowerShell prompt), `C:\Users\foo`
    // (bare mention), `C:\Users\foo"`, `C:\Users\foo'`, `C:\Users\foo\``,
    // `C:\Users\foo:`, `C:\Users\foo;`, `C:\Users\foo$` etc. without ever
    // rewriting a non-path use of the username.
    const tail = '(?=$|[\\\\\\/\\s>"\':;,\\.\\)\\]$`])';
    // 1) Single-backslash Windows path:  C:\Users\xxx<tail>
    const reWinBack = new RegExp('([A-Za-z]:\\\\)Users\\\\' + esc + tail, 'gi');
    s = s.replace(reWinBack, '$1Users\\' + USER_PLACEHOLDER);
    // 2) JSON-string-style double-backslash:  C:\\Users\\xxx<tail>
    const reWinDouble = new RegExp('([A-Za-z]:\\\\\\\\)Users\\\\\\\\' + esc + tail, 'gi');
    s = s.replace(reWinDouble, '$1Users\\\\' + USER_PLACEHOLDER);
    // 3) Forward-slash Windows path:  C:/Users/xxx<tail>
    const reWinFwd = new RegExp('([A-Za-z]:/)Users/' + esc + tail, 'gi');
    s = s.replace(reWinFwd, '$1Users/' + USER_PLACEHOLDER);
    // 4) Linux homedir: /home/xxx/   (path-style only; requires a `/`
    // immediately after the username so we don't rewrite ordinary text)
    const reHome = new RegExp('(/home/)' + esc + '/', 'gi');
    s = s.replace(reHome, '$1' + USER_PLACEHOLDER + '/');
  }
  return s;
}

function redactPath(p) {
  if (!p) return p;
  return redactText(String(p));
}

function redactObjectDeep(value, opts) {
  const seen = new WeakSet();
  function walk(v) {
    if (v == null) return v;
    if (typeof v === 'string') return redactText(v, opts);
    if (typeof v !== 'object') return v;
    if (seen.has(v)) return v;
    seen.add(v);
    if (Array.isArray(v)) {
      return v.map((x) => walk(x));
    }
    const out = {};
    for (const k of Object.keys(v)) {
      const lk = k.toLowerCase();
      // Always redact these field names if they look like secrets
      if (
        lk === 'cookie' ||
        lk === 'set-cookie' ||
        lk === 'sessionid' ||
        lk === 'session' ||
        lk === 'connect.sid' ||
        lk === 'authorization' ||
        lk === 'token' ||
        lk === 'access_token' ||
        lk === 'refresh_token' ||
        lk === 'apikey' ||
        lk === 'api_key' ||
        lk === 'openai_api_key'
      ) {
        out[k] = REDACTED;
      } else {
        out[k] = walk(v[k]);
      }
    }
    return out;
  }
  return walk(value);
}

module.exports = {
  redactText,
  redactPath,
  redactObjectDeep,
  REDACTED,
  USER_PLACEHOLDER,
  getLocalUserNames
};
