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

export function shortReference(id) {
  return typeof id === "string" && id.length >= 8 ? id.slice(0, 8).toUpperCase() : "—";
}
