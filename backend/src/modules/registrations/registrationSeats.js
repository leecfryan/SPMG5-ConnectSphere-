const MAX_COMPARE_AND_SET_ATTEMPTS = 3;
const EVENT_SEAT_FIELDS = "id, enrolled_attendees, expected_attendance";

function asCount(value, field, nullValue) {
  if (value === null || value === undefined) return nullValue;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${field} value on event`);
  }
  return value;
}

async function readEventSeats(client, eventId) {
  const { data, error } = await client
    .from("events")
    .select(EVENT_SEAT_FIELDS)
    .eq("id", eventId)
    .maybeSingle();

  if (error) return { error };
  if (!data) return { missing: true };

  try {
    return {
      state: {
        rawEnrolled: data.enrolled_attendees === undefined ? 0 : data.enrolled_attendees,
        enrolled: asCount(data.enrolled_attendees, "enrolled_attendees", 0),
        capacity: asCount(data.expected_attendance, "expected_attendance", null),
      },
    };
  } catch (failure) {
    return { error: failure };
  }
}

async function compareAndSetEnrolled(client, eventId, expected, next) {
  let query = client
    .from("events")
    .update({ enrolled_attendees: next })
    .eq("id", eventId);

  query = expected === null
    ? query.is("enrolled_attendees", null)
    : query.eq("enrolled_attendees", expected);

  const { data, error } = await query
    .select("id, enrolled_attendees")
    .maybeSingle();
  return { updated: Boolean(data), error };
}

async function claimRegistrationSeat(client, eventId, initialEvent) {
  let state;
  try {
    state = {
      rawEnrolled: initialEvent.enrolled_attendees === undefined ? 0 : initialEvent.enrolled_attendees,
      enrolled: asCount(initialEvent.enrolled_attendees, "enrolled_attendees", 0),
      capacity: asCount(initialEvent.expected_attendance, "expected_attendance", null),
    };
  } catch (error) {
    return { status: "error", error };
  }

  for (let attempt = 0; attempt < MAX_COMPARE_AND_SET_ATTEMPTS; attempt += 1) {
    if (state.capacity !== null && state.enrolled >= state.capacity) {
      return { status: "full" };
    }

    const nextEnrolled = state.enrolled + 1;
    const claim = await compareAndSetEnrolled(
      client,
      eventId,
      state.rawEnrolled,
      nextEnrolled,
    );
    if (claim.error) return { status: "error", error: claim.error };
    if (claim.updated) return { status: "claimed", enrolled: nextEnrolled };

    const latest = await readEventSeats(client, eventId);
    if (latest.error) return { status: "error", error: latest.error };
    if (latest.missing) return { status: "missing" };
    state = latest.state;
  }

  return state.capacity !== null && state.enrolled >= state.capacity
    ? { status: "full" }
    : { status: "busy" };
}

async function releaseClaimedSeat(client, eventId, claimedEnrolled) {
  if (claimedEnrolled <= 0) return { released: false };
  const result = await compareAndSetEnrolled(
    client,
    eventId,
    claimedEnrolled,
    claimedEnrolled - 1,
  );
  return { released: result.updated, error: result.error };
}

async function releaseRegistrationSeat(client, eventId) {
  for (let attempt = 0; attempt < MAX_COMPARE_AND_SET_ATTEMPTS; attempt += 1) {
    const current = await readEventSeats(client, eventId);
    if (current.error) return { released: false, error: current.error };
    if (current.missing) return { released: false, error: new Error("Event not found while releasing registration seat") };
    if (current.state.enrolled === 0) return { released: false };

    const result = await compareAndSetEnrolled(
      client,
      eventId,
      current.state.rawEnrolled,
      current.state.enrolled - 1,
    );
    if (result.error) return { released: false, error: result.error };
    if (result.updated) return { released: true };
  }

  return { released: false, exhausted: true };
}

module.exports = {
  MAX_COMPARE_AND_SET_ATTEMPTS,
  claimRegistrationSeat,
  releaseClaimedSeat,
  releaseRegistrationSeat,
};
