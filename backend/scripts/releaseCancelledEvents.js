// SCRUM-104: there is no cancellation endpoint in this story (events.status
// is set directly in Supabase), so nothing in the running app ever calls
// releaseReservationsForCancelledEvent on its own. This script is the only
// trigger: run it by event id after cancelling one event, or with --all to
// sweep every CANCELLED event for un-released APPROVED requests.
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env"), quiet: true });
const supabase = require("../src/supabase");
const { createEquipmentService } = require("../src/modules/equipment/equipment.service");

async function cancelledEventIds() {
  const { data, error } = await supabase.from("events").select("id").eq("status", "CANCELLED");
  if (error) throw error;
  return data.map((event) => event.id);
}

async function run() {
  const arg = process.argv[2];
  if (!arg) {
    throw new Error("Usage: node scripts/releaseCancelledEvents.js <eventId> | --all");
  }

  const equipmentService = createEquipmentService(supabase);
  const eventIds = arg === "--all" ? await cancelledEventIds() : [arg];
  if (eventIds.length === 0) {
    console.log("No cancelled events found.");
    return;
  }

  for (const eventId of eventIds) {
    const summary = await equipmentService.releaseReservationsForCancelledEvent(eventId);
    console.log(
      `${eventId}: released ${summary.released.length} request(s)` +
        `, reverted ${summary.equipmentReverted.length} unit(s) to AVAILABLE` +
        (summary.equipmentSkipped.length ? `, skipped ${summary.equipmentSkipped.length} unit(s) (still in use)` : ""),
    );
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
