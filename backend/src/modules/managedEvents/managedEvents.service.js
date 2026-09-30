// Data access for the events a user owns or manages. Takes the client as a
// factory argument (contrast venues.service.js, which lazily requires the
// shared client) so these tests drive the real query chain against an
// in-memory fake with no credentials - see the header in
// equipment.service.test.js for why the fake applies .or/.eq rather than
// ignoring them.
const { EVENT_FIELDS, toListItem, toSummary } = require("./managedEvents.validation");

// Waitlist story not implemented yet; status not in the registrations check
// constraint, so count is 0 until it lands. Confirm the final status name with
// that story's owner.
const WAITLIST_STATUS = "waitlisted";

// Built from the verified session id, never from request input. Postgrest
// splices this string into SQL, so the id is asserted to be a UUID before it
// goes in.
function ownershipFilter(userId) {
  return `organiser_id.eq.${userId},coordinator_id.eq.${userId}`;
}

function createManagedEventsService(client) {
  function unwrap({ data, error }, action) {
    if (error) {
      throw new Error(`managedEvents.service: ${action} failed - ${error.message}`);
    }
    return data;
  }

  // Ownership is a WHERE clause, not a filter applied after fetching. An
  // unrelated event is therefore indistinguishable from one that does not
  // exist: both leave this query empty.
  function managedEvents(userId) {
    return client
      .from("events")
      .select(EVENT_FIELDS)
      .or(ownershipFilter(userId));
  }

  async function listManagedEvents(userId) {
    const rows = await unwrap(
      await managedEvents(userId).order("start_time", {
        ascending: true,
        nullsFirst: false,
      }),
      "listManagedEvents",
    );
    return rows.map(toListItem);
  }

  async function findManagedEvent(eventId, userId) {
    return unwrap(
      await managedEvents(userId).eq("id", eventId).maybeSingle(),
      "findManagedEvent",
    );
  }

  // head: true asks Postgres for the count and no rows at all, so the
  // attendee_id and registration_data behind it never leave the database.
  async function countWaitingList(eventId) {
    const { count, error } = await client
      .from("registrations")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("status", WAITLIST_STATUS);
    if (error) {
      throw new Error(`managedEvents.service: countWaitingList failed - ${error.message}`);
    }
    return count;
  }

  // Takes the event the resolver already loaded rather than fetching it again:
  // the row is on req.managedEvent by the time a request reaches here.
  async function getRegistrationSummary(event) {
    return toSummary(event, await countWaitingList(event.id));
  }

  return { listManagedEvents, findManagedEvent, getRegistrationSummary };
}

module.exports = { createManagedEventsService, WAITLIST_STATUS, ownershipFilter };
