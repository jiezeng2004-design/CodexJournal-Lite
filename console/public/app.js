// CodexJournal-Lite local console — Chinese dashboard SPA.
// No external dependencies. Talks to /api/* on the same origin.

'use strict';

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

const state = {
  tab: 'dashboard',
  journal: { items: [], current: null, filter: '', counts: {} },
  reports: { items: [], current: null },
  data:    { items: [], current: null, maxSize: 1, typeFilter: '' },
  dist:    { items: [] },
  tasks:   { items: [], total: 0, offset: 0, limit: 25, query: '', type: '' },
  job:     { id: null, sse: null },
  verify:  { lines: [], exists: false }
};

// ---------- helpers ----------
function fmtBytes(n) {
  if (n == null) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
  return (n/1024/1024).toFixed(2) + ' MB';
}
function fmtDate(iso) {
  if (!iso) return '-';
  try { const d = new Date(iso); return d.toLocaleString('zh-CN'); } catch (_) { return iso; }
}
function fmtTime(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false }); } catch (_) { return iso; }
}
function fmtDuration(ms) {
  if (ms == null) return '-';
  if (ms < 1000) return ms + ' 毫秒';
  if (ms < 60000) return (ms/1000).toFixed(1) + ' 秒';
  return Math.floor(ms/60000) + ' 分 ' + Math.floor((ms%60000)/1000) + ' 秒';
}
function dowZh(isoDate) {
  // isoDate is YYYY-MM-DD
  const dows = ['日', '一', '二', '三', '四', '五', '六'];
  try {
    const d = new Date(isoDate + 'T12:00:00');
    return '周' + dows[d.getDay()];
  } catch (_) { return ''; }
}
function typeLabel(t) {
  const map = { codex: 'Codex', thesis: '论文', document: '文档', openclaw: 'OpenClaw', zotero: 'Zotero', environment: '环境', general: '通用', unknown: '未知' };
  return map[(t || 'unknown').toLowerCase()] || (t || '未知');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
function setText(el, s) { if (el) el.textContent = s == null ? '-' : s; }

async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch (_) { detail = res.statusText; }
    throw new Error('HTTP ' + res.status + (detail ? ' · ' + detail : ''));
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

// ---------- markdown renderer ----------
// Minimal but real markdown -> HTML. Handles:
//   # ## ### ####, blockquote (>), lists (- and 1.), code fences (```),
//   inline code (`), **bold**, *italic*, links [t](u), tables, hr (---),
//   paragraphs. HTML in source is escaped first.
function renderMarkdown(src) {
  if (src == null) return '';
  // First, normalize line endings.
  const text = String(src).replace(/\r\n?/g, '\n');
  // Escape HTML.
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = esc.split('\n');

  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Code fence
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push('<pre><code>' + buf.join('\n') + '</code></pre>');
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push('<h' + h[1].length + '>' + inlineMd(h[2]) + '</h' + h[1].length + '>'); i++; continue; }

    // Table (very simple: | col | col | lines, with --- separator)
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s\-:|]+\|/.test(lines[i+1])) {
      const header = parseRow(line);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(parseRow(lines[i])); i++; }
      out.push('<table><thead><tr>' + header.map(c => '<th>' + inlineMd(c) + '</th>').join('') + '</tr></thead><tbody>'
        + rows.map(r => '<tr>' + r.map(c => '<td>' + inlineMd(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }

    // Blockquote (one or more > lines)
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push('<blockquote>' + buf.map(l => '<p>' + inlineMd(l) + '</p>').join('') + '</blockquote>');
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      out.push('<ul>' + buf.map(l => '<li>' + inlineMd(l) + '</li>').join('') + '</ul>');
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++; }
      out.push('<ol>' + buf.map(l => '<li>' + inlineMd(l) + '</li>').join('') + '</ol>');
      continue;
    }

    // Empty line
    if (!line.trim()) { i++; continue; }

    // Paragraph: consume consecutive non-empty, non-special lines
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>\s|```|-{3,}|\s*[-*]\s|\s*\d+\.\s|\|)/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push('<p>' + inlineMd(buf.join(' ')) + '</p>');
  }
  return out.join('');
}
function parseRow(line) {
  return line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
}
function inlineMd(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

// ---------- JSON syntax highlight ----------
function renderJson(obj) {
  let raw;
  try { raw = JSON.stringify(obj, null, 2); } catch (_) { raw = String(obj); }
  return raw
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/("(?:\\.|[^"\\])*?")(\s*:)/g, '<span class="jk">$1</span>$2')
    .replace(/:\s*("(?:\\.|[^"\\])*?")/g, ': <span class="js">$1</span>')
    .replace(/:\s*(-?\d+(\.\d+)?)/g, ': <span class="jn">$1</span>')
    .replace(/:\s*(true|false)/g, ': <span class="jb">$1</span>')
    .replace(/:\s*(null)/g, ': <span class="jp">$1</span>');
}

// ---------- svg chart helpers ----------
function svgEl(name, attrs) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function clearHost(host) { while (host.firstChild) host.removeChild(host.firstChild); }

function renderDailyBars(host, byDay, n) {
  clearHost(host);
  if (!byDay || !Object.keys(byDay).length) { host.textContent = '暂无数据'; return; }
  const entries = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).slice(-n);
  const maxV = Math.max(1, ...entries.map(e => e[1]));
  const W = 640, H = 200, padL = 36, padR = 8, padT = 14, padB = 32;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });
  const gridG = svgEl('g', { class: 'grid' });
  for (let i = 0; i <= 4; i++) {
    const y = padT + (innerH * i / 4);
    gridG.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y, y2: y }));
  }
  svg.appendChild(gridG);
  const axG = svgEl('g', { class: 'axis' });
  for (let i = 0; i <= 4; i++) {
    const v = Math.round(maxV * (1 - i / 4));
    const t = svgEl('text', { x: padL - 6, y: padT + (innerH * i / 4) + 3, 'text-anchor': 'end' });
    t.textContent = v;
    axG.appendChild(t);
  }
  svg.appendChild(axG);
  const barW = innerW / entries.length;
  const barsG = svgEl('g');
  entries.forEach(([d, v], i) => {
    const h = innerH * (v / maxV);
    const x = padL + i * barW + barW * 0.15;
    const y = padT + innerH - h;
    const w = barW * 0.7;
    const b = svgEl('rect', { class: 'bar', x, y, width: w, height: h, rx: 2 });
    const tt = svgEl('title'); tt.textContent = d + ' · ' + v + ' 个任务'; b.appendChild(tt);
    barsG.appendChild(b);
    if (entries.length <= 14 || i % Math.ceil(entries.length / 7) === 0 || i === entries.length - 1) {
      const lbl = svgEl('text', { class: 'bar-label', x: x + w/2, y: H - 16 });
      lbl.textContent = d.slice(5);
      barsG.appendChild(lbl);
    }
    if (v > 0) {
      const vl = svgEl('text', { class: 'val-label', x: x + w/2, y: y - 4 });
      vl.textContent = v;
      barsG.appendChild(vl);
    }
  });
  svg.appendChild(barsG);
  host.appendChild(svg);
}

function renderHBars(host, items) {
  clearHost(host);
  if (!items || !items.length) { host.textContent = '暂无数据'; return; }
  const W = 360, rowH = 22, padL = 90, padR = 36, padT = 4, padB = 4;
  const H = padT + padB + items.length * rowH;
  const maxV = Math.max(1, ...items.map(i => i.v));
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });
  items.forEach((it, i) => {
    const y = padT + i * rowH;
    const innerW = W - padL - padR;
    const w = innerW * (it.v / maxV);
    svg.appendChild(svgEl('rect', { class: 'hbar-bg', x: padL, y: y + 4, width: innerW, height: rowH - 10, rx: 3 }));
    const b = svgEl('rect', { class: 'hbar', x: padL, y: y + 4, width: w, height: rowH - 10, rx: 3 });
    if (it.color) b.style.fill = it.color;
    svg.appendChild(b);
    const lbl = svgEl('text', { class: 'hbar-row', x: padL - 8, y: y + rowH/2 + 4, 'text-anchor': 'end' });
    lbl.textContent = (it.label || '').slice(0, 12);
    svg.appendChild(lbl);
    const cnt = svgEl('text', { class: 'hbar-count', x: W - 6, y: y + rowH/2 + 4 });
    cnt.textContent = it.v;
    svg.appendChild(cnt);
  });
  host.appendChild(svg);
}

const TYPE_COLORS = {
  codex:        '#2dd4bf',
  thesis:       '#60a5fa',
  document:     '#f0b400',
  general:      '#94a3b8',
  openclaw:     '#c084fc',
  zotero:       '#fb7185',
  environment:  '#f87171',
  unknown:      '#5b6573'
};

// ---------- tabs ----------
function showTab(name) {
  state.tab = name;
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== name));
  if (name === 'dashboard') loadDashboard();
  else if (name === 'journal') loadJournalList();
  else if (name === 'reports') loadReports();
  else if (name === 'data')    loadDataList();
  else if (name === 'dist')    loadDist();
  else if (name === 'verify')  loadVerifyTail();
  else if (name === 'actions') refreshJobs();
}

// ---------- 总览 ----------
async function loadDashboard() {
  setLoading($('#recent-tasks'), true, 4);
  try {
    const d = await api('/api/dashboard');
    setText($('#brand-meta'), 'v' + d.project.version + ' · node ' + d.project.node + ' · ' + (d.project.sessionsDir || ''));
    setText($('#c-tasks'),    d.counts.tasks);
    setText($('#c-messages-sub'), d.counts.messages.toLocaleString() + ' 条消息');
    setText($('#c-days'),     d.counts.days);
    setText($('#c-journals-sub'), d.counts.journals + ' 个日志文件');
    setText($('#c-dist'),     d.counts.distArtifacts);
    setText($('#c-dist-sub'), '本地 ZIP 包');
    if (d.doctor && d.doctor.pass != null) {
      const v = d.doctor.fail === 0 ? '✓ ' + d.doctor.pass : '✗ ' + d.doctor.fail;
      $('#c-doctor').textContent = v;
      $('#c-doctor').style.color = d.doctor.fail === 0 ? 'var(--good)' : 'var(--bad)';
      setText($('#c-doctor-sub'), d.doctor.pass + ' / ' + (d.doctor.pass + d.doctor.fail) + ' 项通过');
    } else { setText($('#c-doctor'), '?'); }

    renderDailyBars($('#daily-chart'), d.byDay || {}, 14);
    setText($('#daily-meta'), '共 ' + Object.keys(d.byDay || {}).length + ' 天');

    const typeItems = Object.entries(d.byType || {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ label: typeLabel(k), v, color: TYPE_COLORS[k] || 'var(--primary)' }));
    renderHBars($('#type-chart'), typeItems);
    setText($('#type-meta'), '共 ' + (d.counts.tasks || 0) + ' 个任务');

    const kwItems = (d.topKw || []).slice(0, 10).map(([k, v]) => ({ label: k, v, color: 'var(--primary)' }));
    renderHBars($('#kw-chart'), kwItems);

    const rt = $('#recent-tasks'); rt.innerHTML = '';
    setLoading(rt, false);
    setText($('#recent-count'), '展示 ' + d.lastTasks.length + ' / ' + d.counts.tasks);
    for (const t of d.lastTasks) {
      const li = document.createElement('li');
      const type = (t.type || 'unknown').toLowerCase();
      li.innerHTML = '<span class="feed-time">' + escapeHtml(t.date) + ' ' + escapeHtml(t.time) + '</span>'
        + '<span class="feed-type ' + escapeHtml(type) + '">' + escapeHtml(typeLabel(type)) + '</span>'
        + '<span class="feed-title" title="' + escapeHtml(t.title || '') + '">' + escapeHtml(t.title || '(无标题)') + '</span>';
      li.addEventListener('click', () => {
        if (t.date && t.date !== 'unknown' && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
          // 先把目标设为当前，renderJournalList 才不会去自动打开第一项
          state.journal.current = t.date + '.md';
          showTab('journal');
          openJournal(t.date + '.md');
        } else {
          showTab('data'); selectDataFile('tasks.json');
        }
      });
      rt.appendChild(li);
    }
  } catch (e) {
    setText($('#brand-meta'), '错误: ' + e.message);
    setLoading($('#recent-tasks'), false);
  }
}

// ---------- 日志 ----------
async function loadJournalList() {
  setLoading($('#journal-list'), true, 5);
  setLoading($('#journal-content'), true, 6);
  try {
    const r = await api('/api/journal');
    state.journal.items = r.items;
    setText($('#journal-count'), r.items.length + ' 天');
    // also pull counts (best-effort, lightweight): we read summary stats
    try {
      const stats = await api('/api/dashboard');
      state.journal.counts = stats.byDay || {};
    } catch (_) {}
    renderJournalList();
    setLoading($('#journal-list'), false);
  } catch (e) { console.error(e); setLoading($('#journal-list'), false); }
}
function renderJournalList() {
  const ul = $('#journal-list'); ul.innerHTML = '';
  const f = state.journal.filter.toLowerCase();
  const counts = state.journal.counts || {};
  const max = Math.max(1, ...Object.values(counts));
  const filtered = state.journal.items.filter(it => !f || it.name.toLowerCase().includes(f));
  for (const it of filtered) {
    const date = it.name.replace(/\.md$/, '');
    const c = counts[date] || 0;
    const li = document.createElement('li');
    if (state.journal.current === it.name) li.classList.add('active');
    li.innerHTML = '<div><span class="jl-date">' + escapeHtml(date.slice(5)) + '</span>'
      + '<span class="jl-dow"> · ' + dowZh(date) + '</span></div>'
      + '<span class="jl-count" title="' + c + ' 个任务">' + c + '</span>'
      + '<div class="jl-meta"><span>' + escapeHtml(date) + '</span><span>' + fmtBytes(it.size) + '</span></div>'
      + '<div class="jl-bar"><div class="jl-bar-fill" style="width:' + (c / max * 100).toFixed(1) + '%"></div></div>';
    li.addEventListener('click', () => openJournal(it.name));
    ul.appendChild(li);
  }
  if (!state.journal.current && filtered.length) openJournal(filtered[0].name);
}
async function openJournal(name) {
  state.journal.current = name;
  setText($('#journal-title'), 'journal/' + name);
  setLoading($('#journal-content'), true, 6);
  try {
    const text = await api('/api/journal/' + encodeURIComponent(name));
    setText($('#journal-meta'), fmtBytes(text.length) + ' · ' + text.split(/\r?\n/).length + ' 行');
    $('#journal-content').innerHTML = renderMarkdown(text);
    setLoading($('#journal-content'), false);
    renderJournalList();
  } catch (e) { $('#journal-content').textContent = '错误: ' + e.message; setLoading($('#journal-content'), false); }
}
$('#journal-filter').addEventListener('input', (e) => { state.journal.filter = e.target.value; renderJournalList(); });

// ---------- 报告 ----------
async function loadReports() {
  setLoading($('#report-list'), true, 4);
  try {
    const r = await api('/api/reports');
    state.reports.items = r.items;
    setText($('#report-count'), r.items.length + ' 份');
    renderReportsList();
    setLoading($('#report-list'), false);
  } catch (e) { console.error(e); setLoading($('#report-list'), false); }
}
function reportCategory(name) {
  // bucket a report path into a category + icon + chinese label
  if (/^doctor\.md$/i.test(name))               return { key: 'doctor',   icon: 'DOC', cls: 'doctor',   label: '环境体检' };
  if (/^verify-full\.log$|^verify-.*\.log$/i.test(name)) return { key: 'verify',   icon: 'LOG', cls: 'verify',   label: '校验日志' };
  if (/^work-patterns\.md$/i.test(name))        return { key: 'work',     icon: 'WRK', cls: 'work',     label: '工作模式' };
  if (/^idea-log-inventory\.md$/i.test(name))   return { key: 'scan',     icon: 'IDEA', cls: 'scan',     label: '源扫描' };
  if (/^source-scan-summary\.json$/i.test(name))return { key: 'scan',     icon: 'IDEA', cls: 'scan',     label: '源扫描' };
  if (/^output-index\.md$/.test(name))          return { key: 'index',    icon: 'IDX', cls: 'index',    label: '产物索引' };
  if (/^output-index\.json$/.test(name))        return { key: 'index',    icon: 'IDX', cls: 'index',    label: '产物索引' };
  if (/^monthly\//.test(name))                  return { key: 'month',    icon: 'M',   cls: 'month',    label: '月报' };
  if (/^yearly\//.test(name))                   return { key: 'year',     icon: 'Y',   cls: 'year',     label: '年报' };
  if (/acceptance-.*\.md$/.test(name))          return { key: 'work',     icon: 'ACPT', cls: 'work',    label: '验收报告' };
  if (/\.log$/.test(name))                      return { key: 'verify',   icon: 'LOG', cls: 'verify',   label: '日志' };
  if (/\.json$/.test(name))                     return { key: 'index',    icon: 'JSON', cls: 'index',   label: '元数据' };
  return { key: 'other', icon: 'MD', cls: 'work', label: '其他报告' };
}
const CATEGORY_ORDER = ['doctor', 'verify', 'work', 'index', 'scan', 'month', 'year', 'other'];
const CATEGORY_LABEL = { doctor: '环境体检', verify: '日志 / 校验', work: '工作模式 / 验收', index: '产物索引', scan: '源扫描', month: '月报', year: '年报', other: '其他' };
function renderReportsList() {
  const root = $('#report-list'); root.innerHTML = '';
  // bucket
  const groups = {};
  for (const it of state.reports.items) {
    const c = reportCategory(it.name);
    (groups[c.key] = groups[c.key] || []).push(Object.assign({}, it, c));
  }
  for (const k of CATEGORY_ORDER) {
    if (!groups[k]) continue;
    const sec = document.createElement('div');
    sec.className = 'report-group';
    sec.innerHTML = '<div class="report-group-title">' + escapeHtml(CATEGORY_LABEL[k])
      + '<span class="count">' + groups[k].length + ' 份</span></div>';
    const ul = document.createElement('ul'); ul.className = 'report-group-list';
    for (const it of groups[k]) {
      const li = document.createElement('li');
      if (state.reports.current === it.name) li.classList.add('active');
      li.innerHTML = '<span class="rg-icon ' + it.cls + '">' + escapeHtml(it.icon) + '</span>'
        + '<span class="rg-name">' + escapeHtml(it.name) + '</span>'
        + '<span class="rg-size">' + fmtBytes(it.size) + '</span>';
      li.addEventListener('click', () => openReport(it.name));
      ul.appendChild(li);
    }
    sec.appendChild(ul);
    root.appendChild(sec);
  }
  if (!state.reports.current && state.reports.items.length) {
    // prefer doctor.md then work-patterns.md
    const preferred = state.reports.items.find(x => x.name === 'doctor.md')
      || state.reports.items.find(x => x.name === 'work-patterns.md')
      || state.reports.items[0];
    openReport(preferred.name);
  }
}
async function openReport(name) {
  state.reports.current = name;
  setText($('#report-title'), 'reports/' + name);
  try {
    const text = await api('/api/reports/' + encodeURIComponent(name));
    setText($('#report-meta'), fmtBytes(text.length) + ' · ' + text.split(/\r?\n/).length + ' 行');
    if (/\.json$/.test(name)) {
      // try parse + pretty + JSON highlight
      try { $('#report-content').innerHTML = renderJson(JSON.parse(text)); }
      catch (_) { $('#report-content').textContent = text; }
    } else {
      $('#report-content').innerHTML = renderMarkdown(text);
    }
    renderReportsList();
  } catch (e) { $('#report-content').textContent = '错误: ' + e.message; }
}

// ---------- 数据 ----------
async function loadDataList() {
  setLoading($('#data-list'), true, 4);
  setLoading($('#tasks-list'), true, 4);
  try {
    const r = await api('/api/data');
    state.data.items = r.items;
    state.data.maxSize = Math.max(1, ...r.items.map(x => x.size));
    renderDataList();
    if (!state.data.current && r.items.length) {
      const tasks = r.items.find(x => x.name === 'tasks.json');
      selectDataFile(tasks ? 'tasks.json' : r.items[0].name);
    } else if (state.data.current) loadTasksPage();
    // 渲染类型筛选条（按 byType 数量）
    try {
      const dash = await api('/api/dashboard');
      renderTypeFilter(dash.byType || {});
    } catch (_) { /* noop */ }
    setLoading($('#data-list'), false);
    setLoading($('#tasks-list'), false);
  } catch (e) { console.error(e); setLoading($('#data-list'), false); setLoading($('#tasks-list'), false); }
}

function renderTypeFilter(byType) {
  const host = $('#type-filter'); if (!host) return;
  host.innerHTML = '';
  // 排序：先按数量降序，再按名字
  const entries = Object.entries(byType).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const pills = [['', '全部', total]].concat(entries.map(([k, v]) => [k, typeLabel(k), v]));
  for (const [key, label, count] of pills) {
    const b = document.createElement('button');
    const cls = ['type-pill'];
    if (key === state.data.typeFilter) cls.push('active');
    if (key) cls.push(key.toLowerCase());
    b.className = cls.join(' ');
    b.dataset.type = key;
    b.innerHTML = '<span class="tp-label">' + escapeHtml(label) + '</span><span class="tp-count">' + count + '</span>';
    b.addEventListener('click', () => {
      state.data.typeFilter = key;
      state.tasks.type = key;
      state.tasks.offset = 0;
      renderTypeFilter(byType);
      if (state.data.current === 'tasks.json') loadTasksPage();
      else selectDataFile('tasks.json');
    });
    host.appendChild(b);
  }
}
function renderDataList() {
  const ul = $('#data-list'); ul.innerHTML = '';
  for (const it of state.data.items) {
    const ext = (it.name.split('.').pop() || '').toLowerCase();
    const li = document.createElement('li');
    if (state.data.current === it.name) li.classList.add('active');
    const pct = (it.size / state.data.maxSize * 100).toFixed(1);
    li.innerHTML = '<div><span class="dl-name">' + escapeHtml(it.name) + '</span>'
      + '<span class="dl-type ' + (ext === 'json' || ext === 'md' ? ext : '') + '">' + escapeHtml(ext || 'file') + '</span></div>'
      + '<div class="jl-meta"><span>' + fmtDate(it.mtime) + '</span><span>' + fmtBytes(it.size) + '</span></div>'
      + '<div class="dl-size-bar"><div class="dl-size-bar-fill" style="width:' + pct + '%"></div></div>';
    li.addEventListener('click', () => selectDataFile(it.name));
    ul.appendChild(li);
  }
}
async function selectDataFile(name, limit, previewText) {
  state.data.current = name;
  setText($('#data-title'), 'data/' + name);
  if (name === 'tasks.json') {
    if (typeof limit === 'number') state.tasks.limit = limit;
    loadTasksPage();
    if (previewText) {
      const el = $('#data-content');
      try { el.innerHTML = renderJson(JSON.parse(previewText)); } catch (_) { el.textContent = previewText; }
    } else {
      // Show a structural preview: top-level keys + count + 3 sample items.
      try {
        let previewUrl = '/api/data/tasks?limit=3&offset=0';
        if (state.tasks.type) previewUrl += '&type=' + encodeURIComponent(state.tasks.type);
        const tasks = await api(previewUrl);
        setText($('#data-meta'), '共 ' + tasks.total + ' 条任务 · 已脱敏 · gitignored 原始路径保留');
        const preview = {
          generatedAt: '...',
          sessionsDir: '...',
          tasks: tasks.items
        };
        $('#data-content').innerHTML = renderJson(preview);
      } catch (e) { $('#data-content').textContent = '错误: ' + e.message; }
    }
    renderDataList();
    return;
  }
  try {
    const data = await api('/api/data/' + encodeURIComponent(name));
    if (typeof data === 'string') {
      setText($('#data-meta'), fmtBytes(data.length) + ' · ' + data.split(/\r?\n/).length + ' 行');
      if (name.endsWith('.json')) {
        try { $('#data-content').innerHTML = renderJson(JSON.parse(data)); }
        catch (_) { $('#data-content').textContent = data; }
      } else {
        $('#data-content').textContent = data;
      }
    } else {
      const json = JSON.stringify(data, null, 2);
      setText($('#data-meta'), fmtBytes(json.length) + ' · ' + json.split(/\r?\n/).length + ' 行');
      $('#data-content').innerHTML = renderJson(data);
    }
  } catch (e) { $('#data-content').textContent = '错误: ' + e.message; }
  renderDataList();
}
async function loadTasksPage() {
  setLoading($('#tasks-list'), true, 4);
  try {
    const q = state.tasks.query;
    const t = state.tasks.type;
    let url = '/api/data/tasks?limit=' + state.tasks.limit + '&offset=' + state.tasks.offset;
    if (q) url += '&q=' + encodeURIComponent(q);
    if (t) url += '&type=' + encodeURIComponent(t);
    const r = await api(url);
    state.tasks.items = r.items; state.tasks.total = r.total;
    setText($('#tasks-count'), '共 ' + r.total + ' 条匹配');
    setText($('#tasks-page'), '第 ' + (Math.floor(state.tasks.offset / state.tasks.limit) + 1) + ' 页 · ' + (state.tasks.offset + 1) + '–' + (state.tasks.offset + r.items.length));
    const ul = $('#tasks-list'); ul.innerHTML = '';
    setLoading(ul, false);
    for (const t of r.items) {
      const li = document.createElement('li');
      const type = (t.taskType || 'unknown').toLowerCase();
      li.innerHTML = '<span class="name">' + escapeHtml(t.title || '(无标题)') + '</span>'
        + '<span class="meta"><span class="type-chip ' + escapeHtml(type) + '">' + escapeHtml(typeLabel(type)) + '</span>'
        + '<span>' + escapeHtml(t.date || '') + ' ' + escapeHtml(t.time || '') + '</span></span>';
      li.addEventListener('click', () => {
        $('#data-content').innerHTML = renderJson(t);
        setText($('#data-meta'), '单条任务 · JSON');
      });
      ul.appendChild(li);
    }
  } catch (e) { $('#tasks-count').textContent = '错误: ' + e.message; setLoading($('#tasks-list'), false); }
}
$('#tasks-search').addEventListener('input', (e) => { state.tasks.query = e.target.value; state.tasks.offset = 0; loadTasksPage(); });
$('#tasks-prev').addEventListener('click', () => { state.tasks.offset = Math.max(0, state.tasks.offset - state.tasks.limit); loadTasksPage(); });
$('#tasks-next').addEventListener('click', () => { state.tasks.offset = state.tasks.offset + state.tasks.limit; loadTasksPage(); });

// ---------- 交付 ----------
async function loadDist() {
  try {
    const r = await api('/api/dist');
    state.dist.items = r.items;
    setText($('#dist-count'), r.items.length + ' 份');
    const ul = $('#dist-list'); ul.innerHTML = '';
    for (const it of r.items) {
      const isZip = it.name.endsWith('.zip');
      const li = document.createElement('li');
      li.innerHTML = '<span class="dist-icon">' + (isZip ? 'ZIP' : 'FILE') + '</span>'
        + '<div class="dist-grow"><div class="dist-name">' + escapeHtml(it.name) + '</div>'
        + '<div class="dist-meta">' + fmtDate(it.mtime) + ' · ' + fmtBytes(it.size) + ' · ' + (isZip ? '本地交付包' : '文件') + '</div></div>';
      if (isZip) {
        const a = document.createElement('a'); a.href = '/api/dist/download'; a.className = 'btn primary';
        a.textContent = '下载';
        li.appendChild(a);
      }
      ul.appendChild(li);
    }
  } catch (e) { console.error(e); }
}

// ---------- 操作 / 任务 ----------
async function runCmd(cmd, opts) {
  closeJobSse();
  $('#job-log').textContent = '';
  setJobStatus('启动');
  setText($('#job-cmd'), cmd);
  setText($('#log-title'), '实时日志 · ' + cmd);
  toast('正在执行 ' + cmd + '…', 'info', { ttl: 2500 });
  try {
    const r = await api('/api/run', { method: 'POST', body: JSON.stringify(Object.assign({ cmd }, opts || {})) });
    state.job.id = r.jobId;
    openJobSse(r.jobId);
  } catch (e) {
    appendJobLog('[client] 错误: ' + e.message);
    setJobStatus('失败');
    toast('启动失败: ' + e.message, 'err');
  }
}
function appendJobLog(line) {
  const el = $('#job-log');
  let cls = 'lout';
  if (line.startsWith('[err]'))  cls = 'err';
  else if (line.startsWith('[meta]')) cls = 'meta';
  else if (line.startsWith('[client]')) cls = 'err';
  else if (/^check passed|^VERIFY PASSED|PASS /.test(line)) cls = 'ok';
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const span = document.createElement('span');
  span.className = cls;
  span.textContent = '[' + ts + '] ' + line + '\n';
  el.appendChild(span);
  if ($('#job-autoscroll').checked) el.scrollTop = el.scrollHeight;
}
function setJobStatus(status) {
  const el = $('#job-status');
  el.textContent = status;
  el.className = 'status-pill ' + (status === '运行中' || status === '启动' ? 'run' : status === '成功' ? 'ok' : 'bad');
  $('#job-stop').disabled = !(status === '运行中' || status === '启动');
}
function openJobSse(id) {
  const es = new EventSource('/api/jobs/' + encodeURIComponent(id) + '/stream');
  state.job.sse = es;
  es.addEventListener('replay', (ev) => {
    const j = JSON.parse(ev.data);
    if (j.log && j.log.length) { for (const l of j.log) appendJobLog(l); }
    setJobStatus(j.status === 'running' ? '运行中' : (j.status || '运行中'));
  });
  es.addEventListener('log', (ev) => {
    appendJobLog(JSON.parse(ev.data).line);
  });
  es.addEventListener('exit', (ev) => {
    const d = JSON.parse(ev.data);
    setJobStatus(d.exitCode === 0 ? '成功' : '失败 (' + d.exitCode + ')');
    appendJobLog('[meta] 退出码 = ' + d.exitCode);
    refreshJobs();
    if (d.exitCode === 0) toast('完成 · ' + state.job.cmd, 'ok');
    else toast('失败 (' + d.exitCode + ') · ' + state.job.cmd, 'err');
    es.close();
  });
  es.onerror = () => { setJobStatus('失败'); appendJobLog('[client] SSE 错误'); es.close(); };
}
function closeJobSse() {
  if (state.job.sse) { try { state.job.sse.close(); } catch (_) {} state.job.sse = null; }
  state.job.id = null;
}
async function refreshJobs() {
  try {
    const r = await api('/api/jobs');
    const tbody = $('#job-history tbody'); tbody.innerHTML = '';
    for (const j of r.history) {
      const tr = document.createElement('tr');
      const dur = (j.endedAt && j.startedAt) ? fmtDuration(new Date(j.endedAt) - new Date(j.startedAt)) : '-';
      const args = (j.args || []).slice(2).join(' ');
      tr.innerHTML = '<td>' + fmtTime(j.startedAt) + '</td><td>' + escapeHtml(j.cmd) + (args ? ' ' + escapeHtml(args) : '') + '</td>'
        + '<td>' + (j.exitCode == null ? '-' : j.exitCode) + '</td><td>' + dur + '</td><td>' + escapeHtml(j.status) + '</td>';
      tbody.appendChild(tr);
    }
  } catch (_) { /* noop */ }
}
$('#job-stop').addEventListener('click', async () => {
  if (!state.job.id) return;
  try { await api('/api/jobs/' + encodeURIComponent(state.job.id) + '/stop', { method: 'POST' }); }
  catch (e) { appendJobLog('[client] 停止错误: ' + e.message); }
});
$('#job-clear').addEventListener('click', () => { $('#job-log').textContent = ''; });

$$('.act[data-cmd]').forEach(b => {
  b.addEventListener('click', () => {
    const cmd = b.dataset.cmd;
    const opts = {};
    if (b.dataset.force === '1') opts.force = true;
    if (b.dataset.skiparchive === '1') opts.skipArchive = true;
    runCmd(cmd, opts);
  });
});
$('#verify-run').addEventListener('click', () => { runCmd('verify', { skipArchive: true }); });

// ---------- 校验 ----------
async function loadVerifyTail() {
  setLoading($('#verify-tail'), true, 6);
  try {
    const r = await api('/api/verify-tail?lines=100');
    state.verify = r;
    setText($('#verify-meta'), r.exists ? ('末尾 ' + r.lines.length + ' / ' + r.total + ' 行 · 修改于 ' + fmtDate(r.mtime)) : 'reports/verify-full.log 不存在');
    const el = $('#verify-tail'); el.textContent = '';
    let pass = 0, fail = 0, info = 0;
    for (const line of r.lines) {
      const span = document.createElement('span');
      if (/^VERIFY PASSED/.test(line))         { span.className = 'ok';  }
      else if (/^VERIFY FAILED/.test(line) || /\[FAIL\]/.test(line)) { span.className = 'err'; fail++; }
      else if (/^==\[ /.test(line))            { span.className = 'meta'; }
      else if (/\[PASS\]/.test(line))          { span.className = 'ok';  pass++; }
      else if (/\[INFO\]/.test(line))          { info++; }
      span.textContent = line + '\n';
      el.appendChild(span);
    }
    el.scrollTop = el.scrollHeight;
    setLoading($('#verify-tail'), false);
  } catch (e) { $('#verify-tail').textContent = '错误: ' + e.message; setLoading($('#verify-tail'), false); }
}
$('#verify-refresh').addEventListener('click', loadVerifyTail);

// ---------- top bar ----------
$('#refresh-all').addEventListener('click', () => {
  if (state.tab === 'dashboard') loadDashboard();
  else if (state.tab === 'journal') loadJournalList();
  else if (state.tab === 'reports') loadReports();
  else if (state.tab === 'data')    loadDataList();
  else if (state.tab === 'dist')    loadDist();
  else if (state.tab === 'verify')  loadVerifyTail();
  else if (state.tab === 'actions') refreshJobs();
  toast('已刷新', 'ok', { ttl: 1800 });
});
$$('.tab').forEach(b => b.addEventListener('click', () => { showTab(b.dataset.tab); window.location.hash = b.dataset.tab; }));
// 类型 pill 点击时同步 hash，方便分享 / 收藏
$('#type-filter').addEventListener('click', (e) => {
  const pill = e.target.closest('.type-pill');
  if (pill) {
    const t = pill.dataset.type || '';
    window.location.hash = t ? 'data?type=' + encodeURIComponent(t) : 'data';
  }
});

// ---------- clock ----------
function tickClock() {
  const d = new Date();
  $('#server-time').textContent = d.toLocaleString('zh-CN');
}
setInterval(tickClock, 1000); tickClock();

// ---------- toast + skeleton ----------
function toast(msg, type, opts) {
  const host = $('#toast-host'); if (!host) return;
  const cls = ['toast'];
  if (type) cls.push(type);
  const el = document.createElement('div');
  el.className = cls.join(' ');
  el.innerHTML = '<span class="toast-dot"></span><span class="toast-msg"></span>';
  el.querySelector('.toast-msg').textContent = String(msg);
  host.appendChild(el);
  const ttl = (opts && opts.ttl) || 4000;
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => { try { host.removeChild(el); } catch (_) {} }, 250);
  }, ttl);
}
function setLoading(el, on, lines) {
  if (!el) return;
  if (on) {
    if (!el.querySelector('.skeleton-wrap')) {
      const n = lines || 5;
      const wrap = document.createElement('div');
      wrap.className = 'skeleton-wrap';
      for (let i = 0; i < n; i++) {
        const b = document.createElement('span');
        b.className = 'skeleton-bar' + (i === 0 ? ' thick' : ' thin') + (i % 2 === 0 ? ' medium' : ' short');
        wrap.appendChild(b);
      }
      el.appendChild(wrap);
    }
    el.classList.add('is-loading');
  } else {
    el.classList.remove('is-loading');
    const w = el.querySelector('.skeleton-wrap');
    if (w) w.remove();
  }
}

// ---------- theme toggle ----------
const THEME_KEY = 'cjl-theme';
function detectInitialTheme() {
  try {
    const qs = new URLSearchParams(window.location.search);
    const urlTheme = qs.get('theme');
    if (urlTheme === 'light' || urlTheme === 'dark') return urlTheme;
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (_) {}
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const icon = $('#theme-icon');
  if (icon) icon.innerHTML = theme === 'light'
    ? '<path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 1.5v9a4.5 4.5 0 0 1 0-9z" fill="currentColor"/>'
    : '<circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3" stroke="currentColor"/>';
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
}
applyTheme(detectInitialTheme());
$('#theme-toggle').addEventListener('click', toggleTheme);

// ---------- search (global Ctrl+K) ----------
const search = { open: false, q: '', timer: null, results: null, focused: -1 };

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function highlight(text, q) {
  if (!q) return escapeHtml(text);
  const esc = escapeHtml(text);
  const qe  = escapeHtml(q);
  try {
    const re = new RegExp('(' + escapeRegex(qe) + ')', 'gi');
    return esc.replace(re, '<mark>$1</mark>');
  } catch (_) { return esc; }
}

function openSearch() {
  if (search.open) return;
  search.open = true;
  $('#search-overlay').classList.remove('hidden');
  setTimeout(() => $('#search-input').focus(), 0);
}
function closeSearch() {
  if (!search.open) return;
  search.open = false;
  $('#search-overlay').classList.add('hidden');
  $('#search-input').value = '';
  search.q = '';
  search.results = null;
  search.focused = -1;
  $('#search-results').innerHTML = '<p class="muted small" style="padding:18px;text-align:center">输入关键词以搜索 任务 / 日志 / 报告</p>';
  $('#search-summary').textContent = '就绪';
}
function toggleSearch() { search.open ? closeSearch() : openSearch(); }

let searchSeq = 0;
async function runSearch(q) {
  q = (q || '').trim();
  if (q.length < 2) {
    search.results = null;
    if (q.length === 0) {
      $('#search-results').innerHTML = '<p class="muted small" style="padding:18px;text-align:center">输入关键词以搜索 任务 / 日志 / 报告</p>';
      $('#search-summary').textContent = '就绪';
    } else {
      $('#search-results').innerHTML = '<p class="search-empty">至少输入 2 个字符</p>';
      $('#search-summary').textContent = '·';
    }
    return;
  }
  const my = ++searchSeq;
  $('#search-results').innerHTML = '<p class="search-empty">搜索中…</p>';
  $('#search-summary').textContent = '搜索 ' + q + ' …';
  try {
    const r = await api('/api/search?q=' + encodeURIComponent(q) + '&limit=20');
    if (my !== searchSeq) return; // outdated
    search.results = r;
    search.focused = -1;
    renderSearchResults(r, q);
  } catch (e) {
    if (my !== searchSeq) return;
    search.results = null;
    $('#search-results').innerHTML = '<p class="search-empty error">搜索失败: ' + escapeHtml(e.message) + '</p>';
    $('#search-summary').textContent = '失败';
  }
}

function renderSearchResults(r, q) {
  const host = $('#search-results');
  const g = r.groups || { journal: [], task: [], report: [] };
  const total = g.journal.length + g.task.length + g.report.length;
  if (total === 0) {
    host.innerHTML = '<p class="search-empty">没有匹配项</p>';
    $('#search-summary').textContent = '0 条';
    return;
  }
  const html = [];
  let idx = 0;
  const renderGroup = (label, items, source) => {
    if (!items || !items.length) return;
    html.push('<div class="search-group-title">' + escapeHtml(label) + '<span class="search-group-count">' + items.length + '</span></div>');
    for (const it of items) {
      let title, meta, sub = '';
      if (source === 'journal') {
        title = 'journal/' + it.date + '.md';
        meta  = it.date + ' · 日志';
      } else if (source === 'task') {
        const type = (it.type || 'unknown').toLowerCase();
        title = it.title || '(无标题)';
        meta  = (it.date || '') + ' · ' + typeLabel(type);
        sub   = '<span class="search-source-chip ' + escapeHtml(type) + '">' + escapeHtml(typeLabel(type)) + '</span>';
      } else { // report
        title = it.name;
        meta  = '报告';
      }
      html.push('<div class="search-result" data-source="' + source + '" data-idx="' + idx + '">'
        + '<div class="sr-top">' + sub
        + '<span class="search-source-chip ' + source + '">' + escapeHtml(source) + '</span>'
        + '<span class="sr-title">' + highlight(title, q) + '</span>'
        + '<span class="sr-meta">' + escapeHtml(meta) + '</span>'
        + '</div>'
        + (it.snippet ? '<div class="sr-snippet">' + highlight(it.snippet, q) + '</div>' : '')
        + '</div>');
      idx++;
    }
  };
  renderGroup('日志', g.journal, 'journal');
  renderGroup('任务', g.task, 'task');
  renderGroup('报告', g.report, 'report');
  host.innerHTML = html.join('');
  // bind clicks
  host.querySelectorAll('.search-result').forEach(el => {
    el.addEventListener('click', () => jumpToResult(el.dataset.source, el.dataset.idx, r, q));
  });
  $('#search-summary').textContent = r.total + ' 条匹配 · 显示 ' + idx;
}

function jumpToResult(source, idxStr, r, q) {
  const g = r.groups || {};
  let it;
  if (source === 'journal') it = g.journal[+idxStr];
  else if (source === 'task') it = g.task[+idxStr];
  else it = g.report[+idxStr];
  if (!it) return;
  closeSearch();
  if (source === 'journal') {
    showTab('journal');
    openJournal(it.date + '.md');
    // 滚动到包含查询词的位置（粗略）
    setTimeout(() => {
      const root = $('#journal-content');
      if (root && q) {
        const re = new RegExp(escapeRegex(q), 'i');
        const node = root.querySelector('p, h1, h2, h3, li');
        // 直接把第一个 mark 高亮
        const m = root.innerHTML.match(re);
        if (m) {
          // 简单 scroll 顶部即可；md 渲染后 mark 已被覆盖，需要重新渲染带 mark
          // 复用 inlineMd 的 mark 不实际，我们不重渲染 journal（保持快速），只把目标日期文件名写入状态
        }
      }
    }, 200);
  } else if (source === 'task') {
    // 跳到数据 tab 的 tasks.json，并设类型筛选 + 搜索框
    state.data.typeFilter = it.type || '';
    state.tasks.type = it.type || '';
    state.tasks.query = q || '';
    state.tasks.offset = 0;
    showTab('data');
    if (state.data.current === 'tasks.json') {
      loadTasksPage();
    } else {
      selectDataFile('tasks.json');
    }
    // 把搜索框填回去
    setTimeout(() => { $('#tasks-search').value = state.tasks.query; }, 100);
    // 滚动到任务列表
    setTimeout(() => { if ($('#tasks-list')) $('#tasks-list').scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300);
  } else {
    // report
    showTab('reports');
    openReport(it.name);
  }
}

$('#search-toggle').addEventListener('click', openSearch);
$('#search-backdrop').addEventListener('click', closeSearch);
$('#search-input').addEventListener('input', (e) => {
  search.q = e.target.value;
  clearTimeout(search.timer);
  search.timer = setTimeout(() => runSearch(search.q), 250);
});
$('#search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeSearch(); return; }
  if (e.key === 'Enter') {
    e.preventDefault();
    const focused = document.querySelector('.search-result.focused');
    if (focused) {
      jumpToResult(focused.dataset.source, focused.dataset.idx, search.results, search.q);
    } else if (search.results) {
      // Enter on first result
      const first = document.querySelector('.search-result');
      if (first) jumpToResult(first.dataset.source, first.dataset.idx, search.results, search.q);
    }
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const all = Array.from(document.querySelectorAll('.search-result'));
    if (!all.length) return;
    search.focused = (search.focused + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
    all.forEach((el, i) => el.classList.toggle('focused', i === search.focused));
    all[search.focused].scrollIntoView({ block: 'nearest' });
  }
});
// Ctrl+K / Cmd+K
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    toggleSearch();
  } else if (e.key === 'Escape' && search.open) {
    closeSearch();
  }
});

// ---------- boot ----------
const initialHash = (window.location.hash || '').replace(/^#/, '');
let initialTab = initialHash;
if (initialHash.startsWith('data?')) {
  initialTab = 'data';
  const q = initialHash.slice('data?'.length);
  const m = q.match(/type=([^&]+)/);
  if (m) { state.data.typeFilter = decodeURIComponent(m[1]); state.tasks.type = state.data.typeFilter; }
}
showTab(initialTab);
loadDashboard();
setInterval(() => { if (state.tab === 'dashboard') loadDashboard(); }, 15000);

// 启动时如有 ?q= 参数，自动打开搜索浮层
const initialQuery = new URLSearchParams(window.location.search).get('q');
if (initialQuery) {
  setTimeout(() => { openSearch(); $('#search-input').value = initialQuery; runSearch(initialQuery); }, 100);
}
