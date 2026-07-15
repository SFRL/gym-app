/* Synthetic demo plan (same shape the Apps Script returns) so the app can be
   tried locally without a Google Sheet. Enable by using "demo" as the API URL
   on the login screen. Deliberately NOT the real plan — the repo is public. */
window.GYM_DEMO_PLAN = (() => {
  const straight = [
    { name: 'Goblet squat', group: 'Legs', goal: '10-12' },
    { name: 'Bench press', group: 'Chest', goal: '8-10' },
    { name: 'Plank hold', group: 'Core', goal: '45 secs' },
    { name: 'Pull ups', group: 'Back', goal: 'MAX' },
  ];
  const circuit = [
    { name: 'Kettlebell swing', group: 'Full body', goal: '15-20' },
    { name: 'Push ups', group: 'Chest', goal: 'MAX' },
    { name: 'Mountain climbers', group: 'Core', goal: '30 secs' },
  ];
  const weeks = (exs, type) => {
    const out = {};
    for (let w = 1; w <= 3; w++) {
      out[String(w)] = {
        headerRow: 1,
        col: 1,
        restRaw: type === 'circuit' ? 'rest 15 secs, 2 mins' : '60 secs rest',
        rest:
          type === 'circuit'
            ? { raw: 'rest 15 secs, 2 mins', sets: null, exercises: 15, rounds: 120 }
            : { raw: '60 secs rest', sets: 60, exercises: null, rounds: null },
        entries: exs.map((e) => ({
          sets: type === 'circuit' ? '' : '3',
          weight: '',
          repGoal: e.goal,
          repResults: '',
        })),
      };
    }
    return out;
  };
  const mk = (id, type, label, exs, rounds) => ({
    id,
    title: 'Session ' + id,
    label,
    type,
    rounds,
    exercises: exs.map((e, i) => ({ row: 100 * id + i, name: e.name, group: e.group, superset: false })),
    weeks: weeks(exs, type),
  });
  return {
    weekCount: 3,
    sessions: [
      mk(1, 'straight', 'Straight sets', straight, null),
      mk(2, 'circuit', 'Circuit x 3 rounds', circuit, 3),
    ],
  };
})();
