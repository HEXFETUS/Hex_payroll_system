import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleDaySchema, leaveInputSchema } from '@hexpayroll/shared';
import {
  interpretAttendance,
  type Punch,
  type InterpretationInput,
} from '../src/timekeeping/processor.js';
const instant = (clock: string) => Date.parse('2026-10-02T' + clock + ':00+08:00');
const shift = {
  start: instant('08:00'),
  end: instant('17:00'),
  break: [instant('12:00'), instant('13:00')] as [number, number],
  graceMinutes: 5,
};
const punch = (type: Punch['recordType'], clock: string, id = clock): Punch => ({
  id,
  recordType: type,
  recordedAt: new Date(instant(clock)).toISOString(),
});
const run = (punches: Punch[], overrides: Partial<InterpretationInput> = {}) =>
  interpretAttendance({
    shift,
    isRestDay: false,
    leave: null,
    now: instant('20:00'),
    punches,
    ...overrides,
  });
test('two punches count scheduled minutes, excluding break and outside-shift time', () => {
  const r = run([punch('in', '07:56'), punch('out', '17:04')]);
  assert.equal(r.workedMinutes, 480);
  assert.equal(r.attendanceStatus, 'present');
  assert.equal(r.lateMinutes, 0);
  assert.equal(r.undertimeMinutes, 0);
});
test('grace is a threshold; lateness beyond it starts at scheduled start', () => {
  assert.equal(run([punch('in', '08:05'), punch('out', '17:00')]).lateMinutes, 0);
  const r = run([punch('in', '08:12'), punch('out', '17:00')]);
  assert.equal(r.lateMinutes, 12);
  assert.equal(r.attendanceStatus, 'late');
});
test('seconds round worked down and late/undertime up', () => {
  const a = punch('in', '08:12'),
    b = punch('out', '16:25');
  a.recordedAt = new Date(instant('08:12') + 17000).toISOString();
  b.recordedAt = new Date(instant('16:25') - 1000).toISOString();
  const r = run([a, b]);
  assert.equal(r.workedMinutes, 432);
  assert.equal(r.lateMinutes, 13);
  assert.equal(r.undertimeMinutes, 36);
});
test('explicit breaks and scheduled break are deducted as a union', () => {
  const r = run([
    punch('in', '08:00'),
    punch('break_out', '12:02'),
    punch('break_in', '12:58'),
    punch('out', '17:00'),
  ]);
  assert.equal(r.workedMinutes, 480);
  assert.equal(r.attendanceStatus, 'present');
  const extended = run([
    punch('in', '08:00'),
    punch('out', '11:50'),
    punch('in', '13:10'),
    punch('out', '17:00'),
  ]);
  assert.equal(extended.workedMinutes, 460);
});
test('missing and invalid punches remain incomplete', () => {
  for (const punches of [
    [punch('in', '08:00')],
    [punch('out', '17:00')],
    [punch('in', '08:00'), punch('in', '09:00'), punch('out', '17:00')],
    [punch('unknown', '08:00')],
  ])
    assert.equal(run(punches).attendanceStatus, 'incomplete');
});
test('absence waits for shift window closure', () => {
  assert.equal(run([], { now: instant('18:00') }).attendanceStatus, 'incomplete');
  assert.equal(run([]).attendanceStatus, 'absent');
});
test('rest days and missing schedules are distinct', () => {
  assert.equal(run([], { shift: null, isRestDay: true }).attendanceStatus, 'rest_day');
  assert.equal(run([], { shift: null }).attendanceStatus, 'incomplete');
  assert.ok(
    run([punch('in', '08:00')], { shift: null, isRestDay: true }).flags.includes(
      'rest_day_punches',
    ),
  );
});
test('full leave and complementary half leave cover the shift', () => {
  assert.equal(run([], { leave: 'full_day' }).attendanceStatus, 'on_leave');
  assert.equal(run([], { leave: 'both_halves' }).attendanceStatus, 'on_leave');
  assert.equal(run([]).attendanceStatus, 'absent');
  const first = run([punch('in', '13:00'), punch('out', '17:00')], { leave: 'first_half' });
  assert.equal(first.workedMinutes, 240);
  assert.equal(first.lateMinutes, 0);
  const second = run([punch('in', '08:00'), punch('out', '12:00')], { leave: 'second_half' });
  assert.equal(second.workedMinutes, 240);
  assert.equal(second.undertimeMinutes, 0);
});
test('overnight shifts use absolute boundaries and unknown/ambiguous punches require review', () => {
  const overnight = {
    start: instant('22:00'),
    end: instant('06:00') + 86400000,
    break: null,
    graceMinutes: 0,
  };
  const r = run(
    [
      { id: 'a', recordType: 'in', recordedAt: new Date(overnight.start).toISOString() },
      { id: 'b', recordType: 'out', recordedAt: new Date(overnight.end).toISOString() },
    ],
    { shift: overnight, now: overnight.end + 7200000 },
  );
  assert.equal(r.workedMinutes, 480);
  assert.equal(r.attendanceStatus, 'present');
  assert.ok(run([{ ...punch('in', '08:00'), ambiguous: true }]).flags.includes('ambiguous_shift'));
});
test('odd-minute halves give the extra minute to the second half', () => {
  const odd = { ...shift, end: shift.end + 60000 };
  assert.equal(run([], { shift: odd, leave: 'first_half' }).expectedMinutes, 241);
  assert.equal(run([], { shift: odd, leave: 'second_half' }).expectedMinutes, 240);
});
test('schedule contracts permit overnight breaks and reject invalid bounds', () => {
  const d = {
    dayOfWeek: 1,
    isWorkDay: true,
    startTime: '22:00',
    endTime: '06:00',
    endDayOffset: 1,
    breakStart: '02:00',
    breakEnd: '03:00',
    breakStartDayOffset: 1,
    breakEndDayOffset: 1,
    graceMinutes: 0,
  };
  assert.equal(scheduleDaySchema.safeParse(d).success, true);
  assert.equal(scheduleDaySchema.safeParse({ ...d, breakStartDayOffset: 0 }).success, false);
  assert.equal(scheduleDaySchema.safeParse({ ...d, endDayOffset: 0 }).success, false);
});
test('half-day leave requires a single valid calendar date', () => {
  const base = {
    employeeId: '00000000-0000-4000-8000-000000000001',
    leaveTypeId: '00000000-0000-4000-8000-000000000002',
    startDate: '2026-10-02',
    endDate: '2026-10-03',
    durationType: 'first_half',
    reason: 'Appointment',
  };
  assert.equal(leaveInputSchema.safeParse(base).success, false);
  assert.equal(leaveInputSchema.safeParse({ ...base, endDate: '2026-10-02' }).success, true);
});
