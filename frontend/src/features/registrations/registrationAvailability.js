export function getRegistrationAvailability(event) {
  const remaining = event.slots_remaining;
  const queueCount = event.waitlist_queue_count;
  const reservedCount = event.waitlist_reserved;
  if (
    (remaining !== null && (!Number.isInteger(remaining) || remaining < 0)) ||
    !Number.isInteger(queueCount) || queueCount < 0 ||
    !Number.isInteger(reservedCount) || reservedCount < 0
  ) {
    return { remaining: null, isFull: false, unlimited: false, known: false };
  }

  const queueOwnsSeat = queueCount > 0 || reservedCount > 0;
  return {
    remaining,
    isFull: remaining === 0,
    unlimited: remaining === null,
    queueOwnsSeat,
    known: true,
  };
}

export function registrationAvailabilityLabel(event) {
  const { remaining, isFull, unlimited, queueOwnsSeat, known } = getRegistrationAvailability(event);
  if (queueOwnsSeat && isFull) return "Waitlist priority · 0 slots left";
  if (isFull) return "0 slots left · Full";
  if (unlimited) return "Slots left: Unlimited";
  if (!known) return "Availability unavailable";
  return `Slots left: ${remaining}`;
}
