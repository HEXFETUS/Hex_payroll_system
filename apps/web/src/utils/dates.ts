export function dateInTimezone(timezone: string, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return part('year') + '-' + part('month') + '-' + part('day');
}
export function formatTime(value: string | null, timezone: string | null) {
  return value && timezone
    ? new Intl.DateTimeFormat('en-PH', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(value))
    : '?';
}
export const minutesLabel = (minutes: number) =>
  Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
