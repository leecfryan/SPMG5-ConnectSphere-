export function formatWhen(value) {
  if (!value) return "Not set";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "Not set";
  return at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDay(value) {
  if (!value) return "—";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function formatRange(start, end) {
  if (!start && !end) return "Dates not set";
  return `${formatWhen(start)} – ${formatWhen(end)}`;
}

// SCRUM-170: the new start a postponed event's postponement gave, if any.
// Activity is newest first, so the first postponement entry is the one in force.
export function postponedToStart(event) {
  return event.activity?.find((entry) => entry.action === "EVENT_POSTPONED")?.new_start ?? null;
}

export function shortReference(id) {
  return typeof id === "string" && id.length >= 8 ? id.slice(0, 8).toUpperCase() : "—";
}
