/* ClinicGuard Personal — everything runs in the browser. Data lives in localStorage only. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const KEY = 'clinicguard-personal:v1';
  const DAY = 86400000;

  /* ---------- storage ---------- */
  const fresh = () => ({ tasks: [], devices: [], days: {}, pw: { last: null, lastPrefix: null, breached: false, resolved: true }, ai: { count: 0, last: null, lastChars: 0, consent: false }, lastPlan: null });
  let state;
  try { state = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { state = fresh(); }
  state.ai = Object.assign(fresh().ai, state.ai || {});
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable: app still works for this session */ } };

  const uid = () => Math.random().toString(36).slice(2, 10);
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const daysSince = iso => iso ? Math.floor((Date.now() - new Date(iso + 'T12:00:00').getTime()) / DAY) : null;

  // New day: drop tasks completed on previous days, carry unfinished ones forward
  const today = dayKey();
  state.tasks = state.tasks.filter(t => !(t.done && t.doneOn && t.doneOn !== today));
  save();

  /* ---------- toast + confetti ---------- */
  const toastEl = $('#toast'); let toastT;
  const toast = msg => { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 3200); };
  const confetti = (x, y) => {
    if (reduceMotion) return;
    const colors = ['#48bfce', '#b5a1e8', '#567cbd', '#7de3ea', '#9687d4'];
    for (let i = 0; i < 18; i++) {
      const c = document.createElement('i'); c.className = 'confetti';
      c.style.left = x + 'px'; c.style.top = y + 'px'; c.style.background = colors[i % colors.length];
      const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 80;
      c.style.setProperty('--dx', Math.cos(a) * d + 'px'); c.style.setProperty('--dy', Math.sin(a) * d - 40 + 'px');
      document.body.appendChild(c); setTimeout(() => c.remove(), 1000);
    }
  };

  /* ---------- first-step engine (offline rules, no AI, nothing sent) ---------- */
  const RULES = [
    [/essay|paper|report|write|draft|thesis|blog/i, 'Open a blank doc and write just the title and 3 bullet ideas.'],
    [/stud|exam|quiz|test|midterm|final|review/i, "Open your notes and pick the ONE topic you're least sure about."],
    [/apply|application|internship|job|resume|cv|cover letter/i, 'Open the posting and copy its 3 key requirements into a note.'],
    [/email|reply|message|text|dm|respond/i, "Write only the first sentence. Sending can wait."],
    [/clean|laundry|room|dishes|tidy|organi/i, 'Set a timer and clear just one surface.'],
    [/gym|workout|run|exercise|walk|lift/i, 'Put on your workout clothes. That counts as starting.'],
    [/read|chapter|book|article/i, 'Read just the first page.'],
    [/call|appointment|book|schedule|doctor|dentist/i, 'Find the phone number or booking link and paste it here.'],
    [/pay|bill|rent|invoice|tuition|loan/i, 'Open the payment page and check the due date and amount.'],
    [/code|project|build|lab|assignment|homework|hw/i, "Open the project and write down the very next file or question you'll touch."],
    [/grocer|shop|cook|meal|food/i, 'Write a quick 5-item list.'],
    [/update .*(phone|laptop|tablet|router|watch|device)|software update/i, 'Plug in your device and open its Settings → Software Update.'],
    [/password|leak|breach/i, 'Open your password manager or the site and start a password change.'],
    [/present|slides|deck|pitch/i, 'Write the title of every slide, nothing else.'],
  ];
  const firstStep = title => (RULES.find(([re]) => re.test(title)) || [0, 'Open whatever you need for this and work on it for just 2 minutes.'])[1];

  /* ---------- greeting/date ---------- */
  const now = new Date();
  const h = now.getHours();
  const hello = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const niceDate = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  $('#greeting').textContent = hello;
  $('#todayDate').textContent = niceDate;
  $('#phoneDate').textContent = niceDate;
  $('#year').textContent = now.getFullYear();
  $('.phone h4').textContent = hello + (h < 12 ? ' ☀️' : h < 18 ? ' 🌤' : ' 🌙');

  /* ---------- tabs ---------- */
  const tabs = $$('.tab');
  const showTab = name => {
    tabs.forEach(t => { const on = t.dataset.tab === name; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
    $$('.panel', $('#appShell')).forEach(p => { p.hidden = p.id !== 'panel-' + name; });
    if (name === 'privacy') renderLedger();
    if (name === 'devices') renderDevices();
    if (name === 'guard') renderGuard();
  };
  tabs.forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
  $('.app-side').addEventListener('keydown', e => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const i = tabs.indexOf(document.activeElement); if (i < 0) return;
    const n = tabs[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    n.focus(); n.click(); e.preventDefault();
  });
  $$('[data-goto]').forEach(a => a.addEventListener('click', () => setTimeout(() => showTab(a.dataset.goto), 50)));

  /* ---------- router: Home is one scrolling page; "Plan your day" (#/app) and "AI Planner" (#/ai) are their own tabs ---------- */
  const VIEWS = ['home', 'app', 'ai'];
  const TITLES = { home: 'Plan your day. Guard your life.', app: 'Plan your day', ai: 'AI Planner' };
  const shell = $('#appShell');
  let current = null;
  const route = () => {
    const h = location.hash;
    const isRoute = h.startsWith('#/');
    let name = isRoute ? h.slice(2) : 'home';
    if (!VIEWS.includes(name)) name = 'home';
    const changed = name !== current;
    current = name;
    if (changed) {
      $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
      $$('[data-nav]').forEach(a => a.dataset.nav === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
      document.title = `${TITLES[name]} · ClinicGuard Personal`;
      // the same live app is shown on the homepage and in its own tab: move it, don't copy it
      const slot = name === 'app' ? $('#appSlotTab') : $('#appSlotHome');
      if (shell.parentElement !== slot) slot.appendChild(shell);
      if (name === 'app') shell.classList.remove('pre');
      if (name === 'ai') renderPlan();
      if (name === 'home') requestAnimationFrame(() => { size(); onScroll(); });
      if (isRoute || !h) window.scrollTo({ top: 0, behavior: 'instant' });
    }
    const menu = $('#mobile-menu'); if (menu) menu.hidden = true;
    if (!isRoute && h.length > 1) { const t = document.getElementById(h.slice(1)); if (t) requestAnimationFrame(() => t.scrollIntoView({ behavior: changed || reduceMotion ? 'auto' : 'smooth' })); }
  };
  addEventListener('hashchange', route);
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-scroll]'); if (!a) return;
    e.preventDefault(); const t = document.querySelector(a.getAttribute('href')); if (t) t.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  /* ---------- TODAY ---------- */
  const list = $('#taskList');
  const addTask = (title, extra = {}) => {
    title = title.trim(); if (!title) return;
    state.tasks.push({ id: uid(), title, done: false, step: firstStep(title), showStep: false, created: today, ...extra });
    save(); renderToday();
  };
  $('#addForm').addEventListener('submit', e => { e.preventDefault(); const i = $('#taskInput'); if (!i.value.trim()) { i.focus(); return; } addTask(i.value); i.value = ''; i.focus(); });
  $$('[data-suggest]').forEach(b => b.addEventListener('click', () => { addTask(b.dataset.suggest); toast('Added. Tap ⚡ for a first step.'); }));
  $('#clearDone').addEventListener('click', () => { const n = state.tasks.filter(t => t.done).length; state.tasks = state.tasks.filter(t => !t.done); save(); renderToday(); toast(n ? `Cleared ${n} finished task${n > 1 ? 's' : ''}.` : 'Nothing finished yet. You got this.'); });

  const streak = () => {
    let s = 0; const d = new Date();
    if (!state.days[dayKey(d)]) d.setDate(d.getDate() - 1);
    while (state.days[dayKey(d)]) { s++; d.setDate(d.getDate() - 1); }
    return s;
  };

  const renderToday = () => {
    const tasks = state.tasks;
    const done = tasks.filter(t => t.done).length;
    const pct = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    const ring = $('#dayRing'); ring.style.setProperty('--p', pct); ring.dataset.label = pct + '%';
    $('#doneCount').textContent = `${done} / ${tasks.length}`;
    const s = streak(); $('#streakCount').textContent = `${s} day${s === 1 ? '' : 's'}`;
    $('#todayTitle').textContent = !tasks.length ? "Let's make today easy" : done === tasks.length ? 'All done. Seriously, nice work.' : `${tasks.length - done} thing${tasks.length - done > 1 ? 's' : ''} left today`;
    if (!tasks.length) {
      list.innerHTML = '<li class="empty"><b>Your day is a blank page ✨</b>Type what\'s on your mind above, or tap a suggestion.</li>';
    } else {
      list.innerHTML = tasks.map(t => `
        <li class="task ${t.done ? 'done' : ''}" data-id="${t.id}">
          <div class="task-top">
            <button class="check" data-act="toggle" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}">${t.done ? '✓' : ''}</button>
            <span class="t-title">${esc(t.title)}</span>
            ${t.guard ? '<span class="t-tag guard">GUARD</span>' : ''}
            <div class="t-actions">
              <button class="icon-btn" data-act="step" aria-label="Show first step" title="First step">⚡</button>
              <button class="icon-btn" data-act="focus" aria-label="Start a 2-minute timer" title="2-minute start">⏱</button>
              <button class="icon-btn" data-act="del" aria-label="Delete task" title="Delete">✕</button>
            </div>
          </div>
          ${t.showStep && !t.done ? `<div class="first-step"><span>⚡ <b>First step:</b> ${esc(t.step)}</span><button class="btn btn-aqua" data-act="focus">Start 2 min</button></div>` : ''}
        </li>`).join('');
    }
    renderGuardSummary();
  };

  list.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const li = btn.closest('.task'); const t = state.tasks.find(x => x.id === li.dataset.id); if (!t) return;
    const act = btn.dataset.act;
    if (act === 'toggle') {
      t.done = !t.done; t.doneOn = t.done ? today : null;
      state.days[today] = state.tasks.filter(x => x.done && x.doneOn === today).length;
      if (!state.days[today]) delete state.days[today];
      if (t.done) { const r = btn.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + r.height / 2); }
      if (t.done && t.guardType === 'device' && t.deviceId) { const d = state.devices.find(x => x.id === t.deviceId); if (d) { d.updated = today; toast(`${d.name} marked as updated today.`); } }
    } else if (act === 'step') { t.showStep = !t.showStep; }
    else if (act === 'del') { state.tasks = state.tasks.filter(x => x !== t); toast('Task removed.'); }
    else if (act === 'focus') { openFocus(t); return; }
    save(); renderToday();
  });

  /* ---------- 2-minute focus ---------- */
  const focusEl = $('#focus'); let timerId = null; let focusTask = null; let lastFocus = null;
  const openFocus = t => {
    focusTask = t; lastFocus = document.activeElement;
    $('#focusTitle').textContent = t.title; $('#focusStep').textContent = '⚡ ' + t.step;
    focusEl.hidden = false; $('#focusDone').focus();
    const total = 120; let left = total; const tEl = $('#timer'); const txt = $('#timerText');
    const paint = () => { tEl.style.setProperty('--p', left / total * 100); txt.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; };
    paint(); clearInterval(timerId);
    timerId = setInterval(() => { left--; paint(); if (left <= 0) { clearInterval(timerId); txt.textContent = '🎉'; $('#focusStep').textContent = 'Two minutes done. The hard part is over. Keep going?'; } }, 1000);
  };
  const closeFocus = () => { clearInterval(timerId); focusEl.hidden = true; if (lastFocus) lastFocus.focus(); };
  $('#focusClose').addEventListener('click', closeFocus);
  $('#focusDone').addEventListener('click', () => { closeFocus(); if (focusTask) { focusTask.started = true; save(); } toast("Nice. You started. That's the hardest part."); });
  focusEl.addEventListener('click', e => { if (e.target === focusEl) closeFocus(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !focusEl.hidden) closeFocus(); });

  /* ---------- GUARD ---------- */
  const devStatus = d => {
    const n = daysSince(d.updated);
    if (n === null) return { cls: 'warn', label: 'Add last update date', ok: false, n };
    if (n <= 30) return { cls: 'ok', label: n === 0 ? 'Updated today' : `Updated ${n} day${n > 1 ? 's' : ''} ago`, ok: true, n };
    if (n <= 60) return { cls: 'warn', label: `Check for updates · ${n} days`, ok: false, n };
    return { cls: 'bad', label: `Overdue · ${n} days`, ok: false, n };
  };
  const guardEval = () => {
    const pwAge = state.pw.last ? Math.floor((Date.now() - state.pw.last) / DAY) : null;
    const items = [];
    items.push(pwAge === null ? { s: 'todo', t: 'Run a private password check' } : pwAge <= 30 ? { s: 'ok', t: `Password checked ${pwAge === 0 ? 'today' : pwAge + ' days ago'}` } : { s: 'bad', t: `Last password check was ${pwAge} days ago` });
    if (state.pw.last) items.push(state.pw.breached && !state.pw.resolved ? { s: 'bad', t: 'A leaked password still needs changing' } : { s: 'ok', t: 'No unresolved leaked passwords' });
    if (!state.devices.length) items.push({ s: 'todo', t: 'Add your devices for update reminders' });
    state.devices.forEach(d => { const st = devStatus(d); items.push({ s: st.ok ? 'ok' : 'bad', t: `${d.name}: ${st.label}` }); });
    const started = state.pw.last || state.devices.length;
    let score = null;
    if (started) {
      const pwPts = pwAge !== null && pwAge <= 30 ? 30 : 0;
      const leakPts = state.pw.last ? (state.pw.breached && !state.pw.resolved ? 0 : 30) : 0;
      const devPts = state.devices.length ? Math.round(40 * state.devices.filter(d => devStatus(d).ok).length / state.devices.length) : 0;
      score = pwPts + leakPts + devPts;
    }
    const issues = [];
    if (state.pw.breached && !state.pw.resolved) issues.push({ title: 'Change the password that showed up in a breach', guardType: 'pw' });
    if (pwAge === null || pwAge > 30) issues.push({ title: 'Run a private password breach check', guardType: 'pwcheck' });
    state.devices.forEach(d => { const st = devStatus(d); if (!st.ok && st.n !== null) issues.push({ title: `Update ${d.name}`, guardType: 'device', deviceId: d.id }); });
    return { items, score, issues };
  };

  const paintRing = (el, score) => { el.style.setProperty('--p', score ?? 0); el.dataset.label = score === null ? '—' : score; };
  const renderGuardSummary = () => {
    const g = guardEval();
    paintRing($('#guardRingMini'), g.score);
    $('#guardMini').textContent = g.score === null ? 'Not checked' : g.score >= 80 ? `${g.score} · Looking good` : `${g.score} · Needs attention`;
    const real = g.issues.filter(i => i.guardType !== 'pwcheck' || state.pw.last); // don't nag first-time visitors
    const badge = $('#guardBadge'); badge.hidden = !real.length; badge.textContent = real.length;
    const alert = $('#guardAlert');
    const already = state.tasks.filter(t => t.guard && !t.done).map(t => t.title);
    const newIssues = real.filter(i => !already.includes(i.title));
    alert.hidden = !newIssues.length;
    if (newIssues.length) {
      $('#guardAlertTitle').textContent = `Today's Guard check found ${newIssues.length} thing${newIssues.length > 1 ? 's' : ''}`;
      $('#guardAlertText').textContent = newIssues.map(i => i.title).join(' · ');
    }
  };
  $('#addGuardTasks').addEventListener('click', () => {
    const already = state.tasks.filter(t => t.guard && !t.done).map(t => t.title);
    guardEval().issues.filter(i => (i.guardType !== 'pwcheck' || state.pw.last) && !already.includes(i.title))
      .forEach(i => addTask(i.title, { guard: true, guardType: i.guardType, deviceId: i.deviceId }));
    toast('Added to today. Tap ⚡ to see how.');
  });

  const renderGuard = () => {
    const g = guardEval();
    paintRing($('#guardRing'), g.score);
    $('#guardChecklist').innerHTML = g.items.map(i => `<li class="${i.s === 'ok' ? 'ok' : i.s === 'bad' ? 'bad' : ''}"><i>${i.s === 'ok' ? '✓' : i.s === 'bad' ? '!' : '•'}</i>${esc(i.t)}</li>`).join('');
  };

  /* SHA-1: Web Crypto when available, tiny pure-JS fallback otherwise (e.g. opened from a file) */
  const sha1Fallback = msg => {
    const rotl = (n, s) => (n << s) | (n >>> (32 - s));
    const bytes = new TextEncoder().encode(msg); const len = bytes.length;
    const words = []; for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
    words[len >> 2] |= 0x80 << (24 - (len % 4) * 8); words[(((len + 8) >> 6) << 4) + 15] = len * 8;
    let [a, b, c, d, e] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0]; const w = new Array(80);
    for (let i = 0; i < words.length; i += 16) {
      let [A, B, C, D, E] = [a, b, c, d, e];
      for (let j = 0; j < 80; j++) {
        w[j] = j < 16 ? (words[i + j] | 0) : rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
        const f = j < 20 ? (B & C) | (~B & D) : j < 40 ? B ^ C ^ D : j < 60 ? (B & C) | (B & D) | (C & D) : B ^ C ^ D;
        const k = j < 20 ? 0x5A827999 : j < 40 ? 0x6ED9EBA1 : j < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
        const tmp = (rotl(A, 5) + f + E + k + w[j]) | 0; E = D; D = C; C = rotl(B, 30); B = A; A = tmp;
      }
      a = (a + A) | 0; b = (b + B) | 0; c = (c + C) | 0; d = (d + D) | 0; e = (e + E) | 0;
    }
    return [a, b, c, d, e].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('').toUpperCase();
  };
  const sha1 = async msg => {
    if (window.crypto?.subtle) {
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(msg));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    return sha1Fallback(msg);
  };

  const pwInput = $('#pwInput'); const pwRes = $('#pwResult');
  $('#pwEye').addEventListener('click', () => { const show = pwInput.type === 'password'; pwInput.type = show ? 'text' : 'password'; $('#pwEye').setAttribute('aria-label', show ? 'Hide password' : 'Show password'); });
  const showResult = (cls, html) => { pwRes.className = 'result show ' + cls; pwRes.innerHTML = html; };
  $('#pwForm').addEventListener('submit', async e => {
    e.preventDefault();
    const pw = pwInput.value; if (!pw) { pwInput.focus(); return; }
    const btn = $('#pwBtn'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const hash = await sha1(pw);
      const prefix = hash.slice(0, 5), suffix = hash.slice(5);
      const res = await fetch('https://api.pwnedpasswords.com/range/' + prefix);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.text();
      const lines = body.split('\n');
      const hit = lines.find(l => l.split(':')[0].trim() === suffix);
      const count = hit ? parseInt(hit.split(':')[1], 10) : 0;
      const trace = `<div class="leak-trace">sent → <span class="sent">${prefix}</span><br>kept on this device → <span class="kept">${suffix.slice(0, 12)}…</span><br>matches returned → ${lines.length} · compared locally</div>`;
      state.pw.last = Date.now(); state.pw.lastPrefix = prefix;
      if (count) {
        state.pw.breached = true; state.pw.resolved = false;
        showResult('bad', `<b>⚠️ This password has shown up ${count.toLocaleString()} time${count > 1 ? 's' : ''} in known data breaches.</b><br>Attackers try leaked passwords first. Change it anywhere you use it, and don't reuse it.<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-soft" id="pwToTask">Add "change it" to today</button><button class="btn btn-soft" id="pwResolved">I changed it ✓</button></div>${trace}`);
      } else {
        if (state.pw.breached && !state.pw.resolved) { /* keep earlier unresolved finding */ } else { state.pw.breached = false; state.pw.resolved = true; }
        showResult('good', `<b>✓ Good news: this password wasn't found in known breaches.</b><br>That doesn't make it unbreakable. Long and unique still wins.${trace}`);
      }
      save(); renderGuard(); renderToday();
    } catch (err) {
      showResult('info', "<b>Couldn't reach the breach database.</b><br>Check your connection and try again. Nothing was saved.");
    } finally {
      pwInput.value = ''; pwInput.type = 'password'; btn.disabled = false; btn.textContent = 'Check privately';
    }
  });
  pwRes.addEventListener('click', e => {
    if (e.target.id === 'pwToTask') { addTask('Change the password that showed up in a breach', { guard: true, guardType: 'pw' }); toast('Added to today.'); }
    if (e.target.id === 'pwResolved') { state.pw.resolved = true; state.tasks.filter(t => t.guardType === 'pw' && !t.done).forEach(t => { t.done = true; t.doneOn = today; }); save(); renderGuard(); renderToday(); toast('Nice. Guard score updated.'); e.target.disabled = true; }
  });

  /* ---------- DEVICES ---------- */
  const ICON = { phone: '📱', laptop: '💻', tablet: '📲', router: '📶', watch: '⌚', other: '🔌' };
  const HOWTO = { phone: 'Settings → General → Software Update (iPhone) or Settings → System → Software update (Android)', laptop: 'Mac: System Settings → General → Software Update · Windows: Settings → Windows Update', tablet: 'Settings → Software Update', router: "Open your router's app or admin page and look for Firmware update", watch: 'Update from the companion app on your phone', other: "Check the maker's app or website for updates" };
  const detectDevice = () => {
    const ua = navigator.userAgent;
    let os = 'your device', type = 'laptop';
    if (/iPhone/.test(ua)) { os = 'iPhone'; type = 'phone'; }
    else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) { os = 'iPad'; type = 'tablet'; }
    else if (/Android/.test(ua)) { os = /Mobile/.test(ua) ? 'Android phone' : 'Android tablet'; type = /Mobile/.test(ua) ? 'phone' : 'tablet'; }
    else if (/Mac OS X|Macintosh/.test(ua)) os = 'Mac';
    else if (/Windows/.test(ua)) os = 'Windows PC';
    else if (/CrOS/.test(ua)) os = 'Chromebook';
    else if (/Linux/.test(ua)) os = 'Linux computer';
    const B = [['Edge', /Edg\/(\d+)/], ['Opera', /OPR\/(\d+)/], ['Chrome', /Chrome\/(\d+)/], ['Firefox', /Firefox\/(\d+)/], ['Safari', /Version\/(\d+).*Safari/]];
    let b = ['your browser', '']; for (const [n, re] of B) { const m = re.exec(ua); if (m) { b = [n, m[1]]; break; } }
    return { os, type, browser: b[0] + (b[1] ? ' ' + b[1] : '') };
  };
  const det = detectDevice();
  const renderDetect = () => {
    $('#detect').innerHTML = `<span>🔎 Looks like you're on a <b>${esc(det.os)}</b> using <b>${esc(det.browser)}</b>. We can't look inside your device (that's a good thing), so tell us when it was last updated.</span><button class="btn btn-soft" id="useDetected">Use this device</button>`;
    $('#useDetected').addEventListener('click', () => { $('#devType').value = det.type; $('#devName').value = 'My ' + det.os; $('#devDate').focus(); toast('Now pick the date it was last updated.'); });
  };
  $('#devDate').max = today;
  $('#devForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#devName').value.trim(); if (!name) { $('#devName').focus(); return; }
    const updated = $('#devDate').value || null;
    state.devices.push({ id: uid(), type: $('#devType').value, name, updated });
    save(); $('#devName').value = ''; $('#devDate').value = ''; renderDevices(); renderToday();
    toast(updated ? `${name} added.` : `${name} added. Add its last update date for reminders.`);
  });
  const renderDevices = () => {
    renderDetect();
    const el = $('#devList');
    if (!state.devices.length) { el.innerHTML = '<div class="empty" style="grid-column:1/-1"><b>No devices yet</b>Add your phone, laptop and Wi-Fi router. Those three cover most of your risk.</div>'; return; }
    el.innerHTML = state.devices.map(d => { const st = devStatus(d); return `
      <div class="dev" data-id="${d.id}" data-tilt-sm>
        <div class="dev-ic">${ICON[d.type] || '🔌'}</div><h5>${esc(d.name)}</h5>
        <small>${d.updated ? 'Last updated ' + new Date(d.updated + 'T12:00:00').toLocaleDateString() : 'Last update unknown'}</small><br>
        <span class="pill ${st.cls}">${st.label}</span>
        ${!st.ok ? `<p style="font-size:12px;color:#7a86a0;margin:0 0 10px;line-height:1.5">How: ${esc(HOWTO[d.type])}</p>` : ''}
        <div class="dev-actions"><button class="btn btn-soft" data-dact="updated">Updated today ✓</button><button class="icon-btn" data-dact="del" aria-label="Remove ${esc(d.name)}">✕</button></div>
      </div>`; }).join('');
  };
  $('#devList').addEventListener('click', e => {
    const b = e.target.closest('[data-dact]'); if (!b) return;
    const card = b.closest('.dev'); const d = state.devices.find(x => x.id === card.dataset.id); if (!d) return;
    if (b.dataset.dact === 'updated') { d.updated = today; state.tasks.filter(t => t.deviceId === d.id && !t.done).forEach(t => { t.done = true; t.doneOn = today; }); toast(`${d.name} is up to date. Nice.`); const r = b.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top); }
    else { state.devices = state.devices.filter(x => x !== d); toast('Device removed.'); }
    save(); renderDevices(); renderToday();
  });

  /* ---------- MY DATA ---------- */
  const renderLedger = () => {
    const bytes = new Blob([localStorage.getItem(KEY) || '']).size;
    $('#ledger').innerHTML = [
      ['Your tasks & first steps', '<span class="tag-local">This browser only</span>', `${state.tasks.length} task${state.tasks.length === 1 ? '' : 's'}`],
      ['Your devices & update dates', '<span class="tag-local">This browser only</span>', `${state.devices.length} device${state.devices.length === 1 ? '' : 's'}`],
      ['Streak history', '<span class="tag-local">This browser only</span>', `${Object.keys(state.days).length} day${Object.keys(state.days).length === 1 ? '' : 's'} logged`],
      ['Passwords you check', '<b>Never stored anywhere</b>', 'Cleared from the screen right after checking'],
      ['Sent over the internet', '<span class="tag-out">Have I Been Pwned (5 characters)</span>', state.pw.lastPrefix ? `Last sent: <code>${esc(state.pw.lastPrefix)}</code> on ${new Date(state.pw.last).toLocaleDateString()}` : 'Nothing sent yet'],
      ['Sent to AI (Claude by Anthropic)', '<span class="tag-out">Only when you press ✨ Plan my day</span>', state.ai.count ? `${state.ai.count} request${state.ai.count > 1 ? 's' : ''} · last: ${state.ai.lastChars} characters on ${new Date(state.ai.last).toLocaleDateString()}` : 'Nothing sent yet'],
      ['Total saved on this device', '<span class="tag-local">localStorage</span>', `${bytes.toLocaleString()} bytes`],
    ].map(r => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
  };
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'ClinicGuard Personal', exported: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `clinicguard-personal-${today}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast('Exported. That file is your backup.');
  });
  let wipeArmed = false;
  $('#wipeBtn').addEventListener('click', e => {
    if (!wipeArmed) { wipeArmed = true; e.currentTarget.textContent = '⚠️ Tap again to erase everything'; setTimeout(() => { wipeArmed = false; $('#wipeBtn').textContent = '🗑 Erase everything'; }, 4000); return; }
    state = fresh(); try { localStorage.removeItem(KEY); } catch {} wipeArmed = false;
    $('#wipeBtn').textContent = '🗑 Erase everything'; renderLedger(); renderToday(); toast('Everything erased from this device.');
  });

  /* ---------- early-access signup (Formspree) ---------- */
  const earlyForm = $('#earlyForm');
  $$('[data-vault-interest]').forEach(a => a.addEventListener('click', () => { $('#earlyVault').checked = true; }));
  earlyForm.addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#earlyEmail').value.trim(), msg = $('#earlyMsg'), btn = $('#earlyBtn');
    msg.className = 'early-msg';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
      msg.textContent = 'Please enter a valid email address.'; msg.classList.add('err'); $('#earlyEmail').focus(); return;
    }
    if (earlyForm.action.includes('REPLACE_ME')) {
      msg.textContent = 'Signups are being connected. Please check back soon.'; msg.classList.add('err'); return;
    }
    btn.disabled = true; btn.textContent = 'Joining…';
    try {
      const r = await fetch(earlyForm.action, { method: 'POST', body: new FormData(earlyForm), headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error();
      earlyForm.reset(); msg.textContent = "You're on the list! We'll email you when early access opens."; msg.classList.add('ok');
      { const r = btn.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top); }
    } catch { msg.textContent = "Couldn't sign you up right now. Please try again in a minute."; msg.classList.add('err'); }
    finally { btn.disabled = false; btn.textContent = 'Join the list'; }
  });


  /* ---------- ✨ AI PLANNER (Plus AI preview) ---------- */
  const planOut = $('#planOut');
  const PRIO = { high: 'High', medium: 'Medium', low: 'Low' };
  const renderPlan = () => {
    const p = state.lastPlan;
    if (!p) { planOut.innerHTML = ''; return; }
    const added = p.added || [];
    planOut.innerHTML = `
      <div class="plan-summary"><span style="font-size:26px">✨</span><div><b>${esc(p.summary || 'Your plan for today')}</b><p>Made ${new Date(p.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · ${p.blocks.length} block${p.blocks.length === 1 ? '' : 's'}. Add what you like to Today.</p></div></div>
      <div class="plan-grid">${p.blocks.map((b, i) => `
        <div class="plan-block" style="animation-delay:${i * 80}ms">
          <div class="plan-time">${esc(b.time)}<small>${b.minutes ? esc(b.minutes) + ' min' : ''}</small></div>
          <div><h5>${esc(b.title)}${b.priority && PRIO[b.priority] ? `<span class="prio ${b.priority}">${PRIO[b.priority]}</span>` : ''}</h5>${b.why ? `<p>${esc(b.why)}</p>` : ''}${b.firstStep ? `<p class="plan-step">⚡ <b>First step:</b> ${esc(b.firstStep)}</p>` : ''}</div>
          <button class="btn btn-soft" data-add-block="${i}" ${added.includes(i) ? 'disabled' : ''}>${added.includes(i) ? 'Added ✓' : '+ Today'}</button>
        </div>`).join('')}</div>
      <div class="plan-actions"><button class="btn btn-dark" id="addAllPlan">Add all to Today</button><button class="btn btn-soft" id="clearPlan">Clear plan</button></div>
      ${p.tip ? `<p class="plan-tip">💡 ${esc(p.tip)}</p>` : ''}`;
  };
  const addBlock = i => {
    const p = state.lastPlan; const b = p && p.blocks[i]; if (!b) return;
    p.added = p.added || []; if (p.added.includes(i)) return;
    addTask(b.title, { step: b.firstStep || firstStep(b.title), ai: true });
    p.added.push(i); save();
  };
  planOut.addEventListener('click', e => {
    const one = e.target.closest('[data-add-block]');
    if (one) { addBlock(+one.dataset.addBlock); renderPlan(); toast('Added to Today.'); return; }
    if (e.target.id === 'addAllPlan') { state.lastPlan.blocks.forEach((_, i) => addBlock(i)); renderPlan(); toast('Your plan is in Today. Tap ⚡ on any task to start.'); location.hash = '#/app'; showTab('today'); }
    if (e.target.id === 'clearPlan') { state.lastPlan = null; save(); renderPlan(); }
  });

  const consentEl = $('#aiConsent'); let pendingPlan = null;
  const askConsent = () => new Promise(resolve => {
    consentEl.hidden = false; $('#aiAgree').focus();
    pendingPlan = ok => { consentEl.hidden = true; pendingPlan = null; resolve(ok); };
  });
  $('#aiAgree').addEventListener('click', () => { if ($('#aiRemember').checked) { state.ai.consent = true; save(); } pendingPlan && pendingPlan(true); });
  $('#aiCancel').addEventListener('click', () => pendingPlan && pendingPlan(false));
  consentEl.addEventListener('click', e => { if (e.target === consentEl && pendingPlan) pendingPlan(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !consentEl.hidden && pendingPlan) pendingPlan(false); });

  $('#planForm').addEventListener('submit', async e => {
    e.preventDefault();
    const text = $('#dump').value.trim();
    if (text.length < 3) { $('#dump').focus(); toast('Type a few things on your mind first.'); return; }
    if (!state.ai.consent && !(await askConsent())) { toast('No problem. Nothing was sent.'); return; }
    const btn = $('#planBtn'); btn.disabled = true; btn.textContent = 'Planning…';
    planOut.innerHTML = '<div class="loading"><span class="spinner"></span>Claude is building your plan…</div>';
    const payload = { text, hours: $('#hours').value, energy: $('#energy').value, localTime: new Date().toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' }) };
    try {
      const res = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      let data = {}; try { data = await res.json(); } catch { /* non-JSON (e.g. no server) */ }
      state.ai.count++; state.ai.last = Date.now(); state.ai.lastChars = text.length;
      if (!res.ok || !Array.isArray(data.blocks)) throw new Error(data.error || (res.status === 404 ? 'The AI server isn\'t running here. Open the live site (or run "vercel dev") to use AI.' : 'The AI planner had a problem. Please try again.'));
      state.lastPlan = { ...data, at: Date.now(), added: [] }; save(); renderPlan();
      toast('✨ Your plan is ready.');
    } catch (err) {
      save();
      planOut.innerHTML = `<div class="result show info"><b>Couldn't make a plan right now.</b><br>${esc(err.message || 'Check your connection and try again.')}</div>`;
    } finally { btn.disabled = false; btn.textContent = '✨ Plan my day'; }
  });

  /* ---------- nav ---------- */
  const header = $('.site-header'); const bar = $('.scroll-progress');
  const toggle = $('.menu-toggle'); const menu = $('#mobile-menu');
  toggle.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; toggle.setAttribute('aria-expanded', open); });
  $$('#mobile-menu a').forEach(a => a.addEventListener('click', () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }));

  /* ---------- scroll interactions ---------- */
  const stage = $('#stage3d'); const cube = $('#cube');
  let mx = 0, my = 0;
  function onScroll() {
    const y = window.scrollY; const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    header.classList.toggle('scrolled', y > 10);
    if (!reduceMotion && current === 'home' && y < innerHeight * 1.2) stage.style.transform = `translateY(${y * 0.18}px) rotateY(${mx * 10 - y * 0.012}deg) rotateX(${-my * 8 + y * 0.01}deg)`;
  }
  addEventListener('scroll', onScroll, { passive: true });
  if (!reduceMotion) $('.hero').addEventListener('mousemove', e => { const r = e.currentTarget.getBoundingClientRect(); mx = (e.clientX - r.left) / r.width - .5; my = (e.clientY - r.top) / r.height - .5; onScroll(); });

  const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('visible'); io.unobserve(en.target); } }), { threshold: .12 });
  $$('.reveal').forEach(el => io.observe(el));

  const stepIO = new IntersectionObserver(es => es.forEach(en => {
    if (!en.isIntersecting) return;
    const i = +en.target.dataset.step;
    $$('.step').forEach(s => s.classList.toggle('active', s === en.target));
    cube.style.transform = `rotateY(${-90 * i}deg) rotateX(${i === 1 ? 6 : -4}deg)`;
  }), { rootMargin: '-45% 0px -45% 0px' });
  $$('.step').forEach(s => stepIO.observe(s));


  const shellIO = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.remove('pre'); shellIO.disconnect(); } }), { threshold: .15 });
  shellIO.observe(shell);

  // 3D tilt cards
  if (!reduceMotion && matchMedia('(hover:hover)').matches) {
    $$('[data-tilt]').forEach(card => {
      card.addEventListener('mousemove', e => {
        const r = card.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        card.style.transform = `rotateY(${(x - .5) * 16}deg) rotateX(${(.5 - y) * 14}deg) translateZ(10px)`;
        card.style.setProperty('--mx', x * 100 + '%'); card.style.setProperty('--my', y * 100 + '%');
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    });
  }

  /* ---------- hero orb: 3D point sphere ---------- */
  const cv = $('#orb'); const ctx = cv.getContext('2d');
  const N = innerWidth < 700 ? 420 : 760; const pts = [];
  for (let i = 0; i < N; i++) { const y = 1 - (i / (N - 1)) * 2; const r = Math.sqrt(1 - y * y); const th = Math.PI * (3 - Math.sqrt(5)) * i; pts.push([Math.cos(th) * r, y, Math.sin(th) * r]); }
  let rot = 0, visible = true, raf;
  function size() { if (!cv.clientWidth) return; const dpr = Math.min(devicePixelRatio || 1, 2); cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  size(); addEventListener('resize', size);
  const draw = () => {
    const w = cv.clientWidth, hgt = cv.clientHeight; ctx.clearRect(0, 0, w, hgt);
    const R = Math.min(w, hgt) * .36, cx = w * .55, cy = hgt * .5;
    const ay = rot + mx * .8, ax = .35 + my * .5;
    const sy = Math.sin(ay), cyy = Math.cos(ay), sx = Math.sin(ax), cxx = Math.cos(ax);
    for (const [x, y, z] of pts) {
      let X = x * cyy - z * sy, Z = x * sy + z * cyy; let Y = y * cxx - Z * sx; Z = y * sx + Z * cxx;
      const p = 2.6 / (2.6 - Z); const px = cx + X * R * p, py = cy + Y * R * p; const d = (Z + 1) / 2;
      ctx.fillStyle = `rgba(${Math.round(72 + (150 - 72) * (1 - d))},${Math.round(191 - 60 * (1 - d))},${Math.round(206 + 20 * (1 - d))},${.12 + d * .55})`;
      ctx.beginPath(); ctx.arc(px, py, .6 + d * 1.9, 0, Math.PI * 2); ctx.fill();
    }
  };
  const loop = () => { rot += .0026; draw(); if (visible) raf = requestAnimationFrame(loop); };
  if (reduceMotion) draw(); else {
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; cancelAnimationFrame(raf); if (visible) loop(); }).observe(cv);
  }

  /* ---------- go ---------- */
  renderToday(); renderGuard(); route(); onScroll();
})();
