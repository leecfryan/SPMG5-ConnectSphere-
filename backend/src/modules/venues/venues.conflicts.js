// SCRUM-135: pure conflict detection for existing confirmed bookings
// after a venue's setup or turnaround time changes.
const { committedSlots } = require("./venues.availability");

const SLOT_ORDER = ["am", "pm", "night"];

// Returns Map<request_id, conflict[]> for confirmed bookings whose committed
// period (under the new setup/turnaround values) now extends into a slot
// occupied by another confirmed booking or a pending hold.
//
// confirmedRequests — [{ request_id, booking_date, slots: string[] }]
//   one entry per confirmed request (slots = all slots that request holds)
//
// allBookings — [{ request_id, booking_date, slot, status, event_name }]
//   every venue_bookings row (confirmed + pending) for the date window
function findBufferConflicts(confirmedRequests, allBookings, setupMinutes, turnaroundMinutes) {
  const byDateSlot = new Map();
  for (const b of allBookings) {
    const key = `${b.booking_date}|${b.slot}`;
    if (!byDateSlot.has(key)) byDateSlot.set(key, []);
    byDateSlot.get(key).push(b);
  }

  const result = new Map();

  for (const req of confirmedRequests) {
    const { request_id, booking_date, slots } = req;
    const committed = committedSlots(slots, setupMinutes, turnaroundMinutes);
    const bufferSlots = committed.filter((s) => !slots.includes(s));

    const conflicts = [];
    for (const bufferSlot of bufferSlots) {
      const bufferIdx = SLOT_ORDER.indexOf(bufferSlot);
      const minOwn = Math.min(...slots.map((s) => SLOT_ORDER.indexOf(s)));
      const type = bufferIdx < minOwn ? "setup" : "turnaround";

      // SCRUM-146: active holds block buffer slots in the same way confirmed
      // and pending bookings do. Hold rows carry request_id=null, so the
      // request_id !== request_id guard still excludes nothing it should keep.
      const occupiers = (byDateSlot.get(`${booking_date}|${bufferSlot}`) || []).filter(
        (b) =>
          b.request_id !== request_id &&
          (b.status === "confirmed" || b.status === "pending" || b.status === "hold")
      );

      // prefer a confirmed occupier over a pending one when both are present
      const occupier = occupiers.find((b) => b.status === "confirmed") || occupiers[0];
      if (!occupier) continue;

      conflicts.push({
        slot: bufferSlot,
        type,
        conflicting_with: occupier.event_name,
        reason: `${bufferSlot} is needed for ${type} time but is occupied by "${occupier.event_name}"`,
      });
    }

    if (conflicts.length > 0) result.set(request_id, conflicts);
  }

  return result;
}

module.exports = { findBufferConflicts };
