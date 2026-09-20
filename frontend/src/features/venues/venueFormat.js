// Date and time formatting shared by the venue pages, so the calendar, request
// form and review list always print dates the same way.

// Singapore and Kuala Lumpur are both UTC+8. Same zone the backend uses in
// venues.bookingRequests.validation.js to decide which day an event falls on.
export const VENUE_TIME_ZONE = "Asia/Singapore";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "2026-09-23" -> "23 Sep", "Wed 23 Sep 2026" with options.
// Read straight from the string, so there is no timezone to shift the day and
// no browser locale turning Sep into "Sept".
export function formatDate(dateString, { weekday = false, year = false } = {}) {
  const [y, m, d] = dateString.split("-").map(Number);
  let text = `${d} ${MONTHS[m - 1]}`;
  if (year) text += ` ${y}`;
  if (weekday) {
    text = `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${text}`;
  }
  return text;
}

// The "YYYY-MM-DD" day an instant falls on at the venue.
// en-CA is used only because it formats dates in that order.
export function localDate(instant) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: VENUE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

// Timestamp -> "23 Sep 2026, 9:00 am" in venue time
export function formatDateTime(instant) {
  const time = new Date(instant)
    .toLocaleTimeString("en-SG", {
      timeZone: VENUE_TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
    })
    .toLowerCase();
  return `${formatDate(localDate(instant), { year: true })}, ${time}`;
}
