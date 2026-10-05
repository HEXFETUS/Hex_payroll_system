import type { AttendanceStatus, TimeRecordType } from '@hexpayroll/shared';
export type Interval = [number, number];
export interface Punch {
  id: string;
  recordedAt: string;
  recordType: TimeRecordType;
  ambiguous?: boolean;
}
export interface Shift {
  start: number;
  end: number;
  break: Interval | null;
  graceMinutes: number;
}
export interface InterpretationInput {
  shift: Shift | null;
  isRestDay: boolean;
  punches: Punch[];
  leave: 'full_day' | 'first_half' | 'second_half' | 'both_halves' | null;
  now: number;
}
export interface Interpretation {
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  attendanceStatus: AttendanceStatus;
  flags: string[];
  complete: boolean;
  expectedMinutes: number;
  intervals: Interval[];
  processorVersion: number;
}
export function subtract(intervals: Interval[], cut: Interval): Interval[] {
  return intervals.flatMap(([a, b]) =>
    cut[1] <= a || cut[0] >= b
      ? [[a, b] as Interval]
      : [
          ...(cut[0] > a ? [[a, Math.min(b, cut[0])] as Interval] : []),
          ...(cut[1] < b ? [[Math.max(a, cut[1]), b] as Interval] : []),
        ],
  );
}
export function workingIntervals(shift: Shift): Interval[] {
  return shift.break
    ? subtract([[shift.start, shift.end]], shift.break)
    : [[shift.start, shift.end]];
}
function removeHalf(intervals: Interval[], first: boolean): Interval[] {
  const total = intervals.reduce((n, [a, b]) => n + b - a, 0),
    half = Math.floor(total / 60000 / 2) * 60000;
  let remaining = half;
  let boundary = intervals[0]?.[0] ?? 0;
  for (const [a, b] of intervals) {
    if (remaining <= b - a) {
      boundary = a + remaining;
      break;
    }
    remaining -= b - a;
  }
  return first
    ? intervals.flatMap(([a, b]) => (b <= boundary ? [] : [[Math.max(a, boundary), b] as Interval]))
    : intervals.flatMap(([a, b]) =>
        a >= boundary ? [] : [[a, Math.min(b, boundary)] as Interval],
      );
}
export function interpretAttendance(input: InterpretationInput): Interpretation {
  const { shift, punches, leave, now } = input;
  const flags: string[] = [];
  let expected: Interval[] = shift ? workingIntervals(shift) : [];
  if (leave === 'full_day' || leave === 'both_halves') expected = [];
  else if (leave === 'first_half') expected = removeHalf(expected, true);
  else if (leave === 'second_half') expected = removeHalf(expected, false);
  const complete = shift ? now >= shift.end + 7200000 : true;
  const pairs: Interval[] = [];
  let open: Punch | null = null;
  let onBreak = false;
  let breakStart: number | null = null;
  const breaks: Interval[] = [];
  const sorted = [...punches].sort(
    (a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt) || a.id.localeCompare(b.id),
  );
  let firstIn: string | null = null,
    lastOut: string | null = null;
  for (const p of sorted) {
    if (p.ambiguous) {
      flags.push('ambiguous_shift');
      continue;
    }
    const t = Date.parse(p.recordedAt);
    switch (p.recordType) {
      case 'unknown':
        flags.push('unknown_punch_type');
        break;
      case 'in':
        if (open || onBreak) flags.push('invalid_punch_sequence');
        else {
          open = p;
          firstIn ??= p.recordedAt;
        }
        break;
      case 'out':
        if (!open || onBreak) flags.push('missing_in_or_break_in');
        else {
          if (t <= Date.parse(open.recordedAt)) flags.push('invalid_punch_sequence');
          else pairs.push([Date.parse(open.recordedAt), t]);
          open = null;
          lastOut = p.recordedAt;
        }
        break;
      case 'break_out':
        if (!open || onBreak) flags.push('invalid_punch_sequence');
        else {
          onBreak = true;
          breakStart = t;
        }
        break;
      case 'break_in':
        if (!open || !onBreak || breakStart === null || t <= breakStart)
          flags.push('invalid_punch_sequence');
        else {
          breaks.push([breakStart, t]);
          onBreak = false;
          breakStart = null;
        }
        break;
    }
  }
  if (open) flags.push('missing_out');
  if (onBreak) flags.push('missing_break_in');
  if (!shift && !input.isRestDay) flags.push('missing_schedule');
  if (input.isRestDay && punches.length) flags.push('rest_day_punches');
  if ((leave === 'full_day' || leave === 'both_halves') && punches.length)
    flags.push('punches_during_full_day_leave');
  let intervals = pairs;
  for (const b of breaks) intervals = subtract(intervals, b);
  const worked = intervals.reduce(
    (n, [a, b]) =>
      n + expected.reduce((m, [x, y]) => m + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0),
    0,
  );
  const start = expected[0]?.[0],
    end = expected.at(-1)?.[1];
  const late =
    firstIn &&
    start !== undefined &&
    shift &&
    Date.parse(firstIn) > start + shift.graceMinutes * 60000
      ? Math.ceil((Date.parse(firstIn) - start) / 60000)
      : 0;
  const undertime =
    lastOut && end !== undefined ? Math.max(0, Math.ceil((end - Date.parse(lastOut)) / 60000)) : 0;
  let status: AttendanceStatus;
  if (flags.length) status = 'incomplete';
  else if (input.isRestDay) status = 'rest_day';
  else if (leave === 'full_day' || leave === 'both_halves') status = 'on_leave';
  else if (!punches.length) {
    status = complete ? 'absent' : 'incomplete';
    if (!complete) flags.push('shift_open');
  } else status = late > 0 ? 'late' : 'present';
  return {
    firstIn,
    lastOut,
    workedMinutes: Math.floor(worked / 60000),
    lateMinutes: late,
    undertimeMinutes: undertime,
    attendanceStatus: status,
    flags: [...new Set(flags)],
    complete,
    expectedMinutes: Math.floor(expected.reduce((n, [a, b]) => n + b - a, 0) / 60000),
    intervals,
    processorVersion: 1,
  };
}
