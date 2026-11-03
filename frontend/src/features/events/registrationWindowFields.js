export function toLocalDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function registrationWindowValidationError(start, end) {
  if (!start || !end) return "";
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) return "";
  return endTime <= startTime ? "must be after registration start" : "";
}

export function registrationEndsAfterEventStarts(registrationEnd, eventStart) {
  if (!registrationEnd || !eventStart) return false;
  const end = new Date(registrationEnd).getTime();
  const start = new Date(eventStart).getTime();
  return !Number.isNaN(end) && !Number.isNaN(start) && end > start;
}
