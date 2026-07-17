/* GymPlan app: login -> home (week + session picker) -> guided workout player
   with rest timers -> summary. All edits are written back to the Google Sheet
   through the API write queue. */

(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    screens: {
      login: $('screen-login'),
      home: $('screen-home'),
      player: $('screen-player'),
      summary: $('screen-summary'),
    },
    syncBadge: $('sync-badge'),
    btnLogout: $('btn-logout'),
  };

  const store = {
    get: (k, fallback) => JSON.parse(localStorage.getItem(k) || 'null') ?? fallback,
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  };

  const state = {
    plan: null,
    week: 1,
    session: null,   // session object from plan
    seq: [],         // [{type:'set',exIdx,setNum,totalSets} | {type:'rest',kind}]
    pos: 0,
    results: {},     // row -> array of rep strings per set
    weights: {},     // row -> weight string
    rest: {},        // active rest seconds {sets, exercises, rounds}
    timer: null,
  };

  /* ================= navigation ================= */

  function show(name) {
    for (const [key, el] of Object.entries(els.screens)) el.hidden = key !== name;
    document.body.dataset.screen = name;
    els.btnLogout.hidden = name !== 'home';
    if (name === 'player') WakeLock.on();
    else WakeLock.off();
  }

  /* ================= login ================= */

  async function tryLogin(url, pass) {
    const btn = $('btn-login');
    const errEl = $('login-error');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    errEl.hidden = true;
    GymAPI.setConfig(url, pass);
    try {
      state.plan = await GymAPI.fetchPlan();
      renderHome();
      show('home');
    } catch (err) {
      GymAPI.clearConfig();
      errEl.textContent =
        String(err.message) === 'unauthorized'
          ? 'Wrong passphrase — please try again.'
          : 'Could not reach the sheet. Check the URL and your connection.';
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Connect';
    }
  }

  $('btn-login').addEventListener('click', () => {
    const url = $('login-url').value.trim();
    const pass = $('login-pass').value;
    if (!url) return;
    tryLogin(url, pass);
  });

  els.btnLogout.addEventListener('click', () => {
    if (!confirm('Log out and forget this device?')) return;
    GymAPI.clearConfig();
    show('login');
  });

  window.onGymAuthError = () => {
    alert('The sheet rejected the passphrase. Please log in again.');
    GymAPI.clearConfig();
    show('login');
  };

  /* ================= home ================= */

  /**
   * A session-week counts as completed when every exercise has a Rep Results
   * value in the sheet — which is exactly what finishing it in the app writes.
   * A partially finished week is resumed; a fully finished one moves the
   * session on to the next week (created in the sheet on demand).
   */
  function isWeekCompleted(session, w) {
    const wk = session.weeks[String(w)];
    return !!wk && wk.entries.length > 0 && wk.entries.every((e) => e.repResults.trim() !== '');
  }

  function sessionCurrentWeek(session) {
    for (let w = 1; w <= state.plan.weekCount; w++) {
      if (session.weeks[String(w)] && !isWeekCompleted(session, w)) return w;
    }
    return state.plan.weekCount + 1; // everything done -> a new week is needed
  }

  function renderHome() {
    const plan = state.plan;
    const cards = $('session-cards');
    cards.innerHTML = '';
    for (const session of plan.sessions) {
      const week = sessionCurrentWeek(session);
      const wk = session.weeks[String(Math.min(week, plan.weekCount))];
      if (!wk) continue;
      const card = document.createElement('button');
      card.className = 'session-card';
      const names = session.exercises.map((e) => e.name);
      const preview = names.slice(0, 3).join(' · ') + (names.length > 3 ? ` · +${names.length - 3} more` : '');
      const restInfo = session.type === 'circuit'
        ? `rest ${wk.rest.exercises}s / ${fmtSecs(wk.rest.rounds)}`
        : `rest ${fmtSecs(wk.rest.sets)}`;
      const resume = week <= plan.weekCount &&
        session.weeks[String(week)].entries.some((e) => e.repResults.trim() !== '');
      const badge = `<span class="week-badge">Week ${week}${resume ? ' · continue' : ''}</span>`;
      card.innerHTML = `
        <h3>${session.title} ${badge}</h3>
        <div class="sub">${escapeHtml(session.label)} · ${restInfo}</div>
        <div class="ex-preview">${escapeHtml(preview)}</div>`;
      card.addEventListener('click', () => startSession(session));
      cards.appendChild(card);
    }
  }

  const fmtSecs = (s) => (s >= 60 ? (s % 60 === 0 ? s / 60 + ' min' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) : s + 's');
  const escapeHtml = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ================= workout player ================= */

  async function startSession(session) {
    let week = sessionCurrentWeek(session);

    // Past the last week in the sheet: have the Apps Script append a new
    // week block (copying sets/goals from the previous one), then reload.
    if (week > state.plan.weekCount) {
      try {
        state.plan = await GymAPI.extendWeek(week);
        session = state.plan.sessions.find((s) => s.id === session.id) || session;
        week = Math.min(week, state.plan.weekCount);
      } catch (err) {
        alert('Could not add a new week to the sheet — check your connection.');
        return;
      }
    }

    state.week = week;
    const wk = session.weeks[String(state.week)];
    state.session = session;
    state.results = {};
    state.weights = {};
    state.seq = buildSequence(session, wk);
    state.pos = 0;

    // Rest config: sheet values + any local per-session override.
    const overrides = store.get('gym.restOverrides', {});
    const ovr = overrides[`s${session.id}.w${state.week}`] || {};
    state.rest = session.type === 'circuit'
      ? { exercises: ovr.exercises ?? wk.rest.exercises, rounds: ovr.rounds ?? wk.rest.rounds }
      : { sets: ovr.sets ?? wk.rest.sets, exercises: ovr.exercises ?? wk.rest.sets };

    $('player-session-label').textContent = `${session.title} · Week ${state.week} · ${session.label}`;
    show('player');
    renderStep();
  }

  /** Builds the ordered list of set-steps and rest-steps for a session. */
  function buildSequence(session, wk) {
    const seq = [];
    if (session.type === 'circuit') {
      const rounds = session.rounds || 3;
      for (let r = 1; r <= rounds; r++) {
        session.exercises.forEach((ex, i) => {
          if (seq.length > 0) seq.push({ type: 'rest', kind: i === 0 ? 'rounds' : 'exercises' });
          seq.push({ type: 'set', exIdx: i, setNum: r, totalSets: rounds });
        });
      }
    } else {
      session.exercises.forEach((ex, i) => {
        const sets = parseInt(wk.entries[i].sets, 10) || 3;
        for (let s = 1; s <= sets; s++) {
          if (seq.length > 0) seq.push({ type: 'rest', kind: s === 1 ? 'exercises' : 'sets' });
          seq.push({ type: 'set', exIdx: i, setNum: s, totalSets: sets });
        }
      });
    }
    return seq;
  }

  function currentStep() { return state.seq[state.pos]; }

  function nextSetStep(from) {
    for (let i = from + 1; i < state.seq.length; i++) {
      if (state.seq[i].type === 'set') return state.seq[i];
    }
    return null;
  }

  function renderStep() {
    const step = currentStep();
    if (!step) return finishSession();
    if (step.type === 'rest') return renderRest(step);
    renderSet(step);
  }

  function renderSet(step) {
    const session = state.session;
    const wk = session.weeks[String(state.week)];
    const ex = session.exercises[step.exIdx];
    const entry = wk.entries[step.exIdx];

    $('view-rest').hidden = true;
    $('view-exercise').hidden = false;

    $('ex-group').textContent = ex.group || ' ';
    $('ex-name').textContent = ex.name;
    const unit = session.type === 'circuit' ? 'Round' : 'Set';
    $('ex-setinfo').textContent = `${unit} ${step.setNum} of ${step.totalSets}`;
    $('ex-goal').textContent = entry.repGoal || '—';

    // Rest settings (labels depend on session type)
    $('rest-a-label').textContent = session.type === 'circuit' ? 'Rest between exercises' : 'Rest between sets';
    $('rest-b-label').textContent = session.type === 'circuit' ? 'Rest between rounds' : 'Rest between exercises';
    $('rest-a').value = session.type === 'circuit' ? state.rest.exercises : state.rest.sets;
    $('rest-b').value = session.type === 'circuit' ? state.rest.rounds : state.rest.exercises;

    // Weight: this session's edits > sheet value > previous week's value.
    const prevEntry = session.weeks[String(state.week - 1)]?.entries[step.exIdx];
    $('in-weight').value = state.weights[ex.row] ?? (entry.weight || prevEntry?.weight || '');

    // Reps: this session's entry for the set, else last week's result for the
    // same set (the trainer's "match last week" rule), else a goal-based guess.
    const recorded = (state.results[ex.row] || [])[step.setNum - 1];
    const prevSet = (prevEntry?.repResults || '').split(',')[step.setNum - 1]?.trim();
    const prevReps = prevSet && prevSet !== '-' ? prevSet : undefined;
    $('in-reps').value = recorded ?? prevReps ?? prefillFromGoal(entry.repGoal);
    $('in-reps').placeholder = entry.repGoal || 'reps';

    const prevBits = [];
    if (prevEntry?.weight) prevBits.push(prevEntry.weight);
    if (prevEntry?.repResults) prevBits.push(prevEntry.repResults);
    $('prev-results').textContent = prevBits.length > 0 ? `Last week: ${prevBits.join(' — ')}` : '';

    const upcoming = nextSetStep(state.pos);
    const btn = $('btn-advance');
    if (!upcoming) btn.textContent = 'Finish session';
    else if (session.type === 'circuit') btn.textContent = upcoming.setNum !== step.setNum ? 'Next round' : 'Next exercise';
    else btn.textContent = upcoming.exIdx === step.exIdx ? 'Next set' : 'Next exercise';

    updateProgress();
  }

  function prefillFromGoal(goal) {
    if (!goal) return '';
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(goal.trim());
    if (range) return range[2];
    const secs = /^(\d+)/.exec(goal.trim());
    if (secs && /sec|min/i.test(goal)) return secs[1];
    return ''; // e.g. MAX -> user fills in
  }

  function commitCurrentSet() {
    const step = currentStep();
    const session = state.session;
    const ex = session.exercises[step.exIdx];
    const entry = session.weeks[String(state.week)].entries[step.exIdx];

    // Reps for this set -> comma-joined per-set string in the sheet.
    const reps = $('in-reps').value.trim();
    const list = state.results[ex.row] || (state.results[ex.row] = []);
    list[step.setNum - 1] = reps || '-';
    const joined = list.map((r) => r ?? '-').join(',');
    if (joined !== entry.repResults) {
      entry.repResults = joined;
      GymAPI.saveCell(session.id, state.week, ex.row, 'repResults', joined);
    }

    // Weight (one value per exercise per week; last edit wins).
    const weight = $('in-weight').value.trim();
    state.weights[ex.row] = weight;
    if (weight !== entry.weight) {
      entry.weight = weight;
      GymAPI.saveCell(session.id, state.week, ex.row, 'weight', weight);
    }
  }

  function readRestInputs() {
    const session = state.session;
    const a = parseInt($('rest-a').value, 10);
    const b = parseInt($('rest-b').value, 10);
    const next = session.type === 'circuit'
      ? { exercises: isNaN(a) ? state.rest.exercises : a, rounds: isNaN(b) ? state.rest.rounds : b }
      : { sets: isNaN(a) ? state.rest.sets : a, exercises: isNaN(b) ? state.rest.exercises : b };

    const changed = JSON.stringify(next) !== JSON.stringify(state.rest);
    if (!changed) return;
    state.rest = next;

    // Remember locally (covers values the sheet layout can't hold, like
    // per-exercise rest in straight sessions)…
    const overrides = store.get('gym.restOverrides', {});
    overrides[`s${session.id}.w${state.week}`] = next;
    store.set('gym.restOverrides', overrides);

    // …and write the session-level rest back into the sheet header.
    const wk = state.session.weeks[String(state.week)];
    if (session.type === 'circuit') {
      wk.rest.exercises = next.exercises;
      wk.rest.rounds = next.rounds;
      GymAPI.saveRest(session.id, state.week, { exercises: next.exercises, rounds: next.rounds });
    } else if (next.sets !== wk.rest.sets) {
      wk.rest.sets = next.sets;
      GymAPI.saveRest(session.id, state.week, { sets: next.sets });
    }
  }

  function renderRest(step) {
    const seconds = state.rest[step.kind] ?? 60;
    if (!seconds || seconds <= 0) { state.pos++; return renderStep(); }

    $('view-exercise').hidden = true;
    $('view-rest').hidden = false;
    $('btn-advance').textContent = 'Skip rest';

    const upcoming = nextSetStep(state.pos);
    if (upcoming) {
      const ex = state.session.exercises[upcoming.exIdx];
      const unit = state.session.type === 'circuit' ? 'Round' : 'Set';
      $('rest-next').textContent = `Next: ${ex.name} — ${unit} ${upcoming.setNum} of ${upcoming.totalSets}`;
    } else {
      $('rest-next').textContent = 'Last one done!';
    }

    state.timer = state.timer || new RestTimer(
      document.querySelector('.timer-progress'),
      $('timer-label'),
      () => advanceFromRest()
    );
    state.timer.start(seconds);
    updateProgress();
  }

  function advanceFromRest() {
    if (state.timer) state.timer.stop();
    if (currentStep()?.type === 'rest') state.pos++;
    renderStep();
  }

  $('btn-advance').addEventListener('click', () => {
    const step = currentStep();
    if (!step) return;
    if (step.type === 'rest') return advanceFromRest();
    readRestInputs();
    commitCurrentSet();
    state.pos++;
    renderStep();
  });

  $('btn-skip').addEventListener('click', advanceFromRest);
  $('btn-add15').addEventListener('click', () => state.timer && state.timer.addSeconds(15));
  $('rest-a').addEventListener('change', readRestInputs);
  $('rest-b').addEventListener('change', readRestInputs);

  $('btn-quit').addEventListener('click', () => {
    if (!confirm('Leave this workout? Completed sets are already saved.')) return;
    if (state.timer) state.timer.stop();
    renderHome();
    show('home');
  });

  function updateProgress() {
    const sets = state.seq.filter((s) => s.type === 'set');
    const done = state.seq.slice(0, state.pos).filter((s) => s.type === 'set').length;
    $('player-progress-bar').firstElementChild.style.width =
      Math.round((done / Math.max(1, sets.length)) * 100) + '%';
  }

  /* ================= summary ================= */

  function finishSession() {
    if (state.timer) state.timer.stop();
    const session = state.session;
    const wk = session.weeks[String(state.week)];

    $('summary-sub').textContent = `${session.title} · Week ${state.week}`;
    const list = $('summary-list');
    list.innerHTML = '';
    session.exercises.forEach((ex, i) => {
      const row = document.createElement('div');
      row.className = 'summary-row';
      const res = [wk.entries[i].weight, wk.entries[i].repResults].filter(Boolean).join(' — ');
      row.innerHTML = `<span>${escapeHtml(ex.name)}</span><span class="res">${escapeHtml(res || '—')}</span>`;
      list.appendChild(row);
    });
    GymAPI.flush();
    show('summary');
  }

  $('btn-done').addEventListener('click', async () => {
    show('home');
    renderHome();
    try {
      state.plan = await GymAPI.fetchPlan();
      renderHome();
    } catch (_) { /* stale view is fine offline */ }
  });

  /* ================= sync badge ================= */

  let badgeTimeout = null;
  GymAPI.onQueueChange((pending, saving) => {
    const badge = els.syncBadge;
    clearTimeout(badgeTimeout);
    if (saving) {
      badge.textContent = 'Saving…';
      badge.className = 'sync-badge saving';
      badge.hidden = false;
    } else if (pending > 0) {
      badge.textContent = navigator.onLine ? `${pending} to save` : 'Offline — will sync';
      badge.className = 'sync-badge' + (navigator.onLine ? '' : ' offline');
      badge.hidden = false;
    } else {
      badge.textContent = 'Saved ✓';
      badge.className = 'sync-badge';
      badge.hidden = false;
      badgeTimeout = setTimeout(() => (badge.hidden = true), 2000);
    }
  });

  /* ================= boot ================= */

  async function boot() {
    GymAPI.startAutoFlush();
    const cfg = GymAPI.getConfig();
    if (!cfg) return show('login');
    try {
      state.plan = await GymAPI.fetchPlan();
      renderHome();
      show('home');
    } catch (err) {
      if (String(err.message) === 'unauthorized') {
        GymAPI.clearConfig();
        show('login');
      } else {
        // Offline etc. — nothing cached to show, so back to login with a hint.
        show('login');
        const errEl = $('login-error');
        errEl.textContent = 'Could not reach the sheet — check your connection.';
        errEl.hidden = false;
        if (cfg.url) $('login-url').value = cfg.url;
      }
    }
  }

  boot();
})();
