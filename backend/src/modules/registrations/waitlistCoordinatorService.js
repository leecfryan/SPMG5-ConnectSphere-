const ERROR_DETAILS = {
  invalid_request: [400, "invalid_request", "The waitlist request is invalid."],
  invalid_reason: [400, "invalid_reason", "The promotion reason must be 500 characters or fewer."],
  event_not_found: [404, "event_not_found", "The event was not found."],
  entry_not_found: [404, "entry_not_found", "The waitlist entry was not found."],
  event_ineligible: [409, "event_ineligible", "This event cannot be changed because it is no longer active."],
  entry_not_active: [409, "entry_not_active", "This waitlist entry is no longer active."],
  already_offered: [409, "already_offered", "This attendee already has an open place offer."],
  details_required: [409, "details_required", "The attendee must update their registration details before promotion."],
  too_late: [409, "too_late", "There is not enough time before the event to make a place offer."],
  already_registered: [409, "already_registered", "This attendee is already registered for the event."],
  capacity_counter_overflow: [409, "capacity_counter_overflow", "The event registration count cannot be increased further."],
};

function outcomeError(outcome) {
  const details = ERROR_DETAILS[outcome] || [500, "waitlist_operation_failed", "The waitlist operation could not be completed."];
  const error = new Error(details[2]);
  error.status = details[0];
  error.code = details[1];
  return error;
}

function createWaitlistCoordinatorService(client) {
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(`waitlistCoordinatorService: ${name} failed - ${error.message}`);
    if (!data || typeof data !== "object") {
      throw new Error(`waitlistCoordinatorService: ${name} returned no result`);
    }
    return data;
  }

  async function displayNameFor(attendeeId) {
    const { data, error } = await client.auth.admin.getUserById(attendeeId);
    if (error) throw error;
    if (!data?.user) throw new Error(`waitlistCoordinatorService: unable to resolve attendee ${attendeeId}`);
    const name = data.user.user_metadata?.full_name;
    return typeof name === "string" && name.trim() ? name.trim() : "Attendee";
  }

  async function getCoordinatorWaitlist(event, { limit, offset }) {
    const result = await rpc("get_coordinator_event_waitlist", {
      p_event_id: event.id,
      p_limit: limit,
      p_offset: offset,
    });
    if (result.outcome !== "found") throw outcomeError(result.outcome);

    const entries = await Promise.all((result.entries || []).map(async (entry) => ({
      id: entry.id,
      attendeeId: entry.attendee_id,
      displayName: await displayNameFor(entry.attendee_id),
      position: entry.position,
      joinedAt: entry.joined_at,
      state: entry.state,
      effectiveDeadline: entry.effective_deadline,
      override: entry.override
        ? { by: entry.override.by, at: entry.override.at, reason: entry.override.reason }
        : null,
      eligible: entry.eligible,
    })));

    return {
      entries,
      total: result.total,
      queued: result.queued,
      offered: result.offered,
      autoOfferEnabled: result.auto_offer_enabled,
      serverTime: result.server_time,
      limit,
      offset,
    };
  }

  async function getAutoOffers(event) {
    const result = await rpc("get_event_waitlist_auto_offer_setting", { p_event_id: event.id });
    if (result.outcome !== "found") throw outcomeError(result.outcome);
    return { enabled: result.enabled };
  }

  async function setAutoOffers(event, enabled, actorId) {
    const result = await rpc("set_event_waitlist_auto_offers", {
      p_event_id: event.id,
      p_enabled: enabled,
      p_actor_id: actorId,
    });
    if (result.outcome !== "updated") throw outcomeError(result.outcome);
    return { enabled: result.enabled, updatedAt: result.updated_at };
  }

  async function promoteEntry(event, entryId, actorId, reason) {
    const result = await rpc("promote_waitlist_entry", {
      p_event_id: event.id,
      p_entry_id: entryId,
      p_actor_id: actorId,
      p_reason: reason,
    });
    if (!["offered", "registered_over_capacity", "already_promoted"].includes(result.outcome)) {
      throw outcomeError(result.outcome);
    }
    return {
      outcome: result.outcome,
      entryId: result.entry_id,
      registrationId: result.registration_id,
      enrolledAttendees: result.enrolled_attendees,
      expectedAttendance: result.expected_attendance,
      effectiveDeadline: result.effective_deadline,
      serverTime: result.server_time,
    };
  }

  return {
    getCoordinatorWaitlist,
    getAutoOffers,
    setAutoOffers,
    promoteEntry,
  };
}

module.exports = createWaitlistCoordinatorService;
module.exports.createWaitlistCoordinatorService = createWaitlistCoordinatorService;
