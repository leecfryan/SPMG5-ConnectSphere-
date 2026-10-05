export function getRegistrationAvailability(event) {
  if (event.expected_attendance === null || event.expected_attendance === undefined) {
    return { remaining: null, isFull: false, unlimited: true, known: true };
  }

  const capacity = event.expected_attendance;
  const enrolled = event.enrolled_attendees ?? 0;
  if (!Number.isInteger(capacity) || capacity < 0 || !Number.isInteger(enrolled) || enrolled < 0) {
    return { remaining: null, isFull: false, unlimited: false, known: false };
  }

  const remaining = Math.max(0, capacity - enrolled);
  return { remaining, isFull: remaining === 0, unlimited: false, known: true };
}

export function registrationAvailabilityLabel(event) {
  const { remaining, isFull, unlimited, known } = getRegistrationAvailability(event);
  if (isFull) return "0 slots left · Full";
  if (unlimited) return "Slots left: Unlimited";
  if (!known) return "Availability unavailable";
  return `Slots left: ${remaining}`;
}
