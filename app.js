/* Comeback Together: starting is easier together.
   Tasks, steps, sessions and reflections live in this browser (localStorage).
   The server only knows: account, plan, sharing choices, buddy link, and (only while sharing) "focusing now".
   Rule: nothing moves without the user's tap, and every change can be undone. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const MIN = 60000, DAY = 86400000, START_MIN = 5;
  const { parseWhen, formatWhen } = window.ComebackWhen;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const buzz = (ms = 12) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* unsupported */ } };
  const typing = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

  /* ---------- state ---------- */
  const KEY = 'comeback:v1';
  const fresh = () => ({ v: 3, tasks: [], selectedId: null, session: null, anonId: uid(), aiConsent: false, recoveries: [], sessions: [], reflections: [], onboarded: false, dismissedResume: null });
  let state;
  try { state = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { state = fresh(); }
  state.sessions = state.sessions || []; state.reflections = state.reflections || [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ } };

  /* ---------- theme ---------- */
  const themeBtn = $('#themeBtn');
  const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  const paintThemeBtn = () => themeBtn.setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
  themeBtn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('comeback:theme', next); } catch { /* ignore */ }
    paintThemeBtn(); buzz(6);
  });
  paintThemeBtn();

  /* ---------- toast with undo ---------- */
  const toastEl = $('#toast'); let toastT, toastFn = null;
  function toast(msg, action) {
    $('#toastMsg').textContent = msg;
    const btn = $('#toastAction');
    toastFn = action ? action.fn : null;
    btn.hidden = !action; if (action) btn.textContent = action.label;
    toastEl.classList.toggle('has-action', !!action);
    toastEl.classList.remove('show'); void toastEl.offsetWidth; toastEl.classList.add('show');
    const ms = action ? 6000 : 3000;
    $('#toastBar').style.animationDuration = ms + 'ms';
    clearTimeout(toastT); toastT = setTimeout(() => { toastEl.classList.remove('show'); toastFn = null; }, ms);
  }
  $('#toastAction').addEventListener('click', () => { const f = toastFn; toastFn = null; toastEl.classList.remove('show'); if (f) f(); });
  function change(label, fn) {
    const snap = JSON.stringify({ tasks: state.tasks, selectedId: state.selectedId });
    fn(); save(); renderNow();
    toast(label, { label: 'Undo', fn: () => { const o = JSON.parse(snap); state.tasks = o.tasks; state.selectedId = o.selectedId; save(); renderNow(); buzz(8); toast('Undone.'); } });
  }

  /* ---------- helpers ---------- */
  const track = name => {
    try { fetch('/api/event', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, anonId: state.anonId }) }).catch(() => {}); } catch { /* never break the app */ }
  };
  const api = async (url, opts = {}) => {
    try {
      const res = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts });
      let data = {}; try { data = await res.json(); } catch { data = { error: res.status === 404 ? 'The server isn\'t running here. Use the live site.' : 'Unexpected server response.' }; }
      return { ok: res.ok, status: res.status, data };
    } catch { return { ok: false, status: 0, data: { error: 'You seem to be offline. Try again when you\'re connected.' } }; }
  };
  const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body || {}) });
  const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const mins = ms => Math.max(0, Math.round(ms / MIN));
  const clock = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const toLocalInput = ts => { const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  function burst(x, y) {
    if (reduceMotion) return;
    const b = $('#burst');
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('i'); const a = (Math.PI * 2 * i) / 12; const d = 34 + Math.random() * 30;
      p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.setProperty('--dx', Math.cos(a) * d + 'px'); p.style.setProperty('--dy', Math.sin(a) * d + 'px');
      p.style.background = ['#7c5cff', '#3d7bff', '#ff8a6b', '#b8a6ff'][i % 4];
      b.appendChild(p); setTimeout(() => p.remove(), 750);
    }
  }

  /* ---------- quick steps (no AI, nothing sent) ---------- */
  const RULES = [
    [/essay|paper|report|write|draft|thesis|blog/i, 'Open a blank doc and write just the title and 3 bullet ideas.', 'Write one messy sentence about what the essay is about.'],
    [/stud|exam|quiz|test|midterm|final|review/i, 'Open your notes and review just one example problem.', 'Write down the 3 topics you think will be on it.'],
    [/apply|application|internship|job|resume|cv|cover letter/i, 'Open the posting and copy its 3 key requirements into a note.', 'Open your resume and fix just the first bullet.'],
    [/email|reply|message|text|dm|respond/i, 'Open the email and write only the first sentence of your reply.', 'Write the subject line and one bullet of what you want to say.'],
    [/clean|laundry|room|dishes|tidy|organi/i, 'Clear just one surface. Only one.', 'Put 5 things back where they belong.'],
    [/gym|workout|run|exercise|walk|lift/i, 'Put on your workout clothes. That counts as starting.', 'Fill your water bottle and put your shoes by the door.'],
    [/read|chapter|book|article/i, 'Read just the first page.', 'Skim the headings and pick one section to read.'],
    [/call|appointment|book|schedule|doctor|dentist/i, 'Find the phone number or booking link and copy it somewhere.', 'Write down the one question you need to ask.'],
    [/pay|bill|rent|invoice|tuition|loan/i, 'Open the payment page and check the due date and amount.', 'Find the bill in your email and star it.'],
    [/code|project|build|lab|assignment|homework|hw/i, 'Open the assignment and read only the first question.', "Write down the very next file or question you'll touch."],
    [/present|slides|deck|pitch/i, 'Write the title of every slide, nothing else.', 'Write the one sentence your audience should remember.'],
  ];
  const GENERIC = ['Open whatever you need for this and look at it for 2 minutes.', 'Write one sentence about what "done" looks like.', 'Set a 5-minute timer and do the easiest tiny part.', 'Clear your desk of everything except what you need for this.'];
  const quickFirst = title => (RULES.find(([re]) => re.test(title)) || [0, GENERIC[0]])[1];
  const quickAlts = title => { const r = RULES.find(([re]) => re.test(title)); return [...(r ? [r[1], r[2]] : []), ...GENERIC]; };
  const quickSteps = title => [quickFirst(title), 'Keep going for 5 more minutes. Messy is fine.', 'Write one line about where you stopped, so next time is easy.'];
  const eventSteps = dueAt => ['Open or gather what you need for it.', `Be there at ${clock(dueAt)}.`];

  function newTask(title, steps, source, extra = {}) {
    const clean = String(title).trim().slice(0, 80);
    return { id: uid(), title: clean.charAt(0).toUpperCase() + clean.slice(1), steps: steps.map(text => ({ id: uid(), text, done: false })), source, kind: 'task', dueAt: null, dayOnly: false,
      createdAt: Date.now(), firstStartAt: null, finishedAt: null, droppedAt: null, focusMs: 0, distractions: 0, firstMinutes: null, rejected: [], ...extra };
  }
  const byId = id => state.tasks.find(t => t.id === id);
  const curIndex = t => { const i = t.steps.findIndex(s => !s.done); return i === -1 ? t.steps.length : i; };
  const curStep = t => t.steps[Math.min(curIndex(t), t.steps.length - 1)];
  const isOpen = t => !t.finishedAt && !t.droppedAt;
  const isMissed = (t, now = Date.now()) => isOpen(t) && t.dueAt && now > t.dueAt + (t.kind === 'event' ? 15 * MIN : 0);
  const openTasks = () => state.tasks.filter(isOpen);

  if (!state.migrated) {
    try {
      const old = JSON.parse(localStorage.getItem('clinicguard-personal:v1') || 'null');
      (old?.tasks || []).filter(t => !t.done && t.title).slice(0, 20).forEach(t => state.tasks.push(newTask(t.title, [t.step || quickFirst(t.title), 'Keep going for 5 more minutes. Messy is fine.'], 'quick')));
    } catch { /* ignore */ }
    state.migrated = true; save();
  }
  state.tasks.forEach(t => { t.kind = t.kind || 'task'; if (t.dueAt === undefined) t.dueAt = null; t.rejected = t.rejected || []; });

  /* ---------- router ---------- */
  const VIEWS = ['home', 'now', 'together', 'progress', 'account', 'join'];
  const TITLES = { home: 'Comeback · Starting is easier together', now: 'Start · Comeback', together: 'Better Together · Comeback', progress: 'Your beginnings · Comeback', account: 'Account · Comeback', join: 'You\'re invited · Comeback' };
  let current = null, joinToken = null;
  const route = () => {
    const h = location.hash; const isRoute = h.startsWith('#/');
    let name = isRoute ? h.slice(2) : 'home';
    if (name.startsWith('join/')) { joinToken = name.slice(5); name = 'join'; }
    if (!VIEWS.includes(name)) name = 'home';
    if (name !== current || name === 'join') {
      current = name;
      $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
      document.body.classList.toggle('in-app', name !== 'home');
      $$('[data-tab]').forEach(a => a.setAttribute('aria-current', a.dataset.tab === name ? 'page' : 'false'));
      document.title = TITLES[name];
      if (name !== 'now') $('#intro').hidden = true;
      if (name === 'now') { renderNow(); maybeIntro(); }
      if (name === 'together') renderTogether();
      if (name === 'progress') renderProgress();
      if (name === 'account') renderLedger();
      if (name === 'join') renderJoin();
      if (isRoute || !h) window.scrollTo({ top: 0, behavior: 'instant' });
    }
    if (!isRoute && h.length > 1) { const el = document.getElementById(h.slice(1)); if (el) el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); }
  };
  addEventListener('hashchange', route);

  /* ---------- landing ---------- */
  $('#heroForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#heroTask').value.trim();
    location.hash = '#/now';
    if (v) { $('#askInput').value = v; $('#heroTask').value = ''; createFromAsk(); } else setTimeout(() => $('#askInput').focus(), 60);
  });

  /* ---------- START screen ---------- */
  const planCard = $('#planCard');
  const selected = () => { const t = byId(state.selectedId); return t && isOpen(t) && !isMissed(t) ? t : null; };

  function renderNow() {
    const open = openTasks();
    const u = account.user;
    const first = !state.sessions.length && !state.tasks.length;
    $('#greet').textContent = first ? 'Hey there.' : u?.name ? `Hey ${u.name}, welcome back.` : 'Hey, welcome back.';
    $('#firstRun').hidden = !!selected();
    renderAskNote(); renderBuddyStrip(); renderUpNext(); renderMissed(); renderPlan(); renderList();
    void open;
  }

  // rotating placeholder: calm, stops when the user is typing
  const EXAMPLES = ['Study for my exam', 'Clean my room', 'Start my assignment', 'Reply to an important email', 'Work on my project'];
  let exI = 0;
  setInterval(() => {
    const el = $('#askInput');
    if (current !== 'now' || el.value || document.activeElement === el) return;
    exI = (exI + 1) % EXAMPLES.length; el.placeholder = `What's on your mind? e.g. ${EXAMPLES[exI].toLowerCase()}`;
  }, 2800);

  function renderAskNote() {
    const u = account.user; const n = $('#askNote');
    if (!account.loaded) { n.textContent = ''; return; }
    const tip = '<span class="tip">Tip: add a time like "at 3pm" or "by Fri".</span>';
    if (!u) n.innerHTML = tip + 'Quick steps work right away. <a href="#/account">Create a free account</a> for ✨ AI first steps written for you.';
    else if (u.aiLeft > 0) n.innerHTML = tip + `✨ AI first steps on · ${u.aiLeft} left today${u.plan === 'personal' ? '' : ' · <a href="#/account">Upgrade</a>'}`;
    else n.innerHTML = tip + `Today's AI steps are used up, so you'll get quick steps.${u.plan === 'personal' ? '' : ' <a href="#/account">Founding members</a> get 100 a day.'}`;
  }

  // composer: Enter = Help me begin, Shift+Enter = new line, grows with text
  const askInput = $('#askInput');
  const growAsk = () => { askInput.style.height = 'auto'; askInput.style.height = Math.min(askInput.scrollHeight, 160) + 'px'; };
  askInput.addEventListener('input', growAsk);
  askInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); createFromAsk(); } });
  $('#askForm').addEventListener('submit', e => { e.preventDefault(); createFromAsk(); });
  $$('[data-ask]').forEach(b => b.addEventListener('click', () => { askInput.value = b.dataset.ask; createFromAsk(); }));
  $('#knowBtn').addEventListener('click', e => {
    const box = $('#knowBox'); box.hidden = !box.hidden; e.currentTarget.setAttribute('aria-expanded', !box.hidden);
    if (!box.hidden) $('#knowInput').focus();
  });
  const startOwn = () => {
    const stepText = $('#knowInput').value.trim();
    if (stepText.length < 2) { $('#knowInput').focus(); toast('Write your first step.'); return; }
    const p = parseWhen(askInput.value.trim() || stepText);
    const t = newTask(askInput.value.trim() ? p.title : stepText, [stepText, 'Keep going for 5 more minutes. Messy is fine.'], 'own', { firstMinutes: START_MIN });
    if (askInput.value.trim() && p.dueAt) { t.dueAt = p.dueAt; t.dayOnly = p.dayOnly; }
    state.tasks.unshift(t); state.selectedId = t.id; save();
    askInput.value = ''; $('#knowInput').value = ''; $('#knowBox').hidden = true; growAsk();
    track('own_step'); track('task_created');
    renderNow(); startSession(t, START_MIN);
  };
  $('#knowGo').addEventListener('click', startOwn);
  $('#knowInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); startOwn(); } });

  function renderBuddyStrip() {
    const b = together.data?.buddy; const el = $('#buddyStrip');
    if (!b) { el.hidden = true; return; }
    el.hidden = false;
    const line = b.focusing ? `<b>${esc(b.name)}</b> is taking a small step right now` : b.showedUpToday ? `<b>${esc(b.name)}</b> showed up today 💜` : `<b>${esc(b.name)}</b> is your buddy`;
    const sub = together.data.me.shareStatus ? `${esc(b.name)} can see when you start` : 'Your sharing is paused';
    el.innerHTML = `<span class="av">${esc(b.name.charAt(0).toUpperCase())}</span><span>${line}<small>${sub}</small></span>${b.focusing ? '<i class="live" aria-label="focusing now"></i>' : ''}`;
  }

  function renderUpNext() {
    const now = Date.now();
    const next = openTasks().filter(t => t.kind === 'event' && t.dueAt && t.dueAt >= now - 15 * MIN && t.dueAt <= now + 3 * 3600000).sort((a, b) => a.dueAt - b.dueAt)[0];
    const el = $('#upNext'); el.hidden = !next; if (!next) return;
    const m = Math.round((next.dueAt - now) / MIN);
    el.dataset.id = next.id;
    el.innerHTML = `<span class="un-ico" aria-hidden="true">⏰</span><span><b>${esc(next.title)}</b><small>${m > 0 ? `in ${m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'}` : 'now'} · ${clock(next.dueAt)}</small></span><span class="un-go" aria-hidden="true">›</span>`;
  }
  $('#upNext').addEventListener('click', e => { const t = byId(e.currentTarget.dataset.id); if (t) { state.selectedId = t.id; save(); renderNow(); planCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } });

  function renderMissed() {
    const list = openTasks().filter(t => isMissed(t)).sort((a, b) => a.dueAt - b.dueAt);
    $('#missedCard').hidden = !list.length;
    $('#missedCount').textContent = list.length;
    $('#missedList').innerHTML = list.map(t => {
      const when = formatWhen(t.dueAt, new Date(), t.dayOnly);
      const choices = t.kind === 'event'
        ? `<button class="btn btn-ghost" data-m="happened">✓ It happened</button><button class="btn btn-primary" data-m="reschedule">Reschedule with them</button><button class="btn btn-ghost" data-m="drop">Drop it</button>`
        : `<button class="btn btn-primary" data-m="now">Do 5 min now</button><button class="btn btn-ghost" data-m="tomorrow">Tomorrow</button><button class="btn btn-ghost" data-m="untime">No deadline</button><button class="btn btn-ghost" data-m="drop">Drop it</button>`;
      return `<li data-id="${t.id}"><div class="mi-t"><b>${esc(t.title)}</b><span>${t.kind === 'event' ? 'Missed' : 'Was due'} · ${esc(when)}</span></div><div class="choices">${choices}</div></li>`;
    }).join('');
  }

  // Moment B: one clear first step
  function renderPlan(animate) {
    const t = selected();
    if (!t) { planCard.hidden = true; return; }
    planCard.hidden = false;
    $('#firstSkel').hidden = true; $('#firstStepWrap').hidden = false; $('#startBtn').hidden = false; $('.first-actions').hidden = false; $('#wholePlan').hidden = false;
    if (document.activeElement !== $('#planTitle')) $('#planTitle').value = t.title;
    const badge = $('#planBadge');
    badge.textContent = t.kind === 'event' ? '📅 Event' : t.source === 'ai' ? '✨ AI step' : t.source === 'own' ? 'Your step' : 'Quick step';
    badge.className = 'badge' + (t.kind === 'event' ? ' event' : t.source === 'ai' ? '' : ' quick');
    const ci = curIndex(t); const step = curStep(t);
    $('#firstKick').textContent = t.kind === 'event' ? `Coming up · ${formatWhen(t.dueAt)}` : ci === 0 ? 'Let\'s make starting easy.' : `Welcome back. Step ${ci + 1} of ${t.steps.length}.`;
    const ft = $('#firstText');
    if (ft.textContent !== step.text) { ft.textContent = step.text; if (animate && !reduceMotion) { ft.classList.remove('swap'); void ft.offsetWidth; ft.classList.add('swap'); } }
    const m = ci === 0 && t.firstMinutes ? t.firstMinutes : START_MIN;
    $('#firstMeta').textContent = `⏱ about ${m} minute${m === 1 ? '' : 's'}${t.dueAt ? ` · ${t.kind === 'event' ? '📅' : '⏰'} ${formatWhen(t.dueAt, new Date(), t.dayOnly)}` : ''}`;
    $('#startBtn').textContent = ci === 0 ? 'Start now' : 'Continue now';
    $('#stepCount').textContent = `(${t.steps.length} steps)`;
    $('#planWhen').value = t.dueAt ? toLocalInput(t.dueAt) : '';
    $('#clearWhen').hidden = !t.dueAt;
    $('#planTip').textContent = t.tip || '';
    $('#planSteps').innerHTML = t.steps.map((s, i) => `<li class="${s.done ? 'done' : ''}${i === ci ? ' cur' : ''}" data-id="${s.id}"><label class="sr-only" for="st-${s.id}">Step ${i + 1}</label><textarea id="st-${s.id}" rows="1" maxlength="140">${esc(s.text)}</textarea><button type="button" class="step-x" data-del="${s.id}" aria-label="Remove step ${i + 1}">×</button></li>`).join('');
    $$('#planSteps textarea').forEach(fit);
  }
  function fit(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  addEventListener('resize', () => $$('#planSteps textarea').forEach(fit));
  $('#wholePlan').addEventListener('toggle', () => $$('#planSteps textarea').forEach(fit));

  function showThinking(title) {
    planCard.hidden = false;
    $('#planTitle').value = title; $('#planBadge').textContent = '✨ Thinking'; $('#planBadge').className = 'badge';
    $('#firstKick').textContent = 'Finding a tiny first step…';
    $('#firstSkel').hidden = false; $('#firstStepWrap').hidden = true; $('#startBtn').hidden = true; $('.first-actions').hidden = true; $('#wholePlan').hidden = true;
  }

  const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>';
  function renderList() {
    const list = openTasks().filter(t => !isMissed(t) && t.id !== state.selectedId);
    $('#listCard').hidden = !list.length;
    $('#listHint').hidden = list.length < 2;
    $('#taskList').innerHTML = list.map(t => {
      const ci = curIndex(t);
      const meta = [];
      if (t.dueAt) meta.push(`<span class="tchip${t.kind === 'event' ? ' ev' : ''}">${t.kind === 'event' ? '📅' : '⏰'} ${esc(formatWhen(t.dueAt, new Date(), t.dayOnly))}</span>`);
      if (t.kind !== 'event') meta.push(t.firstStartAt ? `Step ${Math.min(ci + 1, t.steps.length)} of ${t.steps.length}` : 'Not started yet');
      return `<li class="task" data-id="${t.id}">
        <button type="button" class="handle" aria-label="Reorder ${esc(t.title)}. Use arrow keys." data-handle>⋮⋮</button>
        <button type="button" class="check" aria-label="Mark ${esc(t.title)} done" data-check>${CHECK_SVG}</button>
        <button type="button" class="t" data-open><b>${esc(t.title)}</b><span class="meta">${meta.join(' ')}</span></button>
        <button type="button" class="go" aria-label="Start ${esc(t.title)}" data-go>▶</button>
      </li>`;
    }).join('');
  }

  async function createFromAsk() {
    const raw = askInput.value.trim();
    if (raw.length < 2) { askInput.focus(); toast('Tell me one thing you want to start.'); return; }
    const p = parseWhen(raw);
    const btn = $('#askBtn');
    let t;
    if (p.kind === 'event') {
      t = newTask(p.title, eventSteps(p.dueAt), 'quick', { kind: 'event', dueAt: p.dueAt });
    } else {
      let useAi = account.user && account.user.aiLeft > 0;
      if (useAi && !state.aiConsent) useAi = await askConsent();
      if (useAi) {
        btn.disabled = true; showThinking(p.title);
        planCard.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
        const r = await post('/api/step', { action: 'breakdown', task: p.title });
        btn.disabled = false;
        if (typeof r.data.aiLeft === 'number' && account.user) { account.user.aiLeft = r.data.aiLeft; renderAccount(); }
        if (r.ok && Array.isArray(r.data.steps)) { t = newTask(r.data.title || p.title, r.data.steps, 'ai', { tip: r.data.tip || '', firstMinutes: r.data.firstMinutes || null }); track('ai_breakdown'); }
        else {
          if (r.status === 401) { account.user = null; renderAccount(); }
          toast(r.data.error ? `${r.data.error} Here's a quick step instead.` : 'AI is resting right now. Here\'s a quick step instead.');
        }
      }
      if (!t) { t = newTask(p.title, quickSteps(p.title), 'quick', { firstMinutes: 2 }); track('quick_steps'); }
      if (p.dueAt) { t.dueAt = p.dueAt; t.dayOnly = p.dayOnly; }
    }
    state.tasks.unshift(t); state.selectedId = t.id; save();
    askInput.value = ''; growAsk();
    track('task_created'); buzz(10);
    renderNow(); renderPlan(true);
    if (p.dueAt) toast(`${t.kind === 'event' ? '📅' : '⏰'} ${formatWhen(t.dueAt, new Date(), t.dayOnly)}. It stays put until you move it.`);
    if (matchMedia('(max-width: 720px)').matches) askInput.blur();
    planCard.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  }

  // first-step actions
  $('#startBtn').addEventListener('click', () => { const t = selected(); if (t) startSession(t, START_MIN); });
  $('#smallerBtn').addEventListener('click', async () => { const t = selected(); if (!t) return; await makeSmaller(t, Math.min(curIndex(t), t.steps.length - 1)); renderPlan(true); });
  $('#anotherBtn').addEventListener('click', async () => {
    const t = selected(); if (!t) return;
    const i = Math.min(curIndex(t), t.steps.length - 1); const old = t.steps[i].text;
    const btn = $('#anotherBtn'); btn.disabled = true;
    let alt = null, minutes = 2;
    let useAi = account.user && account.user.aiLeft > 0;
    if (useAi && !state.aiConsent) useAi = await askConsent();
    if (useAi) {
      const r = await post('/api/step', { action: 'another', task: t.title, avoid: [...t.rejected, ...t.steps.map(s => s.text)].slice(-6) });
      if (typeof r.data.aiLeft === 'number' && account.user) { account.user.aiLeft = r.data.aiLeft; renderAccount(); }
      if (r.ok && r.data.step) { alt = r.data.step; minutes = r.data.minutes || 2; }
    }
    if (!alt) { const seen = new Set([...t.rejected, ...t.steps.map(s => s.text)]); alt = quickAlts(t.title).find(x => !seen.has(x)) || GENERIC[(t.rejected.length) % GENERIC.length]; }
    btn.disabled = false;
    const snap = JSON.stringify(t);
    t.rejected.push(old); t.steps[i].text = alt; if (i === 0) t.firstMinutes = minutes;
    save(); renderPlan(true); track('another_step'); buzz(8);
    toast('Here\'s a different first step.', { label: 'Undo', fn: () => { Object.assign(t, JSON.parse(snap)); save(); renderPlan(true); } });
  });
  $('#editBtn').addEventListener('click', () => {
    const t = selected(); if (!t) return;
    const ed = $('#firstEdit'); const editing = ed.hidden;
    if (editing) { ed.value = curStep(t).text; ed.hidden = false; $('#firstText').hidden = true; ed.focus(); $('#editBtn').textContent = 'Save step'; }
    else saveEdit();
  });
  function saveEdit() {
    const t = selected(); const ed = $('#firstEdit'); if (!t || ed.hidden) return;
    const v = ed.value.replace(/\s+/g, ' ').trim().slice(0, 140);
    if (v) { curStep(t).text = v; if (t.source !== 'ai') t.source = 'own'; save(); }
    ed.hidden = true; $('#firstText').hidden = false; $('#editBtn').textContent = 'Edit this step'; renderPlan(true);
  }
  $('#firstEdit').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } if (e.key === 'Escape') { $('#firstEdit').hidden = true; $('#firstText').hidden = false; $('#editBtn').textContent = 'Edit this step'; } });

  // whole plan editing (never overwritten without the user doing it)
  $('#planTitle').addEventListener('input', e => { const t = selected(); if (t) { t.title = e.target.value.slice(0, 80) || 'Untitled'; save(); } });
  $('#planSteps').addEventListener('input', e => {
    const li = e.target.closest('li'); const t = selected(); if (!li || !t) return;
    const s = t.steps.find(x => x.id === li.dataset.id); if (s) { s.text = e.target.value.replace(/\n/g, ' ').slice(0, 140); save(); fit(e.target); $('#firstText').textContent = curStep(t).text; }
  });
  $('#planSteps').addEventListener('click', e => {
    const id = e.target.dataset.del; const t = selected(); if (!id || !t) return;
    if (t.steps.length <= 1) { toast('Keep at least one step.'); return; }
    change('Step removed.', () => { t.steps = t.steps.filter(s => s.id !== id); });
    $('#wholePlan').open = true;
  });
  $('#addStep').addEventListener('click', () => {
    const t = selected(); if (!t || t.steps.length >= 12) return;
    const s = { id: uid(), text: '', done: false }; t.steps.push(s); save(); renderPlan();
    $(`#st-${s.id}`).focus();
  });
  $('#planWhen').addEventListener('change', e => {
    const t = selected(); if (!t) return;
    const v = e.target.value; if (!v) return;
    const ts = new Date(v).getTime(); if (Number.isNaN(ts)) return;
    change(`Time set: ${formatWhen(ts)}.`, () => { t.dueAt = ts; t.dayOnly = false; });
    $('#wholePlan').open = true;
  });
  $('#clearWhen').addEventListener('click', () => { const t = selected(); if (t) { change('Time removed.', () => { t.dueAt = null; t.dayOnly = false; }); $('#wholePlan').open = true; } });
  $('#dropBtn').addEventListener('click', () => { const t = selected(); if (t) change(`Dropped "${t.title}".`, () => { t.droppedAt = Date.now(); state.selectedId = null; }); });

  // missed choices: explicit, undoable
  $('#missedList').addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const t = byId(b.closest('li').dataset.id); if (!t) return;
    buzz(10);
    const act = b.dataset.m;
    if (act === 'happened') change(`Marked "${t.title}" as done.`, () => { t.finishedAt = Date.now(); });
    if (act === 'drop') change(`Dropped "${t.title}".`, () => { t.droppedAt = Date.now(); if (state.selectedId === t.id) state.selectedId = null; });
    if (act === 'untime') change('Deadline removed. It\'s back on your list.', () => { t.dueAt = null; t.dayOnly = false; });
    if (act === 'tomorrow') change('Moved to tomorrow. Only because you said so.', () => {
      const d = new Date(); d.setDate(d.getDate() + 1); const old = new Date(t.dueAt);
      d.setHours(t.dayOnly ? 23 : old.getHours(), t.dayOnly ? 59 : old.getMinutes(), 0, 0); t.dueAt = d.getTime();
    });
    if (act === 'reschedule') {
      change('Turned it into a reschedule task. The first step takes a minute.', () => {
        const w = t.title.match(/\bwith\s+(.+)$/i); const who = w ? w[1].trim() : 'them';
        t.title = `Reschedule: ${t.title}`.slice(0, 80); t.kind = 'task'; t.dueAt = null; t.source = 'quick'; t.firstMinutes = 1; t.tip = 'Short and honest works best. No long apology needed.';
        t.steps = [`Write 2 lines to ${who}: "Sorry I missed our time. Could we find another slot this week?"`, 'Send it.', 'When they reply, add the new time here.'].map(text => ({ id: uid(), text, done: false }));
        state.selectedId = t.id;
      });
      planCard.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    }
    if (act === 'now') {
      const snapDue = t.dueAt;
      t.dueAt = null; t.dayOnly = false; state.selectedId = t.id; save();
      toast('Deadline cleared. Five minutes, just the first step.', { label: 'Undo', fn: () => { t.dueAt = snapDue; save(); renderNow(); } });
      startSession(t, START_MIN);
    }
  });

  // list: open, check, start
  $('#taskList').addEventListener('click', e => {
    const li = e.target.closest('li.task'); if (!li) return;
    const t = byId(li.dataset.id); if (!t) return;
    if (e.target.closest('[data-open]')) { state.selectedId = t.id; save(); renderNow(); renderPlan(true); buzz(6); planCard.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' }); }
    if (e.target.closest('[data-go]')) { state.selectedId = t.id; startSession(t, START_MIN); }
    if (e.target.closest('[data-check]')) {
      li.classList.add('checking'); buzz([10, 40, 18]);
      const r = e.target.closest('[data-check]').getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2);
      setTimeout(() => li.classList.add('leaving'), 380);
      setTimeout(() => change(`Done: "${t.title}"`, () => { t.finishedAt = Date.now(); if (state.selectedId === t.id) state.selectedId = null; track('task_finished'); }), reduceMotion ? 0 : 650);
    }
  });

  // reorder: drag the ⋮⋮ handle (mouse or finger), or arrow keys on it
  const ul = $('#taskList'); let drag = null;
  ul.addEventListener('pointerdown', e => {
    const h = e.target.closest('[data-handle]'); if (!h) return;
    e.preventDefault();
    const li = h.closest('li'); const r = li.getBoundingClientRect();
    drag = { li, grab: e.clientY - r.top, ty: 0, moved: false, pid: e.pointerId };
    h.setPointerCapture(e.pointerId); li.classList.add('dragging'); buzz(8);
  });
  ul.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const { li } = drag;
    const natural = li.getBoundingClientRect().top - drag.ty;
    drag.ty = e.clientY - drag.grab - natural; li.style.transform = `translateY(${drag.ty}px)`;
    const next = li.nextElementSibling, prev = li.previousElementSibling;
    if (next && e.clientY > next.getBoundingClientRect().top + next.offsetHeight / 2) { ul.insertBefore(next, li); drag.moved = true; buzz(5); }
    else if (prev && e.clientY < prev.getBoundingClientRect().top + prev.offsetHeight / 2) { ul.insertBefore(li, prev); drag.moved = true; buzz(5); }
    const n2 = li.getBoundingClientRect().top - drag.ty; drag.ty = e.clientY - drag.grab - n2; li.style.transform = `translateY(${drag.ty}px)`;
  });
  const endDrag = () => {
    if (!drag) return;
    const { li, moved } = drag; drag = null;
    li.style.transform = ''; li.classList.remove('dragging');
    if (moved) applyOrder($$('li.task', ul).map(x => x.dataset.id));
  };
  ul.addEventListener('pointerup', endDrag); ul.addEventListener('pointercancel', endDrag);
  ul.addEventListener('keydown', e => {
    const h = e.target.closest('[data-handle]'); if (!h || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const ids = $$('li.task', ul).map(x => x.dataset.id); const id = h.closest('li').dataset.id; const i = ids.indexOf(id);
    const j = e.key === 'ArrowUp' ? i - 1 : i + 1; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]]; applyOrder(ids);
    $(`li.task[data-id="${id}"] [data-handle]`).focus();
  });
  function applyOrder(ids) {
    const rank = new Map(ids.map((id, i) => [id, i]));
    const inList = state.tasks.filter(t => rank.has(t.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
    let k = 0; state.tasks = state.tasks.map(t => (rank.has(t.id) ? inList[k++] : t));
    save(); renderList();
  }

  // make a step smaller (AI, with a simple fallback)
  async function makeSmaller(t, i) {
    const step = t.steps[i]; if (!step) return false;
    let pieces = null;
    let useAi = account.user && account.user.aiLeft > 0;
    if (useAi && !state.aiConsent) useAi = await askConsent();
    if (useAi) {
      toast('Making it smaller…');
      const r = await post('/api/step', { action: 'smaller', task: t.title, step: step.text });
      if (typeof r.data.aiLeft === 'number' && account.user) { account.user.aiLeft = r.data.aiLeft; renderAccount(); }
      if (r.ok && Array.isArray(r.data.steps)) pieces = r.data.steps;
    }
    if (!pieces) pieces = ['Open what you need for this step. Just open it.', `Do only the first 2 minutes of: ${step.text.replace(/\.$/, '')}`];
    const snap = JSON.stringify(t.steps);
    t.steps.splice(i, 1, ...pieces.map(text => ({ id: uid(), text, done: false })));
    if (i === 0) t.firstMinutes = 1;
    track('stuck'); save(); buzz(10);
    toast('Smaller now. Just the first bit.', { label: 'Undo', fn: () => { t.steps = JSON.parse(snap); save(); renderPlan(true); if (!F.el.hidden) paintFocus(); } });
    return true;
  }

  /* ---------- FOCUS: the five-minute start ---------- */
  const F = { el: $('#focus'), main: $('#fMain'), recover: $('#fRecover'), done: $('#fDoneP') };
  let tick = null, hiddenAt = null, lastFocusEl = null;
  const sess = () => state.session;
  const remaining = () => { const s = sess(); if (!s) return 0; return s.paused ? s.left : s.endsAt - Date.now(); };
  const activeMs = () => { const s = sess(); if (!s) return 0; return (s.activeMs || 0) + (s.paused ? 0 : Date.now() - s.runSince); };
  const activePanel = () => ['main', 'recover', 'done'].find(k => !F[k].hidden);
  function showPanel(which) {
    ['main', 'recover', 'done'].forEach(k => { F[k].hidden = k !== which; });
    const target = { main: '#fDone', recover: '#fRestart', done: '#fKeepGoing' }[which];
    setTimeout(() => { const el = $(target); (el && !el.hidden ? el : $('#fFinish')).focus({ preventScroll: true }); }, 40);
  }

  function startSession(t, minutes) {
    const now = Date.now();
    if (!t.firstStartAt) t.firstStartAt = now;
    t.lastActiveAt = now;
    state.selectedId = t.id; state.dismissedResume = null;
    state.session = { taskId: t.id, startedAt: now, endsAt: now + minutes * MIN, total: minutes * MIN, paused: false, left: 0, activeMs: 0, runSince: now };
    save(); track('session_started'); buzz(14);
    shareFocus('start', minutes);
    openFocus();
  }

  function openFocus() {
    const s = sess(); const t = s && byId(s.taskId);
    if (!t) { state.session = null; save(); return; }
    lastFocusEl = document.activeElement;
    F.el.hidden = false; document.body.classList.add('focusing');
    $('#reflectForm').hidden = true;
    paintWitness(); paintFocus(); showPanel('main');
    clearInterval(tick); tick = setInterval(onTick, 250); onTick();
  }

  function paintWitness() {
    const w = $('#fWitness'); const d = together.data;
    if (d?.buddy && d.me.shareStatus) { w.textContent = `${d.buddy.name} can see you started`; w.classList.add('on'); }
    else if (d?.buddy) { w.textContent = 'Sharing paused · solo'; w.classList.remove('on'); }
    else { w.textContent = 'Solo'; w.classList.remove('on'); }
  }

  function paintFocus() {
    const s = sess(); if (!s) return; const t = byId(s.taskId); const i = curIndex(t);
    $('#fTask').textContent = t.title;
    $('#fCount').textContent = `Step ${Math.min(i + 1, t.steps.length)} of ${t.steps.length}`;
    const stepEl = $('#fStep');
    stepEl.textContent = (t.steps[i] || t.steps[t.steps.length - 1]).text || 'Do the next small thing.';
    stepEl.classList.remove('swap'); void stepEl.offsetWidth; stepEl.classList.add('swap');
    $('#fDots').innerHTML = t.steps.map((x, k) => `<i class="${x.done ? 'done' : k === i ? 'cur' : ''}"></i>`).join('');
  }

  function onTick() {
    const s = sess(); if (!s) return;
    const left = remaining();
    const frac = Math.max(0, Math.min(1, left / s.total));
    $('#fTime').textContent = fmt(left);
    F.el.style.setProperty('--p', (1 - frac).toFixed(3));
    $('#fArc').style.strokeDashoffset = (578 * (1 - frac)).toFixed(1);
    $('#fRing').classList.toggle('paused', s.paused);
    $('#fPause').textContent = s.paused ? 'Resume' : 'Pause';
    $('#fPause').setAttribute('aria-label', s.paused ? 'Resume timer' : 'Pause timer');
    if (!s.paused && left <= 0 && activePanel() === 'main') { pause(); buzz([30, 60, 30]); showComplete('time'); }
  }

  function pause() { const s = sess(); if (s && !s.paused) { s.left = Math.max(0, s.endsAt - Date.now()); s.activeMs = (s.activeMs || 0) + (Date.now() - s.runSince); s.paused = true; save(); } }
  function resume() { const s = sess(); if (s && s.paused) { s.endsAt = Date.now() + s.left; s.runSince = Date.now(); s.paused = false; save(); } }
  function restartWith(minutes) { const s = sess(); if (!s) return; pause(); s.total = minutes * MIN; s.left = s.total; resume(); }

  // Moment E: completion. Ending early is never punished.
  function showComplete(reason) {
    const s = sess(); const t = s && byId(s.taskId); if (!t) return;
    pause();
    const m = Math.max(1, mins(activeMs()));
    const allDone = curIndex(t) >= t.steps.length;
    $('#fDoneTitle').textContent = allDone ? 'That\'s done. You followed through.' : 'You started. That counts.';
    $('#fDoneText').textContent = allDone ? `"${t.title}" is finished.` : reason === 'early' ? `You showed up for ${m} min. That's real.` : `You gave it ${m} minute${m === 1 ? '' : 's'}. Want to keep going?`;
    $('#fKeepGoing').hidden = allDone; $('#fBreak').hidden = allDone;
    $('#fFinish').textContent = allDone ? 'Back to my list' : 'Finish for now';
    $('#reflectForm').hidden = true;
    if (reason === 'early') track('session_ended_early');
    showPanel('done');
  }

  function endSession(reason) {
    const s = sess(); if (!s) return;
    const t = byId(s.taskId);
    const ms = activeMs();
    if (t) { t.focusMs = (t.focusMs || 0) + ms; t.lastActiveAt = Date.now(); }
    state.sessions.push({ start: s.startedAt, end: Date.now(), ms, taskId: s.taskId });
    if (state.sessions.length > 500) state.sessions = state.sessions.slice(-500);
    state.session = null; save();
    shareFocus('end');
    clearInterval(tick); tick = null;
    F.el.hidden = true; document.body.classList.remove('focusing');
    if (reason === 'break') toast('Take your time. Your step will be waiting.');
    if (location.hash !== '#/now') location.hash = '#/now'; else renderNow();
    lastFocusEl?.focus?.({ preventScroll: true });
  }

  function completeStep() {
    const s = sess(); const t = s && byId(s.taskId); if (!t) return;
    const i = curIndex(t); if (t.steps[i]) t.steps[i].done = true;
    track('step_done'); buzz([10, 30, 14]);
    const r = $('#fDone').getBoundingClientRect(); burst(r.left + r.width / 2, r.top);
    if (curIndex(t) >= t.steps.length) { t.finishedAt = Date.now(); save(); track('task_finished'); return showComplete('finished'); }
    save(); paintFocus();
    if (remaining() <= 0) restartWith(START_MIN); else resume();
    showPanel('main');
  }

  function distracted(auto, awayMs) {
    const s = sess(); const t = s && byId(s.taskId); if (!t) return;
    t.distractions = (t.distractions || 0) + 1; save(); track('distracted');
    pause(); buzz(10);
    const step = (t.steps[curIndex(t)] || {}).text || '';
    $('#fRecoverText').textContent = `${auto ? `You were away for ${Math.max(1, mins(awayMs))} min. ` : 'It happens to everyone. '}You were on: "${step}"`;
    showPanel('recover');
  }

  $('#fDone').addEventListener('click', completeStep);
  const togglePause = () => { const s = sess(); if (!s) return; s.paused ? resume() : pause(); buzz(6); onTick(); };
  $('#fPause').addEventListener('click', togglePause);
  $('#fDistracted').addEventListener('click', () => distracted(false));
  const stuck = async () => {
    const s = sess(); const t = s && byId(s.taskId); if (!t) return;
    pause(); $('#fStuck').disabled = true;
    await makeSmaller(t, Math.min(curIndex(t), t.steps.length - 1));
    $('#fStuck').disabled = false; paintFocus(); resume(); showPanel('main');
  };
  $('#fStuck').addEventListener('click', stuck);
  $('#fEnd').addEventListener('click', () => { if (activePanel() === 'done') endSession('finish'); else showComplete('early'); });
  $('#fRestart').addEventListener('click', () => { state.recoveries.push(Date.now()); track('recovered'); restartWith(START_MIN); buzz(12); showPanel('main'); });
  $('#fKeep').addEventListener('click', () => { state.recoveries.push(Date.now()); track('recovered'); if (remaining() <= 0) restartWith(START_MIN); else resume(); showPanel('main'); });
  $('#fRecoverStop').addEventListener('click', () => showComplete('early'));
  $('#fKeepGoing').addEventListener('click', () => { restartWith(START_MIN); shareFocus('extend', START_MIN); track('kept_going'); buzz(10); showPanel('main'); });
  $('#fBreak').addEventListener('click', () => endSession('break'));
  $('#fFinish').addEventListener('click', () => {
    const askedToday = state.reflections.some(r => dayKey(r.at) === dayKey(Date.now()));
    if (!askedToday && $('#reflectForm').hidden) { $('#reflectForm').hidden = false; $('#reflectInput').focus(); return; }
    endSession('finish');
  });
  $('#reflectForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#reflectInput').value.trim().slice(0, 200);
    if (v) { state.reflections.push({ at: Date.now(), text: v }); save(); track('reflection'); toast('Saved, just for you.'); }
    $('#reflectInput').value = ''; endSession('finish');
  });
  $('#reflectSkip').addEventListener('click', () => endSession('finish'));

  document.addEventListener('keydown', e => {
    if (!consentEl.hidden) { if (e.key === 'Escape' && consentResolve) consentResolve(false); return; }
    if (!$('#intro').hidden) { if (e.key === 'Escape') closeIntro(); return; }
    if (!F.el.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); activePanel() === 'done' ? endSession('finish') : showComplete('early'); return; }
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (activePanel() === 'main') {
        if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); completeStep(); }
        else if (e.key === ' ') { e.preventDefault(); togglePause(); }
        else if (e.key.toLowerCase() === 's') { e.preventDefault(); stuck(); }
        else if (e.key.toLowerCase() === 'd') { e.preventDefault(); distracted(false); }
      }
      return;
    }
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'n' || e.key === '/') { e.preventDefault(); if (location.hash !== '#/now') location.hash = '#/now'; setTimeout(() => askInput.focus(), 30); }
  });

  document.addEventListener('visibilitychange', () => {
    const s = sess();
    if (!document.hidden) pollTogether();
    if (!s || F.el.hidden) return;
    if (document.hidden) { if (!s.paused) hiddenAt = Date.now(); }
    else if (hiddenAt) {
      const away = Date.now() - hiddenAt; hiddenAt = null;
      if (away > 45000 && activePanel() === 'main') distracted(true, away);
    }
  });
  setInterval(() => { if (current === 'now' && F.el.hidden && !typing(document.activeElement)) { renderUpNext(); renderMissed(); renderList(); } }, 30000);

  /* ---------- Moment A: first launch (under 20 seconds) ---------- */
  let introI = 0;
  function maybeIntro() { if (!state.onboarded && !state.tasks.length) { $('#intro').hidden = false; setTimeout(() => $('#introNext').focus(), 50); } }
  function paintIntro() {
    $$('.slide').forEach((s, i) => { s.classList.toggle('on', i === introI); s.classList.toggle('out', i < introI); });
    $$('.intro-dots i').forEach((d, i) => d.classList.toggle('on', i === introI));
    $('#introNext').textContent = introI === 2 ? 'Let\'s begin' : 'Next';
  }
  function closeIntro() { $('#intro').hidden = true; state.onboarded = true; save(); track('onboarded'); setTimeout(() => askInput.focus(), 60); }
  $('#introNext').addEventListener('click', () => { if (introI >= 2) return closeIntro(); introI++; paintIntro(); buzz(6); });
  $('#introSkip').addEventListener('click', closeIntro);

  /* ---------- AI consent ---------- */
  const consentEl = $('#aiConsent'); let consentResolve = null;
  function askConsent() {
    return new Promise(resolve => {
      consentEl.hidden = false; $('#aiAgree').focus();
      consentResolve = ok => { consentEl.hidden = true; consentResolve = null; resolve(ok); };
    });
  }
  $('#aiAgree').addEventListener('click', () => { if ($('#aiRemember').checked) { state.aiConsent = true; save(); } consentResolve && consentResolve(true); });
  $('#aiCancel').addEventListener('click', () => consentResolve && consentResolve(false));

  /* ---------- COMEBACK TOGETHER ---------- */
  const together = { data: null, loading: false, timer: null, queue: [], showing: false, inviteUrl: null };

  async function shareFocus(state_, minutes) {
    if (!account.user || !together.data?.buddy || !together.data.me.shareStatus) return;
    const body = state_ === 'extend' ? { state: 'end', extend: true, minutes } : { state: state_, minutes };
    post('/api/together?action=focus', body);
  }

  async function pollTogether() {
    if (!account.user || together.loading) return;
    together.loading = true;
    const r = await api('/api/together?action=status');
    together.loading = false;
    if (!r.ok) { if (r.status === 401) { account.user = null; renderAccount(); } return; }
    together.data = r.data;
    const live = !!r.data.buddy?.focusing;
    $('#tabDot').hidden = !live; $('#tabDot2').hidden = !live;
    for (const item of r.data.inbox || []) if (!together.queue.some(q => q.id === item.id)) together.queue.push(item);
    showNextSignal();
    if (current === 'together') renderTogether();
    if (current === 'now') renderBuddyStrip();
    if (!F.el.hidden) paintWitness();
  }
  function schedulePoll() {
    clearInterval(together.timer);
    together.timer = setInterval(() => { if (!document.hidden) pollTogether(); }, 20000);
  }

  // Moment D: "Someone saw you show up today." (and gentle buddy signals)
  function showNextSignal() {
    if (together.showing || !together.queue.length || !F.el.hidden) return;
    const s = together.queue.shift(); together.showing = true;
    const box = $('#seenMoment'); const acts = $('#seenActions');
    const copy = {
      ack: ['Someone saw you show up today.', `${s.from} noticed 💜`],
      nudge: ['Still there? You\'ve got this.', `From ${s.from}`],
      together: [`${s.from} wants to start together.`, 'Five minutes, side by side.'],
      joined: [`${s.from} accepted your invite.`, 'You\'re buddies now. Turn on sharing so they can see when you start.'],
    }[s.kind] || ['A note from your buddy', s.from];
    $('#seenTitle').textContent = copy[0]; $('#seenFrom').textContent = copy[1];
    acts.innerHTML = s.kind === 'nudge' || s.kind === 'together'
      ? `<button class="btn btn-primary" data-seen="start">${s.kind === 'together' ? 'Start with them' : 'Start 5 minutes'}</button><button class="btn btn-ghost" data-seen="ok">Not now</button>`
      : s.kind === 'joined' ? '<button class="btn btn-primary" data-seen="tog">Open Better Together</button><button class="btn btn-ghost" data-seen="ok">Later</button>'
      : '<button class="btn btn-primary" data-seen="ok">Thank you</button>';
    box.hidden = false; buzz([10, 50, 10]);
    post('/api/together?action=seen', { ids: [s.id] });
    $('[data-seen]', acts).focus();
  }
  $('#seenActions').addEventListener('click', e => {
    const b = e.target.closest('[data-seen]'); if (!b) return;
    $('#seenMoment').hidden = true; together.showing = false;
    if (b.dataset.seen === 'start') quickStart();
    if (b.dataset.seen === 'tog') location.hash = '#/together';
    setTimeout(showNextSignal, 400);
  });
  function quickStart() {
    const t = selected() || openTasks().find(x => !isMissed(x) && x.kind !== 'event');
    if (t) { state.selectedId = t.id; startSession(t, START_MIN); }
    else { location.hash = '#/now'; toast('Pick one small thing, and we\'ll start together.'); setTimeout(() => askInput.focus(), 80); }
  }

  function renderTogether() {
    const u = account.user;
    $('#togLogin').hidden = !!u || !account.loaded;
    $('#togLoading').hidden = !u || !!together.data;
    $('#togMain').hidden = !u || !together.data;
    if (!u) { $('#togLoading').hidden = !!account.loaded; return; }
    if (!together.data) { pollTogether(); return; }
    const { me, buddy, invite } = together.data;
    $('#nameCard').hidden = !!me.name;
    $('#buddyCard').hidden = !buddy;
    $('#inviteCard').hidden = !!buddy;
    $('#prefsCard').hidden = !buddy;
    $$('.bn').forEach(x => { x.textContent = buddy ? buddy.name : 'my buddy'; });
    if (buddy) {
      $('#buddyAv').textContent = buddy.name.charAt(0).toUpperCase();
      $('#buddyName').textContent = buddy.name;
      $('#buddyStatus').innerHTML = !buddy.sharing ? `${esc(buddy.name)} isn't sharing right now. That's okay.`
        : buddy.focusing ? `<i class="live"></i>${esc(buddy.name)} is taking a small step right now.`
        : buddy.showedUpToday ? `${esc(buddy.name)} showed up today.` : `${esc(buddy.name)} hasn't started today. No pressure.`;
      $('#ackBtn').hidden = !(buddy.sharing && buddy.showedUpToday && !buddy.acked);
      const wait = buddy.nudgeAvailableAt ? new Date(buddy.nudgeAvailableAt).getTime() : 0;
      $('#nudgeBtn').disabled = !buddy.acceptsNudges || wait > Date.now();
      $('#nudgeNote').textContent = !buddy.acceptsNudges ? `${buddy.name} has encouragement turned off right now.` : wait > Date.now() ? `You can send another encouragement at ${clock(wait)}.` : `Sends "Still there? You've got this." Max once every 30 minutes.`;
      $('#shareToggle').checked = me.shareStatus; $('#nudgeToggle').checked = me.allowNudges;
      $('#disconnectBtn').hidden = false;
      $('#soloBtn').hidden = !me.shareStatus && !me.allowNudges;
    } else {
      $('#inviteIdle').hidden = !!together.inviteUrl || !!invite;
      $('#inviteReady').hidden = !together.inviteUrl;
      $('#invitePending').hidden = !invite || !!together.inviteUrl;
      if (together.inviteUrl) $('#inviteUrl').value = together.inviteUrl;
    }
  }
  $('#nameForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#nameInput').value.trim();
    const r = await post('/api/together?action=prefs', { name });
    if (!r.ok) { toast(r.data.error || 'Could not save your name.'); return; }
    if (account.user) account.user.name = name;
    toast(`Nice to meet you, ${name}.`); await pollTogether(); renderTogether();
  });
  async function createInvite() {
    const r = await post('/api/together?action=invite');
    if (!r.ok) { if (r.data.needName) { $('#nameCard').hidden = false; $('#nameInput').focus(); } toast(r.data.error || 'Could not create a link.'); return; }
    together.inviteUrl = r.data.url; track('buddy_invite'); buzz(10);
    await pollTogether(); renderTogether(); $('#inviteUrl').select();
  }
  $('#inviteBtn').addEventListener('click', createInvite);
  $('#newLinkBtn').addEventListener('click', createInvite);
  const revoke = async () => { await post('/api/together?action=revoke'); together.inviteUrl = null; await pollTogether(); renderTogether(); toast('Invite canceled. The old link no longer works.'); };
  $('#revokeBtn').addEventListener('click', revoke); $('#revokeBtn2').addEventListener('click', revoke);
  $('#copyBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#inviteUrl').value); toast('Link copied. Send it to someone you trust.'); }
    catch { $('#inviteUrl').select(); toast('Select the link and copy it.'); }
  });
  $('#shareBtn').addEventListener('click', async () => {
    const url = $('#inviteUrl').value;
    const text = 'Want to be my Comeback buddy? You\'d just see when I start something, never what. Starting is easier together.';
    if (navigator.share) { try { await navigator.share({ title: 'Comeback Together', text, url }); } catch { /* canceled */ } }
    else { try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Message and link copied.'); } catch { toast('Copy the link above.'); } }
  });
  const setPref = async (body, msg) => {
    const r = await post('/api/together?action=prefs', body);
    if (!r.ok) { toast(r.data.error || 'Could not save.'); await pollTogether(); return; }
    await pollTogether(); toast(msg);
  };
  $('#shareToggle').addEventListener('change', e => setPref({ shareStatus: e.target.checked }, e.target.checked ? `${together.data.buddy.name} can now see when you start. Never what.` : 'Sharing paused. They see nothing until you turn it back on.'));
  $('#nudgeToggle').addEventListener('change', e => setPref({ allowNudges: e.target.checked }, e.target.checked ? 'Encouragement on.' : 'Encouragement off. No messages will come through.'));
  $('#soloBtn').addEventListener('click', () => setPref({ shareStatus: false, allowNudges: false }, 'Solo mode. Nothing is shared and no messages come through until you change it.'));
  $('#disconnectBtn').addEventListener('click', async () => {
    const name = together.data?.buddy?.name || 'your buddy';
    if (!confirm(`Disconnect from ${name}? You can always invite someone again.`)) return;
    await post('/api/together?action=disconnect'); together.inviteUrl = null; await pollTogether(); renderTogether(); toast(`Disconnected. Nothing more is shared with ${name}.`);
  });
  $('#nudgeBtn').addEventListener('click', async () => {
    const r = await post('/api/together?action=nudge');
    if (r.ok) { toast(`Sent to ${together.data.buddy.name}: "Still there? You've got this."`); track('nudge_sent'); buzz(10); } else toast(r.data.error || 'Could not send.');
    await pollTogether();
  });
  $('#ackBtn').addEventListener('click', async () => {
    const r = await post('/api/together?action=ack');
    if (r.ok) { toast(`${together.data.buddy.name} will see that you noticed 💜`); track('ack_sent'); buzz([10, 40, 10]); } else toast(r.data.error || 'Could not send.');
    await pollTogether();
  });
  $('#togetherBtn').addEventListener('click', async () => {
    const r = await post('/api/together?action=together');
    if (r.ok) { track('together_started'); toast(`We let ${together.data.buddy.name} know you're starting.`); }
    else if (r.status !== 429) { toast(r.data.error || 'Could not reach your buddy. Starting solo.'); }
    quickStart();
  });

  // join flow (invite link)
  async function renderJoin() {
    const token = joinToken;
    $('#joinBody').hidden = true; $('#joinTitle').textContent = 'Checking your invite…'; $('#joinSub').textContent = '';
    if (!token) return;
    const r = await api(`/api/together?action=preview&token=${encodeURIComponent(token)}`);
    if (!r.ok || !r.data.valid) {
      $('#joinAv').textContent = '·';
      $('#joinTitle').textContent = r.data?.status === 'accepted' ? 'This invite was already accepted.' : 'This invite isn\'t valid anymore.';
      $('#joinSub').textContent = 'Ask for a new link. Invites work once and expire after 7 days.';
      return;
    }
    const name = r.data.inviterName;
    $('#joinAv').textContent = name.charAt(0).toUpperCase();
    $('#joinTitle').textContent = `${name} invited you to be their Comeback buddy`;
    $('#joinSub').textContent = 'Starting is easier together. You\'re not a supervisor, just someone who sees that they showed up.';
    $$('.jn').forEach(x => { x.textContent = name; });
    $('#joinBody').hidden = false;
    const u = account.user;
    $('#joinNeedLogin').hidden = !!u; $('#joinForm').hidden = !u;
    if (u) { $('#joinName').value = u.name || ''; $('#joinShare').checked = false; }
    try { sessionStorage.setItem('comeback:join', token); } catch { /* ignore */ }
  }
  $('#joinLogin').addEventListener('click', () => { account.next = 'join'; setMode('signup'); });
  $('#joinForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('#joinName').value.trim();
    if (!name) { $('#joinMsg').textContent = 'Add a first name or nickname so they know it\'s you.'; $('#joinName').focus(); return; }
    $('#joinAccept').disabled = true;
    const r = await post('/api/together?action=accept', { token: joinToken, name, shareStatus: $('#joinShare').checked });
    $('#joinAccept').disabled = false;
    if (!r.ok) { $('#joinMsg').textContent = r.data.error || 'Could not accept.'; return; }
    try { sessionStorage.removeItem('comeback:join'); } catch { /* ignore */ }
    if (account.user) account.user.name = name;
    track('buddy_joined'); buzz([10, 50, 10]);
    together.data = null; location.hash = '#/together'; await pollTogether();
    together.queue.unshift({ id: 'local', kind: 'local-joined', from: '' });
    $('#seenTitle').textContent = 'You\'re buddies now.'; $('#seenFrom').textContent = 'Starting is easier together.';
    $('#seenActions').innerHTML = '<button class="btn btn-primary" data-seen="ok">Lovely</button>'; together.queue.shift();
    together.showing = true; $('#seenMoment').hidden = false;
  });
  $('#joinDecline').addEventListener('click', async () => {
    if (!joinToken) return;
    await post('/api/together?action=decline', { token: joinToken });
    try { sessionStorage.removeItem('comeback:join'); } catch { /* ignore */ }
    $('#joinBody').hidden = true; $('#joinTitle').textContent = 'Invite declined.'; $('#joinSub').textContent = 'Nothing was shared. You can still use Comeback on your own.';
  });

  /* ---------- PROGRESS: evidence of effort ---------- */
  function startsList() {
    const starts = state.sessions.map(s => s.start);
    state.tasks.forEach(t => { if (t.firstStartAt && !state.sessions.some(s => s.taskId === t.id)) starts.push(t.firstStartAt); });
    return starts.sort((a, b) => a - b);
  }
  function renderProgress() {
    const now = Date.now(); const starts = startsList();
    const week = starts.filter(x => x > now - 7 * DAY).length;
    const month = starts.filter(x => x > now - 30 * DAY).length;
    const focusMin = mins(state.sessions.filter(s => s.start > now - 30 * DAY).reduce((n, s) => n + (s.ms || 0), 0));
    const comebacks = state.recoveries.filter(x => x > now - 30 * DAY).length;
    let returned = false;
    for (let i = 1; i < starts.length; i++) if (starts[i] > now - 14 * DAY && starts[i] - starts[i - 1] >= 2 * DAY) returned = true;
    const lines = [];
    const word = n => ['zero', 'once', 'twice', 'three times', 'four times', 'five times', 'six times', 'seven times'][n] || `${n} times`;
    if (week) lines.push(`<p class="prog-line">You started something <span>${word(week)}</span> this week.</p>`);
    if (month > week) lines.push(`<p class="prog-line"><span>${month}</span> small beginnings this month.</p>`);
    if (focusMin) lines.push(`<p class="prog-line"><span>${focusMin} minutes</span> of focus you chose to give.</p>`);
    if (comebacks) lines.push(`<p class="prog-line">You came back <span>${word(comebacks)}</span> after getting distracted.</p>`);
    if (returned) lines.push('<p class="prog-line soft">You returned after a few days away. That\'s the whole idea.</p>');
    $('#progLines').innerHTML = lines.length ? lines.join('') : '<p class="prog-line soft">Your first beginning will show up here.</p><p class="prog-empty">Start anything for five minutes, and it counts.</p>';
    // constellation: last 28 days
    const counts = {}; starts.forEach(x => { const k = dayKey(x); counts[k] = (counts[k] || 0) + 1; });
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let cells = '';
    for (let i = 27; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i); const n = counts[dayKey(d)] || 0;
      cells += `<i class="${n ? 'lit' : ''}${i === 0 ? ' today' : ''}" style="--n:${Math.min(n, 4)}" title="${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}: ${n} start${n === 1 ? '' : 's'}"></i>`;
    }
    $('#constellation').innerHTML = cells;
    // proud + reflections
    const finished = state.tasks.filter(t => t.finishedAt && t.finishedAt > now - 30 * DAY).sort((a, b) => (b.proud ? 1 : 0) - (a.proud ? 1 : 0) || b.finishedAt - a.finishedAt).slice(0, 12);
    $('#proudCard').hidden = !finished.length;
    $('#proudList').innerHTML = finished.map(t => `<li><span>${esc(t.title)}</span><button class="pill-btn" data-proud="${t.id}" aria-pressed="${!!t.proud}">${t.proud ? '★ Proud' : '☆ Mark proud'}</button></li>`).join('');
    const refl = state.reflections.slice(-8).reverse();
    $('#reflCard').hidden = !refl.length;
    $('#reflList').innerHTML = refl.map(r => `<li><q>${esc(r.text)}</q><small>${new Date(r.at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</small></li>`).join('');
  }
  $('#proudList').addEventListener('click', e => { const b = e.target.closest('[data-proud]'); if (!b) return; const t = byId(b.dataset.proud); if (t) { t.proud = !t.proud; save(); renderProgress(); buzz(8); } });
  $('#remindForm').addEventListener('submit', e => {
    e.preventDefault();
    const [hh, mm] = ($('#remindTime').value || '19:00').split(':');
    const d = new Date(); const pad = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(hh)}${pad(mm)}00`;
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Comeback//Daily start//EN', 'BEGIN:VEVENT', `UID:${uid()}@comeback`, `DTSTAMP:${now}`, `DTSTART:${stamp}`, 'DURATION:PT5M', 'RRULE:FREQ=DAILY',
      'SUMMARY:One small start (Comeback)', `DESCRIPTION:What's one thing you want to start? ${location.origin}/#/now`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:One small start', 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = 'comeback-daily-start.ics'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    track('calendar_reminder'); toast('Open the file to add it to your calendar. You can delete it there anytime.');
  });

  /* ---------- ACCOUNT (Neon) + PAYMENTS (Stripe) ---------- */
  const account = { user: null, loaded: false, mode: 'signup', next: null };
  const setMode = mode => {
    account.mode = mode;
    $$('.seg [data-mode]').forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $('#authTitle').textContent = mode === 'signup' ? 'Create your free account' : 'Welcome back';
    $('#authBtn').textContent = mode === 'signup' ? 'Create free account' : 'Log in';
    $('#authPw').setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'current-password');
    $('#authPw').placeholder = mode === 'signup' ? 'At least 8 characters' : 'Your password';
    $('#authMsg').textContent = '';
  };
  $$('.seg [data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  function renderAccount() {
    const u = account.user;
    $('#authBox').hidden = !!u; $('#acctBox').hidden = !u; $('#deleteBox').hidden = !u || u.email === 'demo@demo.com';
    $$('[data-acct-label]').forEach(a => { a.textContent = u ? 'Account' : 'Log in'; });
    if (u) {
      const paid = u.plan === 'personal';
      $('#acctEmail').textContent = u.name || u.email;
      $('#acctPlan').textContent = paid ? 'Founding member ✓' : 'Free';
      $('#acctAi').textContent = `${u.aiLeft} of ${u.aiLimit} left`;
      $('#acctUpgrade').hidden = paid; $('#acctPaid').hidden = !paid;
    }
    if (current === 'now') renderAskNote();
    if (current === 'account') renderLedger();
    if (current === 'together') renderTogether();
  }
  const goLogin = (msg, next) => {
    account.next = next || null;
    location.hash = '#/account';
    if (msg) { $('#authMsg').textContent = msg; $('#authMsg').className = 'form-msg info'; }
    setTimeout(() => $('#authEmail').focus(), 60);
  };
  $('#authForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#authEmail').value.trim(), password = $('#authPw').value, msg = $('#authMsg'), btn = $('#authBtn');
    msg.className = 'form-msg';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg.textContent = 'Enter a valid email address.'; $('#authEmail').focus(); return; }
    if (account.mode === 'signup' && password.length < 8) { msg.textContent = 'Use at least 8 characters for your password.'; $('#authPw').focus(); return; }
    if (!password) { msg.textContent = 'Enter your password.'; $('#authPw').focus(); return; }
    btn.disabled = true; const label = btn.textContent; btn.textContent = account.mode === 'signup' ? 'Creating…' : 'Logging in…';
    try {
      const r = await post(`/api/auth?action=${account.mode}`, { email, password });
      if (!r.ok) { msg.textContent = r.data.error || 'Something went wrong.'; return; }
      account.user = r.data.user; $('#authPw').value = ''; renderAccount();
      track(account.mode === 'signup' ? 'signup' : 'login');
      toast(account.mode === 'signup' ? 'Account created. AI first steps are on.' : `Welcome back${account.user.name ? ', ' + account.user.name : ''}.`);
      together.data = null; pollTogether(); schedulePoll();
      let pendingJoin = null; try { pendingJoin = sessionStorage.getItem('comeback:join'); } catch { /* ignore */ }
      const next = account.next; account.next = null;
      if (pendingJoin) location.hash = `#/join/${pendingJoin}`;
      else if (next === 'buy') startCheckout();
      else location.hash = '#/now';
    } finally { btn.disabled = false; btn.textContent = label; }
  });
  $('#logoutBtn').addEventListener('click', async () => {
    await post('/api/auth?action=logout');
    account.user = null; together.data = null; together.queue = []; clearInterval(together.timer);
    $('#tabDot').hidden = $('#tabDot2').hidden = true;
    setMode('login'); renderAccount(); toast('Logged out. Your tasks are still on this device.');
  });
  async function startCheckout() {
    if (!account.user) { setMode('signup'); goLogin('Create a free account (or log in), then you\'ll go straight to checkout.', 'buy'); return; }
    if (account.user.plan === 'personal') { toast('You\'re already a founding member ✓'); location.hash = '#/account'; return; }
    toast('Opening secure Stripe checkout…'); track('checkout_started');
    const r = await post('/api/checkout?action=create');
    if (r.ok && r.data.url) { location.href = r.data.url; return; }
    if (r.ok && r.data.already) { await loadMe(); return; }
    toast(r.data.error || 'Couldn\'t open checkout. Try again.');
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-buy]'); if (b) { e.preventDefault(); startCheckout(); } });
  async function loadMe() {
    const r = await api('/api/auth?action=me');
    account.user = r.ok ? r.data.user : null; account.loaded = true; renderAccount();
    if (account.user) { pollTogether(); schedulePoll(); }
  }
  async function handleCheckoutReturn() {
    const params = new URLSearchParams(location.search);
    const result = params.get('checkout'); if (!result) return;
    const sessionId = params.get('session_id');
    history.replaceState(null, '', location.pathname + location.hash);
    if (result === 'cancel') { toast('Checkout canceled. You weren\'t charged.'); return; }
    if (result === 'success' && sessionId) {
      const r = await post('/api/checkout?action=verify', { sessionId });
      if (r.ok && r.data.user) { account.user = r.data.user; renderAccount(); track('paid'); toast('Payment received. Welcome, founding member!'); }
      else toast(r.data.error || 'We couldn\'t confirm the payment yet. Refresh in a moment.');
    }
  }

  /* ---------- your data ---------- */
  function renderLedger() {
    const bytes = new Blob([localStorage.getItem(KEY) || '']).size;
    const u = account.user;
    $('#ledger').innerHTML = [
      ['On this device', `${state.tasks.length} task${state.tasks.length === 1 ? '' : 's'}, steps, ${state.sessions.length} session${state.sessions.length === 1 ? '' : 's'} and ${state.reflections.length} reflection${state.reflections.length === 1 ? '' : 's'} (${bytes.toLocaleString()} bytes in your browser)`],
      ['On our servers', u ? `Email (${esc(u.email)}), a hashed password, plan, today's AI count, your first name and sharing choices, your buddy link, and "focusing now" only while you share with a buddy. Anonymous usage counts. Never your task text.` : 'Nothing tied to you. Anonymous counts like "session started" with a random id, never your task text.'],
      ['Shared with your buddy', 'Only "started" and "focusing now" when sharing is on, plus encouragement you send. Never tasks, steps, notes or reflections.'],
      ['Sent to Anthropic (Claude)', 'Only the task or step text you send when you ask for AI help. We don\'t store it.'],
    ].map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
  }
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'Comeback', exported: new Date().toISOString(), tasks: state.tasks, sessions: state.sessions, reflections: state.reflections, recoveries: state.recoveries }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `comeback-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  let wipeArmed = false;
  $('#wipeBtn').addEventListener('click', () => {
    if (!wipeArmed) { wipeArmed = true; $('#wipeBtn').textContent = 'Tap again to erase everything'; setTimeout(() => { wipeArmed = false; $('#wipeBtn').textContent = 'Erase data on this device'; }, 4000); return; }
    const anonId = state.anonId; state = fresh(); state.anonId = anonId; state.migrated = true; state.onboarded = true; save();
    wipeArmed = false; $('#wipeBtn').textContent = 'Erase data on this device'; renderLedger(); toast('Erased from this device.');
  });
  $('#deleteForm').addEventListener('submit', async e => {
    e.preventDefault();
    const r = await post('/api/auth?action=delete', { password: $('#deletePw').value });
    if (!r.ok) { $('#deleteMsg').textContent = r.data.error || 'Could not delete the account.'; return; }
    $('#deletePw').value = ''; $('#deleteBox').open = false;
    account.user = null; together.data = null; clearInterval(together.timer); renderAccount(); toast('Your account and buddy connection were deleted.');
  });

  /* ---------- offline support ---------- */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  /* ---------- init ---------- */
  setMode('signup');
  route();
  track('visit');
  loadMe().then(() => { handleCheckoutReturn(); if (current === 'now') renderNow(); if (current === 'together') renderTogether(); if (current === 'join') renderJoin(); });
  if (state.session && byId(state.session.taskId)) {
    if (location.hash !== '#/now') location.hash = '#/now';
    if (!state.session.runSince) state.session.runSince = state.session.startedAt;
    openFocus();
    if (!state.session.paused) { const away = Date.now() - state.session.runSince; pause(); distracted(true, away); }
  }
})();
