/* API layer: talks to the Google Apps Script web app.
   - All requests are POSTs with Content-Type text/plain (no CORS preflight,
     and the passphrase never appears in a URL).
   - Writes go through a localStorage-backed queue so a dropped connection at
     the gym never loses data; the queue retries on a timer and on 'online'.
   - URL "demo" switches to a bundled synthetic plan with local-only saves. */

const GymAPI = (() => {
  const CONFIG_KEY = 'gym.config';
  const QUEUE_KEY = 'gym.queue';
  const DEMO_PLAN_KEY = 'gym.demoPlan';
  const FLUSH_INTERVAL_MS = 8000;

  let flushTimer = null;
  let flushing = false;
  let listeners = [];

  const getConfig = () => JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
  const setConfig = (url, pass) =>
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: url.trim(), pass }));
  const clearConfig = () => {
    localStorage.removeItem(CONFIG_KEY);
    localStorage.removeItem(QUEUE_KEY);
  };
  const isDemo = () => (getConfig() || {}).url === 'demo';

  const onQueueChange = (fn) => listeners.push(fn);
  const queue = () => JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  const saveQueue = (q) => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    listeners.forEach((fn) => fn(q.length, flushing));
  };

  async function call(body) {
    const cfg = getConfig();
    if (!cfg) throw new Error('not_configured');
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, pass: cfg.pass }),
    });
    if (!res.ok) throw new Error('http_' + res.status);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'unknown_error');
    return data;
  }

  async function fetchPlan() {
    if (isDemo()) {
      const saved = localStorage.getItem(DEMO_PLAN_KEY);
      return saved ? JSON.parse(saved) : window.GYM_DEMO_PLAN;
    }
    const data = await call({ action: 'plan' });
    return data.plan;
  }

  /* --- write queue ------------------------------------------------- */

  function enqueue(item) {
    if (isDemo()) {
      applyDemoWrite(item);
      listeners.forEach((fn) => fn(0, false));
      return;
    }
    const q = queue();
    // Collapse consecutive writes to the same cell: only the last value matters.
    const key = (i) => i.kind + ':' + i.session + ':' + i.week + ':' + (i.row || '') + ':' + (i.field || '');
    const filtered = q.filter((i) => key(i) !== key(item));
    filtered.push(item);
    saveQueue(filtered);
    flushSoon();
  }

  const saveCell = (session, week, row, field, value) =>
    enqueue({ kind: 'update', session, week, row, field, value: String(value) });

  /** Asks the script to append week columns until `week` exists; returns the fresh plan. */
  async function extendWeek(week) {
    if (isDemo()) return extendDemoWeek(week);
    await flush(); // don't let queued writes race the structure change
    const data = await call({ action: 'extendWeek', week });
    return data.plan;
  }

  const saveRest = (session, week, rest) => enqueue({ kind: 'rest', session, week, rest });

  async function flush() {
    if (flushing || isDemo()) return;
    const q = queue();
    if (q.length === 0) return;
    flushing = true;
    listeners.forEach((fn) => fn(q.length, true));
    try {
      const updates = q.filter((i) => i.kind === 'update');
      if (updates.length > 0) {
        await call({
          action: 'update',
          updates: updates.map((u) => ({
            session: u.session, week: u.week, row: u.row, field: u.field, value: u.value,
          })),
        });
      }
      for (const r of q.filter((i) => i.kind === 'rest')) {
        await call({ action: 'setRest', session: r.session, week: r.week, rest: r.rest });
      }
      saveQueue([]);
    } catch (err) {
      // Keep the queue; it will retry. Surface auth errors to the app.
      if (String(err.message) === 'unauthorized' && window.onGymAuthError) window.onGymAuthError();
    } finally {
      flushing = false;
      listeners.forEach((fn) => fn(queue().length, false));
    }
  }

  function flushSoon() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 400);
  }

  function startAutoFlush() {
    setInterval(flush, FLUSH_INTERVAL_MS);
    window.addEventListener('online', flush);
  }

  /* --- demo write handling ----------------------------------------- */

  function applyDemoWrite(item) {
    const plan = JSON.parse(localStorage.getItem(DEMO_PLAN_KEY) || 'null') ||
      JSON.parse(JSON.stringify(window.GYM_DEMO_PLAN));
    const session = plan.sessions.find((s) => s.id === item.session);
    if (!session) return;
    const wk = session.weeks[String(item.week)];
    if (!wk) return;
    if (item.kind === 'update') {
      const idx = session.exercises.findIndex((e) => e.row === item.row);
      if (idx >= 0) wk.entries[idx][item.field] = item.value;
    } else if (item.kind === 'rest') {
      Object.assign(wk.rest, item.rest);
    }
    localStorage.setItem(DEMO_PLAN_KEY, JSON.stringify(plan));
  }

  function extendDemoWeek(targetWeek) {
    const plan = JSON.parse(localStorage.getItem(DEMO_PLAN_KEY) || 'null') ||
      JSON.parse(JSON.stringify(window.GYM_DEMO_PLAN));
    while (plan.weekCount < targetWeek) {
      const newWeek = ++plan.weekCount;
      for (const session of plan.sessions) {
        const last = session.weeks[String(newWeek - 1)];
        if (!last) continue;
        const copy = JSON.parse(JSON.stringify(last));
        copy.entries.forEach((e) => { e.weight = ''; e.repResults = ''; });
        session.weeks[String(newWeek)] = copy;
      }
    }
    localStorage.setItem(DEMO_PLAN_KEY, JSON.stringify(plan));
    return plan;
  }

  return {
    getConfig, setConfig, clearConfig, isDemo,
    fetchPlan, saveCell, saveRest, extendWeek, flush, startAutoFlush,
    onQueueChange, pendingCount: () => queue().length,
  };
})();
