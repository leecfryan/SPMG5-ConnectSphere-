const { WRITABLE_COLS } = require("./events.repository");
const TIME_FIELDS = ["start_time", "end_time", "registration_start", "registration_end"];

function comparable(field, value) {
  if (value == null || value === "") return null;
  return TIME_FIELDS.includes(field) ? new Date(value).getTime() : value;
}

function compareRequestFields(before, after) {
  return WRITABLE_COLS.filter(field => comparable(field, before[field]) !== comparable(field, after[field]))
    .map(field => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
}
module.exports = { compareRequestFields };
