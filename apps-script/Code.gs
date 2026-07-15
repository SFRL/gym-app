/**
 * Gym Plan API — Google Apps Script web app.
 *
 * Serves the workout plan parsed from the trainer's sheet layout and writes
 * edits (weight, rep results, rest times) back into the same cells, so the
 * sheet stays shareable with the gym in its original format.
 *
 * Setup:
 *  1. Open the Google Sheet -> Extensions -> Apps Script, paste this file.
 *  2. Project Settings -> Script Properties -> add PASSPHRASE = <your secret>.
 *  3. Deploy -> New deployment -> Web app, execute as Me, access: Anyone.
 *
 * API (all requests must carry the passphrase):
 *  GET  ?action=plan&pass=...              -> {ok, plan}
 *  POST {pass, action:"update", updates:[{session, week, row, field, value}]}
 *       field: "sets" | "weight" | "repGoal" | "repResults"
 *  POST {pass, action:"setRest", session, week, rest:{sets?, exercises?, rounds?}}
 * POST bodies are sent as text/plain to avoid CORS preflight.
 */

var FIELD_OFFSETS = { sets: 0, weight: 1, repGoal: 2, repResults: 3 };

function doGet(e) {
  return handleRequest(e.parameter || {});
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ ok: false, error: 'bad_json' });
  }
  return handleRequest(body);
}

function handleRequest(req) {
  var secret = PropertiesService.getScriptProperties().getProperty('PASSPHRASE');
  if (!secret || req.pass !== secret) {
    return jsonResponse({ ok: false, error: 'unauthorized' });
  }
  try {
    switch (req.action) {
      case 'plan':
        return jsonResponse({ ok: true, plan: readPlan() });
      case 'update':
        return jsonResponse(applyUpdates(req.updates || []));
      case 'setRest':
        return jsonResponse(applyRest(req));
      default:
        return jsonResponse({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: 'server_error', detail: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/** Finds the first sheet that contains "Week N: Session M" headers. */
function findPlanSheet() {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var values = sheets[i].getDataRange().getDisplayValues();
    var plan = parsePlan(values);
    if (plan.sessions.length > 0) return { sheet: sheets[i], plan: plan };
  }
  throw new Error('No sheet with "Week N: Session M" headers found');
}

function readPlan() {
  return findPlanSheet().plan;
}

function applyUpdates(updates) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var found = findPlanSheet();
    var applied = 0;
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i];
      var offset = FIELD_OFFSETS[u.field];
      var session = sessionById(found.plan, u.session);
      if (offset === undefined || !session) continue;
      var weekBlock = session.weeks[String(u.week)];
      if (!weekBlock) continue;
      var isPlanRow = session.exercises.some(function (ex) { return ex.row === u.row; });
      if (!isPlanRow) continue;
      found.sheet.getRange(u.row, weekBlock.col + offset).setValue(String(u.value));
      applied++;
    }
    return { ok: true, applied: applied };
  } finally {
    lock.releaseLock();
  }
}

/** Rewrites the rest portion of a session-week header, keeping the trainer's format. */
function applyRest(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var found = findPlanSheet();
    var session = sessionById(found.plan, req.session);
    if (!session) return { ok: false, error: 'unknown_session' };
    var weekBlock = session.weeks[String(req.week)];
    if (!weekBlock) return { ok: false, error: 'unknown_week' };

    var rest = req.rest || {};
    var newText;
    if (session.type === 'circuit') {
      var ex = rest.exercises != null ? rest.exercises : (weekBlock.rest.exercises || 0);
      var rounds = rest.rounds != null ? rest.rounds : (weekBlock.rest.rounds || 0);
      newText = '(rest ' + formatDuration(ex) + ', ' + formatDuration(rounds) + ')';
    } else {
      var sets = rest.sets != null ? rest.sets : (weekBlock.rest.sets || 0);
      newText = '(' + formatDuration(sets) + ' rest)';
    }

    var cell = found.sheet.getRange(weekBlock.headerRow, weekBlock.col);
    var text = String(cell.getValue());
    var updated = /\(([^)]*)\)/.test(text)
      ? text.replace(/\(([^)]*)\)/, newText)
      : text + ' ' + newText;
    cell.setValue(updated);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function formatDuration(seconds) {
  if (seconds >= 60 && seconds % 30 === 0) {
    var mins = seconds / 60;
    return mins + (mins === 1 ? ' min' : ' mins');
  }
  return seconds + ' secs';
}

function sessionById(plan, id) {
  for (var i = 0; i < plan.sessions.length; i++) {
    if (plan.sessions[i].id === Number(id)) return plan.sessions[i];
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Parsing — pure functions over a 2D array of display values, so the */
/* same code is unit-testable in Node against a dump of the sheet.    */
/* ------------------------------------------------------------------ */

var HEADER_RE = /week\s*(\d+)\s*:?\s*session\s*(\d+)/i;

/**
 * Parses the trainer layout into a normalized plan. Week blocks are
 * discovered from the header cells, so any number of weeks works, and
 * exercise rows are read until the block ends (no hardcoded positions).
 * All cell values are passed through as strings.
 */
function parsePlan(values) {
  var sessions = {};
  var weekCount = 0;

  for (var r = 0; r < values.length; r++) {
    var headerCols = [];
    for (var c = 0; c < values[r].length; c++) {
      var m = HEADER_RE.exec(String(values[r][c] || ''));
      if (m) headerCols.push({ col: c, week: Number(m[1]), session: Number(m[2]), text: String(values[r][c]) });
    }
    if (headerCols.length === 0) continue;

    var sessionId = headerCols[0].session;
    var block = readSessionBlock(values, r);
    if (!block) continue;

    var session = sessions[sessionId] || (sessions[sessionId] = {
      id: sessionId,
      title: 'Session ' + sessionId,
      label: block.label,
      type: block.type,
      rounds: block.rounds,
      exercises: block.exercises,
      weeks: {}
    });

    for (var h = 0; h < headerCols.length; h++) {
      var hc = headerCols[h];
      if (hc.week > weekCount) weekCount = hc.week;
      var rest = parseRest(hc.text, block.type);
      session.weeks[String(hc.week)] = {
        headerRow: r + 1,          // 1-based sheet coordinates
        col: hc.col + 1,
        restRaw: rest.raw,
        rest: rest,
        entries: block.exercises.map(function (ex) {
          var row = values[ex.row - 1];
          return {
            sets: cellString(row, hc.col + 0),
            weight: cellString(row, hc.col + 1),
            repGoal: cellString(row, hc.col + 2),
            repResults: cellString(row, hc.col + 3)
          };
        })
      };
    }
  }

  var list = Object.keys(sessions)
    .map(function (k) { return sessions[k]; })
    .sort(function (a, b) { return a.id - b.id; });
  return { weekCount: weekCount, sessions: list };
}

function cellString(row, col) {
  var v = row && row[col] != null ? row[col] : '';
  return String(v).trim();
}

/** Reads the field-header row + exercise rows that follow a session header row. */
function readSessionBlock(values, headerRowIdx) {
  // The field-header row is the next row whose column B says "Exercise".
  var fieldRow = -1;
  for (var r = headerRowIdx + 1; r < Math.min(headerRowIdx + 4, values.length); r++) {
    if (/^exercise$/i.test(cellString(values[r], 1))) { fieldRow = r; break; }
  }
  if (fieldRow === -1) return null;

  var label = cellString(values[fieldRow], 0);
  var type = /circuit/i.test(label) ? 'circuit' : 'straight';
  var roundsMatch = /x\s*(\d+)/i.exec(label);
  var rounds = type === 'circuit' ? (roundsMatch ? Number(roundsMatch[1]) : 3) : null;

  var exercises = [];
  for (var r2 = fieldRow + 1; r2 < values.length; r2++) {
    var name = cellString(values[r2], 1);
    if (!name || HEADER_RE.test(name)) break;
    // Stop if this row is itself a new week/session header row.
    var isHeaderRow = values[r2].some(function (v) { return HEADER_RE.test(String(v || '')); });
    if (isHeaderRow) break;
    var group = cellString(values[r2], 0);
    exercises.push({
      row: r2 + 1,               // 1-based sheet row
      name: name,
      group: group,
      superset: /superset|\b\d+[ab]\b/i.test(group)
    });
  }
  if (exercises.length === 0) return null;

  return { label: label, type: type, rounds: rounds, exercises: exercises };
}

var DURATION_RE = /(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*(secs?|s\b|mins?|m\b)/gi;

/**
 * Parses the parenthetical rest text of a session header.
 * Straight sessions have one duration ("60 secs rest") -> {sets}.
 * Circuits have two ("rest 15 secs, 2 mins") -> {exercises, rounds}.
 * Ranges like "5-10 secs" use the upper bound.
 */
function parseRest(headerText, type) {
  var m = /\(([^)]*)\)/.exec(headerText);
  var raw = m ? m[1].trim() : '';
  var durations = [];
  if (raw) {
    var d;
    DURATION_RE.lastIndex = 0;
    while ((d = DURATION_RE.exec(raw)) !== null) {
      var value = Number(d[2] != null ? d[2] : d[1]);
      if (/^m/i.test(d[3])) value *= 60;
      durations.push(Math.round(value));
    }
  }
  var rest = { raw: raw, sets: null, exercises: null, rounds: null };
  if (type === 'circuit') {
    rest.exercises = durations[0] != null ? durations[0] : 60;
    rest.rounds = durations[1] != null ? durations[1] : 120;
  } else {
    rest.sets = durations[0] != null ? durations[0] : 60;
  }
  return rest;
}

/* Test hook (ignored by Apps Script, used by the Node unit tests). */
if (typeof module !== 'undefined') {
  module.exports = { parsePlan: parsePlan, parseRest: parseRest, readSessionBlock: readSessionBlock };
}
