/* Comeback: start what you're avoiding, come back when you drift.
   Tasks and sessions live in this browser (localStorage). AI calls go through /api/step (server holds the key).
   Rule: nothing moves without the user's tap, and every change can be undone. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const MIN = 60000, DAY = 86400000;
  const { parseWhen, formatWhen } = window.ComebackWhen;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const buzz = (ms = 12) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { /* unsupported */ } };
  const typing = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

  /* ---------- state ---------- */
  const KEY = 'comeback:v1';
  const fresh = () => ({ v: 2, tasks: [], selectedId: null, session: null, anonId: uid(), aiConsent: false, recoveries: [], dismissedResume: null });
  let state;
  try { state = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { state = fresh(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ } };

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

  // snapshot-based undo for every change to the list
  function change(label, fn) {
    const snap = JSON.stringify({ tasks: state.tasks, selectedId: state.selectedId });
    fn(); save(); renderNow();
    toast(label, { label: 'Undo', fn: () => { const o = JSON.parse(snap); state.tasks = o.tasks; state.selectedId = o.selectedId; save(); renderNow(); buzz(8); toast('Undone.'); } });
  }

  /* ---------- small helpers ---------- */
  const track = name => {
    try { fetch('/api/event', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, anonId: state.anonId }) }).catch(() => {}); } catch { /* never break the app */ }
  };
  const api = async (url, opts = {}) => {
    const res = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts });
    let data = {}; try { data = await res.json(); } catch { data = { error: res.status === 404 ? 'The server isn\'t running here. Use the live site.' : 'Unexpected server response.' }; }
    return { ok: res.ok, status: res.status, data };
  };
  const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const mins = ms => Math.max(0, Math.round(ms / MIN));
  const clock = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const toLocalInput = ts => { const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  function burst(x, y) {
    if (reduceMotion) return;
    const b = $('#burst');
    for (let i = 0; i < 14; i++) {
      const p = document.createElement('i'); const a = (Math.PI * 2 * i) / 14; const d = 40 + Math.random() * 40;
      p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.setProperty('--dx', Math.cos(a) * d + 'px'); p.style.setProperty('--dy', Math.sin(a) * d + 'px');
      p.style.background = ['#1fb6c1', '#5b5fb8', '#8e78da', '#7fe3ef'][i % 4];
      b.appendChild(p); setTimeout(() => p.remove(), 700);
    }
  }

  /* ---------- quick steps (no AI, nothing sent) ---------- */
  const RULES = [
    [/essay|paper|report|write|draft|thesis|blog/i, 'Open a blank doc and write just the title and 3 bullet ideas.'],
    [/stud|exam|quiz|test|midterm|final|review/i, "Open your notes and pick the ONE topic you're least sure about."],
    [/apply|application|internship|job|resume|cv|cover letter/i, 'Open the posting and copy its 3 key requirements into a note.'],
    [/email|reply|message|text|dm|respond/i, 'Write only the first sentence. Sending can wait.'],
    [/clean|laundry|room|dishes|tidy|organi/i, 'Set a timer and clear just one surface.'],
    [/gym|workout|run|exercise|walk|lift/i, 'Put on your workout clothes. That counts as starting.'],
    [/read|chapter|book|article/i, 'Read just the first page.'],
    [/call|appointment|book|schedule|doctor|dentist/i, 'Find the phone number or booking link and copy it somewhere.'],
    [/pay|bill|rent|invoice|tuition|loan/i, 'Open the payment page and check the due date and amount.'],
    [/code|project|build|lab|assignment|homework|hw/i, "Open the project and write down the very next file or question you'll touch."],
    [/present|slides|deck|pitch/i, 'Write the title of every slide, nothing else.'],
  ];
  function quickFirst(title) { return (RULES.find(([re]) => re.test(title)) || [0, 'Open whatever you need for this and look at it for 2 minutes.'])[1]; }
  const quickSteps = title => [quickFirst(title), 'Keep going for 10 minutes. Messy is fine.', 'Write one line about where you stopped, so next time is easy.'];
  const eventSteps = dueAt => ['Open or gather what you need for it.', `Be there at ${clock(dueAt)}.`];

  function newTask(title, steps, source, extra = {}) {
    const clean = String(title).trim().slice(0, 80);
    return { id: uid(), title: clean.charAt(0).toUpperCase() + clean.slice(1), steps: steps.map(text => ({ id: uid(), text, done: false })), source, kind: 'task', dueAt: null, dayOnly: false,
      createdAt: Date.now(), firstStartAt: null, finishedAt: null, droppedAt: null, focusMs: 0, distractions: 0, ...extra };
  }
  const byId = id => state.tasks.find(t => t.id === id);
  const curIndex = t => { const i = t.steps.findIndex(s => !s.done); return i === -1 ? t.steps.length : i; };
  const isOpen = t => !t.finishedAt && !t.droppedAt;
  const isMissed = (t, now = Date.now()) => isOpen(t) && t.dueAt && now > t.dueAt + (t.kind === 'event' ? 15 * MIN : 0);
  const openTasks = () => state.tasks.filter(isOpen);

  // One-time import of unfinished tasks from ClinicGuard Personal (same browser)
  if (!state.migrated) {
    try {
      const old = JSON.parse(localStorage.getItem('clinicguard-personal:v1') || 'null');
      (old?.tasks || []).filter(t => !t.done && t.title).slice(0, 20).forEach(t => state.tasks.push(newTask(t.title, [t.step || quickFirst(t.title), 'Keep going for 10 minutes. Messy is fine.'], 'quick')));
    } catch { /* ignore */ }
    state.migrated = true; save();
  }
  state.tasks.forEach(t => { t.kind = t.kind || 'task'; if (t.dueAt === undefined) t.dueAt = null; });

  /* ---------- router ---------- */
  const VIEWS = ['home', 'now', 'account'];
  const TITLES = { home: "Comeback · Start what you're avoiding", now: 'Now · Comeback', account: 'Account · Comeback' };
  let current = null;
  const route = () => {
    const h = location.hash; const isRoute = h.startsWith('#/');
    let name = isRoute ? h.slice(2) : 'home'; if (!VIEWS.includes(name)) name = 'home';
    if (name !== current) {
      current = name;
      $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
      document.body.classList.toggle('in-app', name !== 'home');
      $('.nav-account').setAttribute('aria-current', name === 'account' ? 'page' : 'false');
      document.title = TITLES[name];
      if (name === 'now') renderNow();
      if (name === 'account') renderLedger();
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
  $$('[data-fill]').forEach(b => b.addEventListener('click', () => { $('#heroTask').value = b.dataset.fill; $('#heroTask').focus(); }));

  /* ---------- NOW screen ---------- */
  const planCard = $('#planCard');
  const selected = () => { const t = byId(state.selectedId); return t && isOpen(t) && !isMissed(t) ? t : null; };

  function renderNow() {
    const open = openTasks();
    $('#nowDate').textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    $('#nowTitle').textContent = open.length ? 'Now' : 'What are you avoiding?';
    $('#firstRun').hidden = open.length > 0;
    document.body.classList.toggle('has-tasks', open.length > 0);
    renderAskNote(); renderUpNext(); renderMissed(); renderPlan(); renderList(); renderResume(); renderStats();
  }

  function renderAskNote() {
    const u = account.user; const n = $('#askNote');
    if (!account.loaded) { n.textContent = ''; return; }
    const tip = '<span class="tip">Tip: add a time like "at 3pm" or "by Fri".</span> ';
    if (!u) n.innerHTML = tip + 'Quick steps work right away. <a href="#/account">Create a free account</a> for ✨ AI steps written for your exact task (5 a day).';
    else if (u.aiLeft > 0) n.innerHTML = tip + `✨ AI steps on · ${u.aiLeft} left today${u.plan === 'personal' ? '' : ' · <a href="#/account">Upgrade</a>'}`;
    else n.innerHTML = tip + `Today's AI steps are used up, so you'll get quick steps.${u.plan === 'personal' ? '' : ' <a href="#/account">Founding members</a> get 100 a day.'}`;
  }

  function renderUpNext() {
    const now = Date.now();
    const next = openTasks().filter(t => t.kind === 'event' && t.dueAt && t.dueAt >= now - 15 * MIN && t.dueAt <= now + 3 * 3600000).sort((a, b) => a.dueAt - b.dueAt)[0];
    const el = $('#upNext'); el.hidden = !next; if (!next) return;
    const m = Math.round((next.dueAt - now) / MIN);
    el.dataset.id = next.id;
    el.innerHTML = `<span class="un-ico" aria-hidden="true">⏰</span><span><b>${esc(next.title)}</b><small>${m > 0 ? `in ${m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'}` : 'now'} · ${clock(next.dueAt)}</small></span><span class="un-go" aria-hidden="true">›</span>`;
  }

  function renderMissed() {
    const list = openTasks().filter(t => isMissed(t)).sort((a, b) => a.dueAt - b.dueAt);
    $('#missedCard').hidden = !list.length;
    $('#missedCount').textContent = list.length;
    $('#missedList').innerHTML = list.map(t => {
      const when = formatWhen(t.dueAt, new Date(), t.dayOnly);
      const choices = t.kind === 'event'
        ? `<button class="btn btn-ghost" data-m="happened">✓ It happened</button><button class="btn btn-dark" data-m="reschedule">Reschedule with them</button><button class="btn btn-ghost" data-m="drop">Drop it</button>`
        : `<button class="btn btn-dark" data-m="now">Do 5 min now</button><button class="btn btn-ghost" data-m="tomorrow">Tomorrow</button><button class="btn btn-ghost" data-m="untime">No deadline</button><button class="btn btn-ghost" data-m="drop">Drop it</button>`;
      return `<li data-id="${t.id}"><div class="mi-t"><b>${esc(t.title)}</b><span>${t.kind === 'event' ? 'Missed' : 'Was due'} · ${esc(when)}</span></div><div class="choices">${choices}</div></li>`;
    }).join('');
  }

  function renderPlan() {
    const t = selected();
    if (!t) { planCard.hidden = true; return; }
    planCard.hidden = false;
    if (document.activeElement !== $('#planTitle')) $('#planTitle').value = t.title;
    const badge = $('#planBadge');
    badge.textContent = t.kind === 'event' ? '📅 Event' : t.source === 'ai' ? '✨ AI steps' : 'Quick steps';
    badge.className = 'badge' + (t.kind === 'event' ? ' event' : t.source === 'ai' ? '' : ' quick');
    $('#planWhen').value = t.dueAt ? toLocalInput(t.dueAt) : '';
    $('#clearWhen').hidden = !t.dueAt;
    $('#planTip').textContent = t.tip || '';
    const ci = curIndex(t);
    $('#planSteps').innerHTML = t.steps.map((s, i) => `<li class="${s.done ? 'done' : ''}${i === ci ? ' cur' : ''}" data-id="${s.id}"><label class="sr-only" for="st-${s.id}">Step ${i + 1}</label><textarea id="st-${s.id}" rows="1" maxlength="140">${esc(s.text)}</textarea><button type="button" class="step-x" data-del="${s.id}" aria-label="Remove step ${i + 1}">×</button></li>`).join('');
    $$('#planSteps textarea').forEach(fit);
    $('#startBtn').textContent = ci === 0 ? 'Start step 1 →' : ci < t.steps.length ? `Continue step ${ci + 1} →` : 'Finish →';
    $('#smallerBtn').textContent = `Make step ${Math.min(ci, t.steps.length - 1) + 1} smaller`;
  }
  function fit(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  addEventListener('resize', () => $$('#planSteps textarea').forEach(fit));

  const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>';
  function renderList() {
    const list = openTasks().filter(t => !isMissed(t));
    $('#listCard').hidden = !list.length;
    $('#listHint').hidden = list.length < 2;
    $('#taskList').innerHTML = list.map(t => {
      const ci = curIndex(t);
      const meta = [];
      if (t.dueAt) meta.push(`<span class="tchip${t.kind === 'event' ? ' ev' : ''}">${t.kind === 'event' ? '📅' : '⏰'} ${esc(formatWhen(t.dueAt, new Date(), t.dayOnly))}</span>`);
      meta.push(t.kind === 'event' ? '' : t.firstStartAt ? `Step ${Math.min(ci + 1, t.steps.length)} of ${t.steps.length}` : `${t.steps.length} small steps`);
      return `<li class="task${t.id === state.selectedId ? ' sel' : ''}" data-id="${t.id}">
        <button type="button" class="handle" aria-label="Reorder ${esc(t.title)}. Use arrow keys." data-handle>⋮⋮</button>
        <button type="button" class="check" aria-label="Mark ${esc(t.title)} done" data-check>${CHECK_SVG}</button>
        <button type="button" class="t" data-open><b>${esc(t.title)}</b><span class="meta">${meta.join(' ')}</span></button>
        <button type="button" class="go" aria-label="Start ${esc(t.title)}" data-go>▶</button>
      </li>`;
    }).join('');
  }

  function renderResume() {
    const t = openTasks().filter(x => x.firstStartAt && x.id !== state.selectedId && !isMissed(x)).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))[0];
    const show = t && state.dismissedResume !== t.id && !state.session;
    $('#resume').hidden = !show;
    if (!show) return;
    const s = t.steps[Math.min(curIndex(t), t.steps.length - 1)];
    $('#resumeTitle').textContent = t.title;
    $('#resumeStep').textContent = `You were on: ${s ? s.text : 'the last step'}`;
    $('#resumeBtn').dataset.id = t.id;
  }

  function renderStats() {
    const since = Date.now() - 7 * DAY;
    const started = state.tasks.filter(t => t.firstStartAt && t.firstStartAt > since);
    const finished = state.tasks.filter(t => t.finishedAt && t.finishedAt > since).length;
    const waits = started.map(t => t.firstStartAt - t.createdAt).sort((a, b) => a - b);
    const median = waits.length ? waits[Math.floor(waits.length / 2)] : null;
    const comebacks = state.recoveries.filter(x => x > since).length;
    const el = $('#stats');
    el.hidden = !started.length;
    if (!started.length) return;
    const medTxt = median === null ? '–' : median < MIN ? '<1 min' : median < 60 * MIN ? `${mins(median)} min` : `${Math.round(median / 3600000)} h`;
    el.innerHTML = [[started.length, 'started this week'], [finished, 'finished'], [medTxt, 'median time to start'], [comebacks, 'comebacks']]
      .map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  }

  // create a task from the composer
  async function createFromAsk() {
    const raw = $('#askInput').value.trim();
    if (raw.length < 2) { $('#askInput').focus(); toast('Type what you\'re avoiding first.'); return; }
    const p = parseWhen(raw);
    const btn = $('#askBtn');
    let t;
    if (p.kind === 'event') {
      t = newTask(p.title, eventSteps(p.dueAt), 'quick', { kind: 'event', dueAt: p.dueAt });
    } else {
      let useAi = account.user && account.user.aiLeft > 0;
      if (useAi && !state.aiConsent) useAi = await askConsent();
      if (useAi) {
        btn.disabled = true; btn.classList.add('busy');
        planCard.hidden = false;
        $('#planTitle').value = p.title; $('#planBadge').textContent = '✨ Thinking…'; $('#planTip').textContent = '';
        $('#planSteps').innerHTML = '<li class="loading"><span class="spinner"></span>Writing tiny steps for you…</li>';
        const r = await api('/api/step', { method: 'POST', body: JSON.stringify({ action: 'breakdown', task: p.title }) }).catch(() => ({ ok: false, data: {} }));
        btn.disabled = false; btn.classList.remove('busy');
        if (typeof r.data.aiLeft === 'number' && account.user) { account.user.aiLeft = r.data.aiLeft; renderAccount(); }
        if (r.ok && Array.isArray(r.data.steps)) { t = newTask(r.data.title || p.title, r.data.steps, 'ai'); t.tip = r.data.tip || ''; track('ai_breakdown'); }
        else {
          if (r.status === 401) { account.user = null; renderAccount(); }
          toast(r.data.error ? `${r.data.error} Using quick steps.` : 'AI is unavailable right now. Using quick steps.');
        }
      }
      if (!t) { t = newTask(p.title, quickSteps(p.title), 'quick'); track('quick_steps'); }
      if (p.dueAt) { t.dueAt = p.dueAt; t.dayOnly = p.dayOnly; }
    }
    state.tasks.unshift(t); state.selectedId = t.id; save();
    $('#askInput').value = '';
    track('task_created'); buzz(10);
    renderNow();
    if (p.dueAt) toast(`${t.kind === 'event' ? '📅' : '⏰'} ${formatWhen(t.dueAt, new Date(), t.dayOnly)}. It stays put until you move it.`);
    if (matchMedia('(max-width: 720px)').matches) $('#askInput').blur();
    planCard.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  }
  $('#askForm').addEventListener('submit', e => { e.preventDefault(); createFromAsk(); });
  $$('[data-ask]').forEach(b => b.addEventListener('click', () => { $('#askInput').value = b.dataset.ask; createFromAsk(); }));

  // plan editing (never overwritten without the user doing it)
  $('#planTitle').addEventListener('input', e => { const t = selected(); if (t) { t.title = e.target.value.slice(0, 80) || 'Untitled'; save(); } });
  $('#planTitle').addEventListener('change', () => renderList());
  $('#planSteps').addEventListener('input', e => {
    const li = e.target.closest('li'); const t = selected(); if (!li || !t) return;
    const s = t.steps.find(x => x.id === li.dataset.id); if (s) { s.text = e.target.value.replace(/\n/g, ' ').slice(0, 140); save(); fit(e.target); }
  });
  $('#planSteps').addEventListener('click', e => {
    const id = e.target.dataset.del; const t = selected(); if (!id || !t) return;
    if (t.steps.length <= 1) { toast('Keep at least one step.'); return; }
    change('Step removed.', () => { t.steps = t.steps.filter(s => s.id !== id); });
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
  });
  $('#clearWhen').addEventListener('click', () => { const t = selected(); if (t) change('Time removed.', () => { t.dueAt = null; t.dayOnly = false; }); });
  let sessionMin = 10;
  $$('.seg-mini [data-min]').forEach(b => b.addEventListener('click', () => {
    sessionMin = +b.dataset.min; buzz(6);
    $$('.seg-mini [data-min]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
  }));
  $('#startBtn').addEventListener('click', () => { const t = selected(); if (t) startSession(t, sessionMin); });
  $('#smallerBtn').addEventListener('click', async () => {
    const t = selected(); if (!t) return;
    await makeSmaller(t, Math.min(curIndex(t), t.steps.length - 1));
    renderPlan();
  });
  $('#dropBtn').addEventListener('click', () => { const t = selected(); if (t) change(`Dropped "${t.title}".`, () => { t.droppedAt = Date.now(); state.selectedId = null; }); });

  $('#upNext').addEventListener('click', e => { const t = byId(e.currentTarget.dataset.id); if (t) { state.selectedId = t.id; save(); renderNow(); planCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } });

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
      change('Turned it into a reschedule task. Step 1 takes 1 minute.', () => {
        const w = t.title.match(/\bwith\s+(.+)$/i); const who = w ? w[1].trim() : 'them';
        t.title = `Reschedule: ${t.title}`.slice(0, 80); t.kind = 'task'; t.dueAt = null; t.source = 'quick'; t.tip = 'Short and honest works best. No long apology needed.';
        t.steps = [`Write 2 lines to ${who}: "Sorry I missed our time. Could we find another slot this week?"`, 'Send it.', 'When they reply, add the new time here.'].map(text => ({ id: uid(), text, done: false }));
        state.selectedId = t.id;
      });
      planCard.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    }
    if (act === 'now') {
      const snapDue = t.dueAt;
      t.dueAt = null; t.dayOnly = false; state.selectedId = t.id; save();
      toast('Deadline cleared. 5 minutes, just the first step.', { label: 'Undo', fn: () => { t.dueAt = snapDue; save(); renderNow(); } });
      startSession(t, 5);
    }
  });

  // list: open, check, start
  $('#taskList').addEventListener('click', e => {
    const li = e.target.closest('li.task'); if (!li) return;
    const t = byId(li.dataset.id); if (!t) return;
    if (e.target.closest('[data-open]')) { state.selectedId = t.id; save(); renderNow(); buzz(6); planCard.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' }); }
    if (e.target.closest('[data-go]')) { state.selectedId = t.id; startSession(t, sessionMin); }
    if (e.target.closest('[data-check]')) {
      li.classList.add('checking'); buzz([10, 40, 18]);
      const r = e.target.closest('[data-check]').getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2);
      setTimeout(() => li.classList.add('leaving'), 380);
      setTimeout(() => change(`Done: "${t.title}" 🎉`, () => { t.finishedAt = Date.now(); if (state.selectedId === t.id) state.selectedId = null; track('task_finished'); }), reduceMotion ? 0 : 650);
    }
  });

  // reorder: drag the ⋮⋮ handle (mouse or finger), or use arrow keys on it
  const ul = $('#taskList'); let drag = null;
  ul.addEventListener('pointerdown', e => {
    const h = e.target.closest('[data-handle]'); if (!h) return;
    e.preventDefault();
    const li = h.closest('li'); const r = li.getBoundingClientRect();
    drag = { li, grab: e.clientY - r.top, ty: 0, moved: false, pid: e.pointerId };
    h.setPointerCapture(e.pointerId); li.classList.add('dragging'); ul.classList.add('sorting'); buzz(8);
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
    li.style.transform = ''; li.classList.remove('dragging'); ul.classList.remove('sorting');
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

  $('#resumeBtn').addEventListener('click', e => { const t = byId(e.currentTarget.dataset.id); if (t) { state.selectedId = t.id; save(); startSession(t, 10); } });
  $('#resumeLater').addEventListener('click', () => { const t = byId($('#resumeBtn').dataset.id); state.dismissedResume = t ? t.id : null; save(); renderResume(); });

  // AI: make a step smaller (falls back to a simple split without AI)
  async function makeSmaller(t, i) {
    const step = t.steps[i]; if (!step) return false;
    let pieces = null;
    let useAi = account.user && account.user.aiLeft > 0;
    if (useAi && !state.aiConsent) useAi = await askConsent();
    if (useAi) {
      toast('Making it smaller…');
      const r = await api('/api/step', { method: 'POST', body: JSON.stringify({ action: 'smaller', task: t.title, step: step.text }) }).catch(() => ({ ok: false, data: {} }));
      if (typeof r.data.aiLeft === 'number' && account.user) { account.user.aiLeft = r.data.aiLeft; renderAccount(); }
      if (r.ok && Array.isArray(r.data.steps)) pieces = r.data.steps;
    }
    if (!pieces) pieces = ['Open what you need for this step. Just open it.', `Do only the first 2 minutes of: ${step.text.replace(/\.$/, '')}`];
    const snap = JSON.stringify(t.steps);
    t.steps.splice(i, 1, ...pieces.map(text => ({ id: uid(), text, done: false })));
    track('stuck'); save(); buzz(10);
    toast('Made it smaller. Just do the first one.', { label: 'Undo', fn: () => { t.steps = JSON.parse(snap); save(); renderPlan(); if (!F.el.hidden) paintFocus(); } });
    return true;
  }

  /* ---------- focus mode ---------- */
  const F = { el: $('#focus'), main: $('#fMain'), recover: $('#fRecover'), timeup: $('#fTimeup'), finished: $('#fFinished') };
  let tick = null, hiddenAt = null, lastFocusEl = null;
  const sess = () => state.session;
  const remaining = () => { const s = sess(); if (!s) return 0; return s.paused ? s.left : s.endsAt - Date.now(); };
  const activePanel = () => ['main', 'recover', 'timeup', 'finished'].find(k => !F[k].hidden);

  function showPanel(which) {
    ['main', 'recover', 'timeup', 'finished'].forEach(k => { F[k].hidden = k !== which; });
    const target = { main: '#fDone', recover: '#fRestart', timeup: '#fUpDone', finished: '#fBack' }[which];
    setTimeout(() => $(target)?.focus({ preventScroll: true }), 30);
  }

  function startSession(t, minutes) {
    const now = Date.now();
    if (!t.firstStartAt) t.firstStartAt = now;
    t.lastActiveAt = now;
    state.selectedId = t.id; state.dismissedResume = null;
    state.session = { taskId: t.id, startedAt: now, endsAt: now + minutes * MIN, total: minutes * MIN, paused: false, left: 0 };
    save(); track('session_started'); buzz(14);
    openFocus();
  }

  function openFocus() {
    const s = sess(); const t = s && byId(s.taskId);
    if (!t) { state.session = null; save(); return; }
    lastFocusEl = document.activeElement;
    F.el.hidden = false; document.body.classList.add('focusing');
    paintFocus(); showPanel('main');
    clearInterval(tick); tick = setInterval(onTick, 250); onTick();
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
    $('#fTime').textContent = fmt(left);
    $('#fRing').style.setProperty('--p', Math.max(0, Math.min(1, left / s.total)));
    $('#fRing').classList.toggle('paused', s.paused);
    $('#fPause').textContent = s.paused ? '▶' : '❚❚';
    $('#fPause').setAttribute('aria-label', s.paused ? 'Resume timer' : 'Pause timer');
    if (!s.paused && left <= 0 && activePanel() === 'main') { pause(); buzz([30, 60, 30]); showPanel('timeup'); }
  }

  function pause() { const s = sess(); if (s && !s.paused) { s.left = Math.max(0, s.endsAt - Date.now()); s.paused = true; save(); } }
  function resume() { const s = sess(); if (s && s.paused) { s.endsAt = Date.now() + s.left; s.paused = false; save(); } }
  function restartWith(minutes) { const s = sess(); if (!s) return; s.total = minutes * MIN; s.endsAt = Date.now() + s.total; s.paused = false; save(); }

  function endSession(reason) {
    const s = sess(); if (!s) return;
    const t = byId(s.taskId);
    if (t) { t.focusMs = (t.focusMs || 0) + Math.max(0, Date.now() - s.startedAt); t.lastActiveAt = Date.now(); }
    state.session = null; save();
    clearInterval(tick); tick = null;
    F.el.hidden = true; document.body.classList.remove('focusing');
    if (reason === 'stop') toast('Saved. Your step will be waiting.');
    if (location.hash !== '#/now') location.hash = '#/now'; else renderNow();
    lastFocusEl?.focus?.({ preventScroll: true });
  }

  function completeStep() {
    const s = sess(); const t = s && byId(s.taskId); if (!t) return;
    const i = curIndex(t); if (t.steps[i]) t.steps[i].done = true;
    track('step_done'); buzz([10, 30, 14]);
    const r = $('#fDone').getBoundingClientRect(); burst(r.left + r.width / 2, r.top);
    if (curIndex(t) >= t.steps.length) return finishTask(t);
    save(); paintFocus();
    if (remaining() <= 0) restartWith(5); else resume();
    showPanel('main');
  }

  function finishTask(t) {
    t.finishedAt = Date.now(); save(); track('task_finished');
    const s = sess();
    const tookMs = (t.focusMs || 0) + (s ? Date.now() - s.startedAt : 0);
    const wait = t.firstStartAt - t.createdAt;
    $('#fFinishedText').textContent = `"${t.title}" is done. You worked on it for ${Math.max(1, mins(tookMs))} min${wait > MIN ? `, and started ${mins(wait) >= 60 ? Math.round(wait / 3600000) + ' h' : mins(wait) + ' min'} after naming it` : ''}.`;
    pause(); showPanel('finished'); buzz([20, 50, 20, 50, 40]);
    if (!reduceMotion) setTimeout(() => { burst(innerWidth / 2, innerHeight / 2 - 60); burst(innerWidth / 2 - 80, innerHeight / 2); burst(innerWidth / 2 + 80, innerHeight / 2); }, 120);
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
  $('#fUpDone').addEventListener('click', completeStep);
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
  $('#fRestart').addEventListener('click', () => { state.recoveries.push(Date.now()); track('recovered'); restartWith(5); buzz(12); showPanel('main'); });
  $('#fKeep').addEventListener('click', () => { state.recoveries.push(Date.now()); track('recovered'); if (remaining() <= 0) restartWith(5); else resume(); showPanel('main'); });
  $('#fMore').addEventListener('click', () => { restartWith(5); showPanel('main'); });
  ['#fStop', '#fRecoverStop', '#fUpStop'].forEach(id => $(id).addEventListener('click', () => endSession('stop')));
  $('#fBack').addEventListener('click', () => { state.selectedId = null; endSession('done'); });

  // keyboard: anywhere and in focus mode
  document.addEventListener('keydown', e => {
    if (!consentEl.hidden) { if (e.key === 'Escape' && consentResolve) consentResolve(false); return; }
    if (!F.el.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); endSession('stop'); return; }
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const p = activePanel();
      if (p === 'main') {
        if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); completeStep(); }
        else if (e.key === ' ') { e.preventDefault(); togglePause(); }
        else if (e.key.toLowerCase() === 's') { e.preventDefault(); stuck(); }
        else if (e.key.toLowerCase() === 'd') { e.preventDefault(); distracted(false); }
      }
      return;
    }
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'n' || e.key === '/') { e.preventDefault(); if (location.hash !== '#/now') location.hash = '#/now'; setTimeout(() => $('#askInput').focus(), 30); }
  });

  // Leaving the tab during a running session counts as drifting (we only know you left, never where you went)
  document.addEventListener('visibilitychange', () => {
    const s = sess(); if (!s || F.el.hidden) return;
    if (document.hidden) { if (!s.paused) hiddenAt = Date.now(); }
    else if (hiddenAt) {
      const away = Date.now() - hiddenAt; hiddenAt = null;
      if (away > 45000 && activePanel() === 'main') distracted(true, away);
    }
  });

  // keep "missed" and "up next" fresh while the app is open
  setInterval(() => { if (current === 'now' && F.el.hidden && !typing(document.activeElement)) { renderUpNext(); renderMissed(); renderList(); } }, 30000);

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
      $('#acctEmail').textContent = u.email;
      $('#acctPlan').textContent = paid ? 'Founding member ✓' : 'Free';
      $('#acctAi').textContent = `${u.aiLeft} of ${u.aiLimit} left`;
      $('#acctUpgrade').hidden = paid; $('#acctPaid').hidden = !paid;
    }
    if (current === 'now') renderAskNote();
    if (current === 'account') renderLedger();
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
      const r = await api(`/api/auth?action=${account.mode}`, { method: 'POST', body: JSON.stringify({ email, password }) });
      if (!r.ok) { msg.textContent = r.data.error || 'Something went wrong.'; return; }
      account.user = r.data.user; $('#authPw').value = ''; renderAccount();
      track(account.mode === 'signup' ? 'signup' : 'login');
      toast(account.mode === 'signup' ? '🎉 Account created. AI steps are on.' : `Welcome back, ${account.user.email}`);
      const next = account.next; account.next = null;
      if (next === 'buy') startCheckout(); else if (openTasks().length || account.mode === 'signup') location.hash = '#/now';
    } catch { msg.textContent = 'Network error. Check your connection.'; }
    finally { btn.disabled = false; btn.textContent = label; }
  });
  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/auth?action=logout', { method: 'POST' }).catch(() => {});
    account.user = null; setMode('login'); renderAccount(); toast('Logged out. Your tasks are still on this device.');
  });
  async function startCheckout() {
    if (!account.user) { setMode('signup'); goLogin('Create a free account (or log in), then you\'ll go straight to checkout.', 'buy'); return; }
    if (account.user.plan === 'personal') { toast('You\'re already a founding member ✓'); location.hash = '#/account'; return; }
    toast('Opening secure Stripe checkout…'); track('checkout_started');
    const r = await api('/api/checkout?action=create', { method: 'POST' }).catch(() => ({ ok: false, data: {} }));
    if (r.ok && r.data.url) { location.href = r.data.url; return; }
    if (r.ok && r.data.already) { await loadMe(); return; }
    toast(r.data.error || 'Couldn\'t open checkout. Try again.');
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-buy]'); if (b) { e.preventDefault(); startCheckout(); } });
  async function loadMe() {
    const r = await api('/api/auth?action=me').catch(() => ({ ok: false, data: {} }));
    account.user = r.ok ? r.data.user : null; account.loaded = true; renderAccount();
  }
  async function handleCheckoutReturn() {
    const params = new URLSearchParams(location.search);
    const result = params.get('checkout'); if (!result) return;
    const sessionId = params.get('session_id');
    history.replaceState(null, '', location.pathname + location.hash);
    if (result === 'cancel') { toast('Checkout canceled. You weren\'t charged.'); return; }
    if (result === 'success' && sessionId) {
      const r = await api('/api/checkout?action=verify', { method: 'POST', body: JSON.stringify({ sessionId }) }).catch(() => ({ ok: false, data: {} }));
      if (r.ok && r.data.user) { account.user = r.data.user; renderAccount(); track('paid'); toast('🎉 Payment received. Welcome, founding member!'); }
      else toast(r.data.error || 'We couldn\'t confirm the payment yet. Refresh in a moment.');
    }
  }

  /* ---------- your data ---------- */
  function renderLedger() {
    const bytes = new Blob([localStorage.getItem(KEY) || '']).size;
    const u = account.user;
    $('#ledger').innerHTML = [
      ['On this device', `${state.tasks.length} task${state.tasks.length === 1 ? '' : 's'}, their steps, times and session history (${bytes.toLocaleString()} bytes in your browser)`],
      ['On our servers', u ? `Your email (${esc(u.email)}), a hashed password, your plan, today's AI count, and anonymous counts like "session started". Never your task text.` : 'Nothing tied to you. Anonymous counts like "session started" with a random id, never your task text.'],
      ['Sent to Anthropic (Claude)', 'Only the task or step text you send when you use ✨ AI. We don\'t store it.'],
    ].map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
  }
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'Comeback', exported: new Date().toISOString(), tasks: state.tasks, recoveries: state.recoveries }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `comeback-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  let wipeArmed = false;
  $('#wipeBtn').addEventListener('click', () => {
    if (!wipeArmed) { wipeArmed = true; $('#wipeBtn').textContent = 'Tap again to erase everything'; setTimeout(() => { wipeArmed = false; $('#wipeBtn').textContent = 'Erase data on this device'; }, 4000); return; }
    const anonId = state.anonId; state = fresh(); state.anonId = anonId; state.migrated = true; save();
    wipeArmed = false; $('#wipeBtn').textContent = 'Erase data on this device'; renderLedger(); toast('Erased from this device.');
  });
  $('#deleteForm').addEventListener('submit', async e => {
    e.preventDefault();
    const r = await api('/api/auth?action=delete', { method: 'POST', body: JSON.stringify({ password: $('#deletePw').value }) }).catch(() => ({ ok: false, data: {} }));
    if (!r.ok) { $('#deleteMsg').textContent = r.data.error || 'Could not delete the account.'; return; }
    $('#deletePw').value = ''; $('#deleteBox').open = false;
    account.user = null; renderAccount(); toast('Your account was deleted.');
  });

  /* ---------- offline support ---------- */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  /* ---------- init ---------- */
  setMode('signup');
  route();
  track('visit');
  loadMe().then(() => { handleCheckoutReturn(); if (current === 'now') renderNow(); });
  if (state.session && byId(state.session.taskId)) {
    if (location.hash !== '#/now') location.hash = '#/now';
    openFocus();
    if (!state.session.paused) { pause(); distracted(true, Date.now() - (state.session.endsAt - state.session.total)); }
  }
})();
