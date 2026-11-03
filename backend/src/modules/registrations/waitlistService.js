function createWaitlistService(client) {
  async function listMyEntries(attendeeId) {
    const { data: activeEntries, error: entriesError } = await client
      .from("event_waitlist_entries")
      .select("event_id")
      .eq("attendee_id", attendeeId)
      .eq("status", "active");
    if (entriesError) return { ok: false, error: entriesError };

    const eventIds = [...new Set((activeEntries ?? []).map((entry) => entry.event_id))];
    for (const eventId of eventIds) {
      const { error } = await client.rpc("reconcile_event_waitlist", {
        p_event_id: eventId,
      });
      if (error) return { ok: false, error };
    }

    const { data: entries, error } = await client
      .from("event_waitlist_entries")
      .select("id, event_id, status, offer_state, registration_data, offer_expires_at, created_at, events(name, start_time, registration_fields)")
      .eq("attendee_id", attendeeId)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (error) return { ok: false, error };

    const serverTime = new Date().toISOString();
    if ((entries ?? []).some((entry) =>
      !entry.events?.name ||
      (entry.offer_state === "offered" &&
        (!Number.isFinite(Date.parse(entry.offer_expires_at)) ||
          !Number.isFinite(Date.parse(entry.events.start_time)))
      )
    )) {
      return { ok: false, error: new Error("An active waitlist entry has incomplete event or deadline data.") };
    }
    const resultEntries = (entries ?? []).map((entry) => {
      const event = {
        name: entry.events.name,
        start_time: entry.events.start_time,
      };
      if (entry.offer_state !== "offered") {
        return {
          id: entry.id,
          event_id: entry.event_id,
          status: "waitlist",
          event,
          created_at: entry.created_at,
        };
      }
      const offerDeadline = Date.parse(entry.offer_expires_at);
      const eventStart = Date.parse(entry.events.start_time);
      return {
        id: entry.id,
        event_id: entry.event_id,
        status: "offered",
        registration_data: entry.registration_data,
        event: { ...event, registration_fields: entry.events.registration_fields ?? [] },
        effective_deadline: new Date(Math.min(offerDeadline, eventStart)).toISOString(),
        server_time: serverTime,
      };
    });

    for (const entry of resultEntries) {
      if (entry.status !== "waitlist") continue;
      const { data, error } = await client.rpc("get_my_waitlist_state", {
        p_event_id: entry.event_id,
        p_attendee_id: attendeeId,
      });
      if (error) return { ok: false, error };
      if (data?.outcome !== "found" || !Number.isInteger(data.position) || data.position < 1) {
        return {
          ok: false,
          error: new Error(`Unable to calculate waitlist position for event ${entry.event_id}.`),
        };
      }
      entry.position = data.position;
    }

    return {
      ok: true,
      serverTime,
      entries: resultEntries,
    };
  }

  async function listMyOffers(attendeeId) {
    const result = await listMyEntries(attendeeId);
    if (!result.ok) return result;
    return {
      ok: true,
      serverTime: result.serverTime,
      offers: result.entries.filter((entry) => entry.status === "offered"),
    };
  }

  async function join(eventId, attendeeId, registrationData) {
    const { data, error } = await client.rpc("enqueue_waitlist_if_full_v2", {
      p_event_id: eventId,
      p_attendee_id: attendeeId,
      p_registration_data: registrationData ?? null,
    });
    if (error) return { ok: false, reason: "storage_error", error };
    if (data?.outcome !== "joined") {
      return { ok: false, reason: data?.outcome ?? "invalid_request" };
    }
    return {
      ok: true,
      entry: data.entry,
      position: data.position,
      serverTime: data.server_time,
    };
  }

  async function getPosition(eventId, attendeeId) {
    const { data, error } = await client.rpc("get_my_waitlist_state", {
      p_event_id: eventId,
      p_attendee_id: attendeeId,
    });
    if (error) return { ok: false, reason: "storage_error", error };
    if (data?.outcome !== "found") {
      return { ok: false, reason: data?.outcome ?? "not_found" };
    }
    return {
      ok: true,
      entry: data.entry,
      position: data.position,
      effectiveDeadline: data.effective_deadline,
      serverTime: data.server_time,
    };
  }

  async function withdraw(eventId, attendeeId) {
    const { data: entry, error } = await client
      .from("event_waitlist_entries")
      .delete()
      .eq("event_id", eventId)
      .eq("attendee_id", attendeeId)
      .eq("status", "active")
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, reason: "storage_error", error };
    if (!entry) return { ok: false, reason: "not_found" };

    const { error: reconcileError } = await client.rpc("reconcile_event_waitlist", {
      p_event_id: eventId,
    });
    if (reconcileError) {
      return { ok: false, reason: "storage_error", error: reconcileError };
    }
    return { ok: true };
  }

  async function updateRegistrationData(eventId, attendeeId, registrationData) {
    const { data, error } = await client.rpc("update_waitlist_registration_data", {
      p_event_id: eventId,
      p_attendee_id: attendeeId,
      p_registration_data: registrationData ?? null,
    });
    if (error) return { ok: false, reason: "storage_error", error };
    if (data?.outcome !== "updated") {
      return { ok: false, reason: data?.outcome ?? "invalid_request" };
    }
    return {
      ok: true,
      entry: data.entry,
      effectiveDeadline: data.effective_deadline,
      serverTime: data.server_time,
    };
  }

  async function acceptOffer(eventId, attendeeId) {
    const { data, error } = await client.rpc("accept_waitlist_offer", {
      p_event_id: eventId,
      p_attendee_id: attendeeId,
    });
    if (error) return { ok: false, reason: "storage_error", error };
    if (data?.outcome !== "accepted") {
      return { ok: false, reason: data?.outcome ?? "invalid_request", ...data };
    }
    return { ok: true, ...data };
  }

  async function declineOffer(eventId, attendeeId) {
    const { data, error } = await client.rpc("decline_waitlist_offer", {
      p_event_id: eventId,
      p_attendee_id: attendeeId,
    });
    if (error) return { ok: false, reason: "storage_error", error };
    if (!["declined", "expired"].includes(data?.outcome)) {
      return { ok: false, reason: data?.outcome ?? "invalid_request", ...data };
    }
    return { ok: true, ...data };
  }

  return {
    listMyOffers,
    listMyEntries,
    join,
    getPosition,
    withdraw,
    updateRegistrationData,
    acceptOffer,
    declineOffer,
  };
}

module.exports = createWaitlistService;
