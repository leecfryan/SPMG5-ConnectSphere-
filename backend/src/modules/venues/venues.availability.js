// SCRUM-17: builds the availability calendar.
// Pure functions only, no express and no supabase imports, so this file is
// unit-testable the moment a test runner is agreed (same reasoning as
// venues.validation.js).

// SCRUM-95: the three slots a day is divided into.
const SLOTS = ["am", "pm", "night"];

// Used to decide whether a slot falls inside the venue's operating hours from
// SCRUM-84 / SCRUM-89. Orchard closes at 18:00, so its night slot is always
// closed, which is the link back to the previous story.
const SLOT_WINDOWS = {
  am: { start: "08:00", end: "12:00" },
  pm: { start: "12:00", end: "18:00" },
  night: { start: "18:00", end: "23:00" },
};

// index order matches Date.getUTCDay()
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// keeps one request from asking for years of calendar in a single response
const MAX_RANGE_DAYS = 62;

// All date maths is done in UTC. Postgres `date` columns come back as plain
// "YYYY-MM-DD" strings with no timezone, and new Date("2026-09-16") parses as
// UTC midnight. Using local-time getters here would shift the day for anyone
// east of UTC, which is everyone on this team.
function toUtcDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function isValidDateString(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = toUtcDate(value);
  // rejects real-looking but impossible dates such as 2026-02-31
  return !Number.isNaN(parsed.getTime()) && toDateString(parsed) === value;
}

function addDays(dateString, days) {
  const date = toUtcDate(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

function daysBetween(from, to) {
  const ms = toUtcDate(to).getTime() - toUtcDate(from).getTime();
  return Math.round(ms / 86400000);
}

function eachDateInRange(from, to) {
  const dates = [];
  for (let offset = 0; offset <= daysBetween(from, to); offset += 1) {
    dates.push(addDays(from, offset));
  }
  return dates;
}

function dayKeyFor(dateString) {
  return DAY_KEYS[toUtcDate(dateString).getUTCDay()];
}

// "HH:MM" is zero padded, so plain string comparison orders times correctly.
function slotIsOpen(operatingHoursEntry, slot) {
  const entry = operatingHoursEntry;
  if (!entry || entry.closed === true) return false;
  if (!entry.open || !entry.close) return false;

  const window = SLOT_WINDOWS[slot];
  return entry.open < window.end && entry.close > window.start;
}

// Precedence, highest first:
//   closed      venue is not open for that slot at all (SCRUM-84 / SCRUM-89)
//   unavailable Venue Staff recorded the period as unavailable (SCRUM-93)
//   booked      a confirmed booking consumes the slot (SCRUM-94)
//   pending     a request exists but has not been confirmed, slot still free
//   available   nothing in the way
function buildAvailabilityCalendar(input) {
  const operatingHours =
    input.operatingHours && typeof input.operatingHours === "object"
      ? input.operatingHours
      : {};

  const confirmedBySlot = new Map();
  const pendingBySlot = new Map();
  for (const booking of input.bookings || []) {
    const key = `${booking.booking_date}|${booking.slot}`;
    if (booking.status === "confirmed") {
      confirmedBySlot.set(key, booking);
    } else if (booking.status === "pending" && !pendingBySlot.has(key)) {
      pendingBySlot.set(key, booking);
    }
  }

  const unavailableBySlot = new Map();
  for (const period of input.unavailability || []) {
    unavailableBySlot.set(`${period.unavailable_date}|${period.slot}`, period);
  }

  return eachDateInRange(input.from, input.to).map((date) => {
    const dayKey = dayKeyFor(date);
    const hoursForDay = operatingHours[dayKey];
    const slots = {};

    for (const slot of SLOTS) {
      const key = `${date}|${slot}`;

      if (!slotIsOpen(hoursForDay, slot)) {
        slots[slot] = { status: "closed", label: "Closed" };
        continue;
      }

      const unavailable = unavailableBySlot.get(key);
      if (unavailable) {
        slots[slot] = { status: "unavailable", label: unavailable.reason };
        continue;
      }

      const confirmed = confirmedBySlot.get(key);
      if (confirmed) {
        slots[slot] = { status: "booked", label: confirmed.event_name };
        continue;
      }

      const pending = pendingBySlot.get(key);
      if (pending) {
        slots[slot] = { status: "pending", label: pending.event_name };
        continue;
      }

      slots[slot] = { status: "available", label: "Available" };
    }

    return { date, day: dayKey, slots };
  });
}

module.exports = {
  SLOTS,
  SLOT_WINDOWS,
  MAX_RANGE_DAYS,
  isValidDateString,
  addDays,
  daysBetween,
  eachDateInRange,
  dayKeyFor,
  slotIsOpen,
  buildAvailabilityCalendar,
};
