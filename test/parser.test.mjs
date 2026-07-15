// Unit tests for the Apps Script parser, run against a JSON dump of the
// real trainer spreadsheet: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../apps-script/Code.gs'), 'utf8');
const mod = { exports: {} };
new Function('module', source)(mod);
const { parsePlan, parseRest } = mod.exports;

const values = JSON.parse(readFileSync(join(here, 'fixtures/sheet_values.json'), 'utf8'));
const plan = parsePlan(values);

test('finds 3 sessions and 6 weeks', () => {
  assert.equal(plan.sessions.length, 3);
  assert.deepEqual(plan.sessions.map((s) => s.id), [1, 2, 3]);
  assert.equal(plan.weekCount, 6);
});

test('session 1 is straight sets with 7 exercises', () => {
  const s1 = plan.sessions[0];
  assert.equal(s1.type, 'straight');
  assert.equal(s1.rounds, null);
  assert.equal(s1.exercises.length, 7);
  assert.equal(s1.exercises[0].name, 'Pistol squat (to box) (per side)');
  assert.equal(s1.exercises[0].group, 'Lower quad focus');
  assert.equal(s1.exercises[6].name.trim(), 'Deadhang');
});

test('session 2 is a circuit of 3 rounds with 7 exercises', () => {
  const s2 = plan.sessions[1];
  assert.equal(s2.type, 'circuit');
  assert.equal(s2.rounds, 3);
  assert.equal(s2.exercises.length, 7);
  assert.equal(s2.exercises[0].name, 'Single leg RDL (each side)');
});

test('session 3 has superset pair flagged', () => {
  const s3 = plan.sessions[2];
  assert.equal(s3.exercises.length, 7);
  const supersets = s3.exercises.filter((e) => e.superset);
  assert.equal(supersets.length, 2);
  assert.deepEqual(supersets.map((e) => e.name), ['Cable twists', 'Pallof press']);
});

test('every session has all 6 week blocks', () => {
  for (const s of plan.sessions) {
    assert.deepEqual(Object.keys(s.weeks).sort(), ['1', '2', '3', '4', '5', '6'], s.title);
    for (const wk of Object.values(s.weeks)) {
      assert.equal(wk.entries.length, s.exercises.length);
    }
  }
});

test('rest times parsed from headers', () => {
  const s1 = plan.sessions[0];
  assert.equal(s1.weeks['1'].rest.sets, 60);
  assert.equal(s1.weeks['3'].rest.sets, 50);
  assert.equal(s1.weeks['6'].rest.sets, 45);

  const s2 = plan.sessions[1];
  assert.equal(s2.weeks['1'].rest.exercises, 15);
  assert.equal(s2.weeks['1'].rest.rounds, 120);
  assert.equal(s2.weeks['3'].rest.exercises, 10);
  assert.equal(s2.weeks['3'].rest.rounds, 90);
  // "rest 5-10 secs, 1.5 mins" -> upper bound of the range
  assert.equal(s2.weeks['4'].rest.exercises, 10);
  // "rest 0-5 secs, 70 secs"
  assert.equal(s2.weeks['6'].rest.exercises, 5);
  assert.equal(s2.weeks['6'].rest.rounds, 70);
});

test('rep goals pass through as raw strings', () => {
  const s1 = plan.sessions[0];
  assert.equal(s1.weeks['1'].entries[0].repGoal, '10-12');
  assert.equal(s1.weeks['1'].entries[3].repGoal, '45 secs');
  assert.equal(s1.weeks['1'].entries[4].repGoal, 'MAX');
  assert.equal(s1.weeks['1'].entries[0].sets, '3');
  assert.equal(s1.weeks['1'].entries[0].weight, '');
});

test('week block columns map to the sheet layout (C + 4*(w-1))', () => {
  const s1 = plan.sessions[0];
  assert.equal(s1.weeks['1'].col, 3); // column C, 1-based
  assert.equal(s1.weeks['2'].col, 7); // column G
  assert.equal(s1.weeks['6'].col, 23); // column W
  assert.equal(s1.exercises[0].row, 7); // Pistol squat on sheet row 7
});

test('a Week 7 block added to the sheet is picked up automatically', () => {
  const extended = values.map((row) => row.slice());
  const s1HeaderRow = plan.sessions[0].weeks['1'].headerRow - 1;
  const newCol = plan.sessions[0].weeks['6'].col - 1 + 4;
  extended[s1HeaderRow][newCol] = 'Week 7: Session 1 (40 secs rest)';
  const p2 = parsePlan(extended);
  assert.equal(p2.weekCount, 7);
  assert.equal(p2.sessions[0].weeks['7'].rest.sets, 40);
});

test('parseRest handles decimal minutes and ranges', () => {
  assert.equal(parseRest('X (rest 10 secs, 1.5mins)', 'circuit').rounds, 90);
  assert.equal(parseRest('X (45 secs rest)', 'straight').sets, 45);
  assert.equal(parseRest('X (rest 5-10 secs, 2 mins)', 'circuit').exercises, 10);
});
