// Field rules for a clarification thread message (Scrum-28-Scrum65/66).
// Two gates, same shape as equipment.validation.js:
//   validateCreateMessage - equipment_request_id (required - the real
//     public.messages schema has it NOT NULL, so a message is always tied
//     to one equipment line, not just the event) + body.
//   validateUpdateMessage - body only.
//
// author_id/author_role are deliberately not accepted here: they come from
// the authenticated caller and the role that authorized the request, never
// from client input - same reasoning equipment.validation.js documents for
// requested_by/status.

const BODY_MAX = 4000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asObject(input) {
  return input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
}

function err(field, message) {
  return { field, message };
}

function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function checkBody(data, errors) {
  const value = data.body;
  if (value === undefined || value === null) {
    errors.push(err("body", "required"));
  } else if (typeof value !== "string") {
    errors.push(err("body", "must be text"));
  } else if (value.trim() === "") {
    errors.push(err("body", "required"));
  } else if (value.length > BODY_MAX) {
    errors.push(err("body", `must be ${BODY_MAX} characters or fewer`));
  }
}

// Scrum-28-Scrum65 (AC3): which equipment line the message is about, and
// its content.
function validateCreateMessage(input) {
  const data = asObject(input);
  const errors = [];

  const requestId = data.equipment_request_id;
  if (requestId === undefined || requestId === null || requestId === "") {
    errors.push(err("equipment_request_id", "required"));
  } else if (!isUuid(requestId)) {
    errors.push(err("equipment_request_id", "must be a valid id"));
  }

  checkBody(data, errors);

  if (errors.length > 0) return { ok: false, errors, value: null };
  return {
    ok: true,
    errors: [],
    value: { equipment_request_id: requestId, body: data.body.trim() },
  };
}

// Only the body can change on an existing message - equipment_request_id is
// immutable once set, same as event_id/status are immutable elsewhere.
function validateUpdateMessage(input) {
  const data = asObject(input);
  const errors = [];

  const unknown = Object.keys(data).filter((key) => key !== "body");
  for (const field of unknown) {
    errors.push(err(field, "cannot be changed on an existing message"));
  }

  checkBody(data, errors);

  if (errors.length > 0) return { ok: false, errors, value: null };
  return { ok: true, errors: [], value: { body: data.body.trim() } };
}

module.exports = { validateCreateMessage, validateUpdateMessage };
