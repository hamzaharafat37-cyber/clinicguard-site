// Unit tests for the on-device time parser (no AI involved).
const test = require('node:test');
const assert = require('node:assert');
const { parseWhen, formatWhen } = require('../when.js');

const NOW = new Date(2026, 10, 10, 13, 0); // Tue Nov 10 2026, 1:00 PM
const at = (d, h, m = 0) => { const x = new Date(NOW); x.setDate(x.getDate() + d); x.setHours(h, m, 0, 0); return x.getTime(); };

test('meeting with a pm time becomes an event today', () => {
  const r = parseWhen('meeting with Sarah 3pm', NOW);
  assert.equal(r.title, 'Meeting with Sarah'); assert.equal(r.dueAt, at(0, 15)); assert.equal(r.kind, 'event');
});
test('"at 3" means 3 PM', () => assert.equal(parseWhen('call mom at 3', NOW).dueAt, at(0, 15)));
test('minutes and am', () => assert.equal(parseWhen('dentist tomorrow at 9:30am', NOW).dueAt, at(1, 9, 30)));
test('24h time', () => assert.equal(parseWhen('standup 16:45', NOW).dueAt, at(0, 16, 45)));
test('weekday deadline without time is end of that day and a task', () => {
  const r = parseWhen('finish lab report by friday', NOW);
  assert.equal(r.title, 'Finish lab report'); assert.equal(r.dueAt, at(3, 23, 59)); assert.equal(r.kind, 'task'); assert.equal(r.dayOnly, true);
});
test('bare past time rolls to tomorrow', () => assert.equal(parseWhen('gym 9am', NOW).dueAt, at(1, 9)));
test('tonight defaults to 8 PM', () => assert.equal(parseWhen('read chapter 4 tonight', NOW).dueAt, at(0, 20)));
test('no time stays untimed', () => {
  const r = parseWhen('study for my calculus exam', NOW);
  assert.equal(r.dueAt, null); assert.equal(r.title, 'Study for my calculus exam'); assert.equal(r.kind, 'task');
});
test('numbers that are not times are kept', () => assert.equal(parseWhen('read chapter 3', NOW).title, 'Read chapter 3'));
test('next monday', () => assert.equal(parseWhen('interview next monday 10am', NOW).dueAt, at(6, 10)));
test('formatWhen labels', () => {
  assert.match(formatWhen(at(0, 15), NOW), /^Today 3:00/);
  assert.match(formatWhen(at(1, 9), NOW), /^Tomorrow 9:00/);
  assert.equal(formatWhen(at(3, 23, 59), NOW, true), 'Fri');
});
