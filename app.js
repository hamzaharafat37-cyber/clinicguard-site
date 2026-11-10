/* Comeback: start what you're avoiding, come back when you drift.
   Tasks and sessions live in this browser (localStorage). AI calls go through /api/step (server holds the key). */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const MIN = 60000, DAY = 86400000;

  /* ---------- state ---------- */
  const KEY = 'comeback:v1';
  const fresh = () => ({ v: 1, tasks: [], selectedId: null, session: null, anonId: uid(), aiConsent: false, recoveries: [], dismissedResume: null });
  let state;
  try { state = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { state = fresh(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ } };

  /* ---------- tiny helpers ---------- */
  const toastEl = $('#toast'); let toastT;
  const toast = msg => { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 3200); };
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

  function newTask(title, steps, source) {
    return { id: uid(), title: (s => s.charAt(0).toUpperCase() + s.slice(1))(String(title).trim().slice(0, 80)), steps: steps.map(text => ({ id: uid(), text, done: false })), source, createdAt: Date.now(), firstStartAt: null, finishedAt: null, focusMs: 0, distractions: 0 };
  }
  const byId = id => state.tasks.find(t => t.id === id);
  const curIndex = t => { const i = t.steps.findIndex(s => !s.done); return i === -1 ? t.steps.length : i; };
  const openTasks = () => state.tasks.filter(t => !t.finishedAt);

  // One-time import of unfinished tasks from ClinicGuard Personal (same browser)
  if (!state.migrated) {
    try {
      const old = JSON.parse(localStorage.getItem('clinicguard-personal:v1') || 'null');
      (old?.tasks || []).filter(t => !t.done && t.title).slice(0, 20).forEach(t => state.tasks.push(newTask(t.title, [t.step || quickFirst(t.title), `Work on it for 10 minutes. Messy is fine.`], 'quick')));
    } catch { /* ignore */ }
    state.migrated = true; save();
  }


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
      $('.nav-account').setAttribute('aria-current', name === 'account' ? 'page' : 'false');
      document.title = TITLES[name];
      if (name === 'now') renderNow();
      if (name === 'account') renderLedger();
      if (isRoute || !h) window.scrollTo({ top: 0, behavior: 'instant' });
    }
    if (!isRoute && h.length > 1) { const el = document.getElementById(h.slice(1)); if (el) el.scrollIntoView({ behavior: 'smooth' }); }
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
  const selected = () => byId(state.selectedId);

  function renderNow() {
    renderAskNote(); renderPlan(); renderList(); renderResume(); renderStats();
  }

  function renderAskNote() {
    const u = account.user; const n = $('#askNote');
    if (!account.loaded) { n.textContent = ''; return; }
    if (!u) n.innerHTML = 'Quick steps work right away. <a href="#/account">Create a free account</a> to get ✨ AI steps written for your exact task (5 a day).';
    else if (u.aiLeft > 0) n.innerHTML = `✨ AI steps on · ${u.aiLeft} left today${u.plan === 'personal' ? '' : ' · <a href="#/account">Upgrade</a>'}`;
    else n.innerHTML = `You've used today's AI steps, so you'll get quick steps.${u.plan === 'personal' ? '' : ' <a href="#/account">Become a founding member</a> for 100 a day.'}`;
  }

  function renderPlan() {
    const t = selected();
    if (!t || t.finishedAt) { planCard.hidden = true; return; }
    planCard.hidden = false;
    $('#planTitle').value = t.title;
    const badge = $('#planBadge'); badge.textContent = t.source === 'ai' ? '✨ AI steps' : 'Quick steps'; badge.classList.toggle('quick', t.source !== 'ai');
    $('#planTip').textContent = t.tip || '';
    const ci = curIndex(t);
    $('#planSteps').innerHTML = t.steps.map((s, i) => `<li class="${s.done ? 'done' : ''}" data-id="${s.id}"><label class="sr-only" for="st-${s.id}">Step ${i + 1}</label><textarea id="st-${s.id}" rows="1" maxlength="140">${esc(s.text)}</textarea><button type="button" class="step-x" data-del="${s.id}" aria-label="Remove step ${i + 1}">×</button></li>`).join('');
    $$('#planSteps textarea').forEach(fit);
    $('#startBtn').textContent = ci === 0 ? 'Start step 1 →' : ci < t.steps.length ? `Continue step ${ci + 1} →` : 'Finish →';
    $('#smallerBtn').textContent = `Step ${Math.min(ci, t.steps.length - 1) + 1} still feels too big? Make it smaller`;
  }

  function fit(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  addEventListener('resize', () => $$('#planSteps textarea').forEach(fit));

  function renderList() {
    const list = openTasks().filter(t => t.id !== state.selectedId);
    $('#listCard').hidden = !list.length;
    $('#taskList').innerHTML = list.map(t => {
      const ci = curIndex(t);
      return `<li><div class="t"><b>${esc(t.title)}</b><span>${t.firstStartAt ? `Step ${Math.min(ci + 1, t.steps.length)} of ${t.steps.length}` : 'Not started yet'}</span></div><button class="btn btn-ghost btn-sm" data-open="${t.id}">Open</button><button class="step-x" data-remove="${t.id}" aria-label="Remove ${esc(t.title)}">×</button></li>`;
    }).join('');
  }

  function renderResume() {
    const t = openTasks().filter(x => x.firstStartAt && x.id !== state.selectedId).sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0))[0];
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
    const focus = state.tasks.reduce((n, t) => n + (t.focusMs || 0), 0);
    const el = $('#stats');
    el.hidden = !started.length;
    if (!started.length) return;
    const medTxt = median === null ? '–' : median < MIN ? '<1 min' : median < 60 * MIN ? `${mins(median)} min` : `${Math.round(median / 3600000)} h`;
    el.innerHTML = [[started.length, 'started this week'], [finished, 'finished'], [medTxt, 'median time to start'], [comebacks, 'comebacks']]
      .map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('') + (focus ? '' : '');
  }

  // create a task from the ask box
  async function createFromAsk() {
    const text = $('#askInput').value.trim();
    if (text.length < 2) { $('#askInput').focus(); toast('Type what you\'re avoiding first.'); return; }
    const btn = $('#askBtn');
    let useAi = account.user && account.user.aiLeft > 0;
    if (useAi && !state.aiConsent) useAi = await askConsent();
    let t;
    if (useAi) {
      btn.disabled = true; btn.textContent = 'Thinking…';
      planCard.hidden = false;
      $('#planSteps').innerHTML = '<li class="loading"><span class="spinner"></span>Writing tiny steps for you…</li>';
      const r = await api('/api/step', { method: 'POST', body: JSON.stringify({ action: 'breakdown', task: text }) }).catch(() => ({ ok: false, data: {} }));
      btn.disabled = false; btn.textContent = 'Break it down';
      if (typeof r.data.aiLeft === 'number' && account.user) { account.user.aiLeft = r.data.aiLeft; renderAccount(); }
      if (r.ok && Array.isArray(r.data.steps)) { t = newTask(r.data.title || text, r.data.steps, 'ai'); t.tip = r.data.tip || ''; track('ai_breakdown'); }
      else {
        if (r.status === 401) { account.user = null; renderAccount(); }
        toast(r.data.error ? `${r.data.error} Using quick steps.` : 'AI is unavailable right now. Using quick steps.');
      }
    }
    if (!t) { t = newTask(text, quickSteps(text), 'quick'); track('quick_steps'); }
    state.tasks.unshift(t); state.selectedId = t.id; save();
    $('#askInput').value = '';
    track('task_created');
    renderNow();
    $('#planCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  $('#askForm').addEventListener('submit', e => { e.preventDefault(); createFromAsk(); });
  $$('[data-ask]').forEach(b => b.addEventListener('click', () => { $('#askInput').value = b.dataset.ask; createFromAsk(); }));

  // editing the plan (never overwritten without the user doing it)
  $('#planTitle').addEventListener('input', e => { const t = selected(); if (t) { t.title = e.target.value.slice(0, 80) || 'Untitled'; save(); } });
  $('#planSteps').addEventListener('input', e => {
    const li = e.target.closest('li'); const t = selected(); if (!li || !t) return;
    const s = t.steps.find(x => x.id === li.dataset.id); if (s) { s.text = e.target.value.replace(/\n/g, ' ').slice(0, 140); save(); fit(e.target); }
  });
  $('#planSteps').addEventListener('click', e => {
    const id = e.target.dataset.del; const t = selected(); if (!id || !t) return;
    if (t.steps.length <= 1) { toast('Keep at least one step.'); return; }
    t.steps = t.steps.filter(s => s.id !== id); save(); renderPlan();
  });
  $('#addStep').addEventListener('click', () => {
    const t = selected(); if (!t || t.steps.length >= 12) return;
    const s = { id: uid(), text: '', done: false }; t.steps.push(s); save(); renderPlan();
    $(`#st-${s.id}`).focus();
  });
  let sessionMin = 10;
  $$('.seg-mini [data-min]').forEach(b => b.addEventListener('click', () => {
    sessionMin = +b.dataset.min;
    $$('.seg-mini [data-min]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
  }));
  $('#startBtn').addEventListener('click', () => { const t = selected(); if (t) startSession(t, sessionMin); });
  $('#smallerBtn').addEventListener('click', async () => {
    const t = selected(); if (!t) return;
    const i = Math.min(curIndex(t), t.steps.length - 1);
    await makeSmaller(t, i);
    renderPlan();
  });

  $('#taskList').addEventListener('click', e => {
    const open = e.target.closest('[data-open]'); const rm = e.target.closest('[data-remove]');
    if (open) { state.selectedId = open.dataset.open; save(); renderNow(); $('#planCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    if (rm) {
      const t = byId(rm.dataset.remove);
      if (t && confirm(`Remove "${t.title}" from your list?`)) { state.tasks = state.tasks.filter(x => x.id !== t.id); save(); renderNow(); }
    }
  });
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
    t.steps.splice(i, 1, ...pieces.map(text => ({ id: uid(), text, done: false })));
    track('stuck'); save();
    toast('Made it smaller. Just do the first one.');
    return true;
  }

  /* ---------- focus mode ---------- */
  const F = { el: $('#focus'), main: $('#fMain'), recover: $('#fRecover'), timeup: $('#fTimeup'), finished: $('#fFinished') };
  let tick = null, hiddenAt = null, lastFocusEl = null;
  const sess = () => state.session;
  const remaining = () => { const s = sess(); if (!s) return 0; return s.paused ? s.left : s.endsAt - Date.now(); };

  function showPanel(which) {
    ['main', 'recover', 'timeup', 'finished'].forEach(k => { F[k].hidden = k !== which; });
    const target = { main: '#fDone', recover: '#fRestart', timeup: '#fUpDone', finished: '#fBack' }[which];
    setTimeout(() => $(target)?.focus(), 30);
  }

  function startSession(t, minutes) {
    const now = Date.now();
    if (!t.firstStartAt) t.firstStartAt = now;
    t.lastActiveAt = now;
    state.selectedId = t.id; state.dismissedResume = null;
    state.session = { taskId: t.id, startedAt: now, endsAt: now + minutes * MIN, total: minutes * MIN, paused: false, left: 0 };
    save(); track('session_started');
    openFocus();
  }

  function openFocus() {
    const s = sess(); const t = s && byId(s.taskId);
    if (!t) { state.session = null; save(); return; }
    lastFocusEl = document.activeElement;
    F.el.hidden = false; document.body.style.overflow = 'hidden';
    paintFocus(); showPanel('main');
    clearInterval(tick); tick = setInterval(onTick, 250); onTick();
  }

  function paintFocus() {
    const s = sess(); const t = byId(s.taskId); const i = curIndex(t);
    $('#fTask').textContent = t.title;
    $('#fCount').textContent = `Step ${Math.min(i + 1, t.steps.length)} of ${t.steps.length}`;
    $('#fStep').textContent = (t.steps[i] || t.steps[t.steps.length - 1]).text || 'Do the next small thing.';
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
    if (!s.paused && left <= 0 && F.timeup.hidden && F.recover.hidden && F.finished.hidden) {
      pause(); showPanel('timeup');
    }
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
    F.el.hidden = true; document.body.style.overflow = '';
    if (reason === 'stop') toast('Saved. Your step will be waiting.');
    if (location.hash !== '#/now') location.hash = '#/now'; else renderNow();
    lastFocusEl?.focus?.();
  }

  function completeStep() {
    const s = sess(); const t = s && byId(s.taskId); if (!t) return;
    const i = curIndex(t); if (t.steps[i]) t.steps[i].done = true;
    track('step_done');
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
    pause(); showPanel('finished');
  }

  function distracted(auto, awayMs) {
    const s = sess(); const t = s && byId(s.taskId); if (!t) return;
    t.distractions = (t.distractions || 0) + 1; save(); track('distracted');
    pause();
    const step = (t.steps[curIndex(t)] || {}).text || '';
    $('#fRecoverText').textContent = `${auto ? `You were away for ${Math.max(1, mins(awayMs))} min. ` : 'It happens to everyone. '}You were on: "${step}"`;
    showPanel('recover');
  }

  $('#fDone').addEventListener('click', completeStep);
  $('#fUpDone').addEventListener('click', completeStep);
  $('#fPause').addEventListener('click', () => { const s = sess(); if (!s) return; s.paused ? resume() : pause(); onTick(); });
  $('#fDistracted').addEventListener('click', () => distracted(false));
  $('#fStuck').addEventListener('click', async () => {
    const s = sess(); const t = s && byId(s.taskId); if (!t) return;
    pause(); $('#fStuck').disabled = true;
    await makeSmaller(t, Math.min(curIndex(t), t.steps.length - 1));
    $('#fStuck').disabled = false; paintFocus(); resume(); showPanel('main');
  });
  $('#fRestart').addEventListener('click', () => { state.recoveries.push(Date.now()); track('recovered'); restartWith(5); showPanel('main'); });
  $('#fKeep').addEventListener('click', () => { state.recoveries.push(Date.now()); track('recovered'); if (remaining() <= 0) restartWith(5); else resume(); showPanel('main'); });
  $('#fMore').addEventListener('click', () => { restartWith(5); showPanel('main'); });
  ['#fStop', '#fRecoverStop', '#fUpStop'].forEach(id => $(id).addEventListener('click', () => endSession('stop')));
  $('#fBack').addEventListener('click', () => { state.selectedId = null; endSession('done'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !F.el.hidden && consentEl.hidden) endSession('stop'); });

  // Leaving the tab during a running session counts as drifting (we only know you left, never where you went)
  document.addEventListener('visibilitychange', () => {
    const s = sess(); if (!s || F.el.hidden) return;
    if (document.hidden) { if (!s.paused) hiddenAt = Date.now(); }
    else if (hiddenAt) {
      const away = Date.now() - hiddenAt; hiddenAt = null;
      if (away > 45000 && F.main && !F.main.hidden) distracted(true, away);
    }
  });

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
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !consentEl.hidden && consentResolve) consentResolve(false); });

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
      ['On this device', `${state.tasks.length} task${state.tasks.length === 1 ? '' : 's'}, their steps and session times (${bytes.toLocaleString()} bytes in your browser)`],
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

  /* ---------- init ---------- */
  setMode('signup');
  route();
  track('visit');
  loadMe().then(() => { handleCheckoutReturn(); if (current === 'now') renderNow(); });
  if (state.session && byId(state.session.taskId)) { if (location.hash !== '#/now') location.hash = '#/now'; openFocus(); if (!state.session.paused) { pause(); distracted(true, Date.now() - (state.session.endsAt - state.session.total)); } }
})();
