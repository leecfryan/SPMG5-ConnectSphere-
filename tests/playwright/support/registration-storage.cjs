// Test-only Supabase query adapter; uses the event submission fixture's records.
const { randomUUID } = require('node:crypto');
module.exports = function registrationStorage(accounts) {
  const registrations = [];
  const events = () => [...accounts.values()].flatMap(account => account.events);
  function project(row, selection) {
    if (!selection || selection === '*') return { ...row };
    const fields = selection.replace(/events\([^)]*\)/, '').split(',').map(field => field.trim()).filter(Boolean);
    const value = Object.fromEntries(fields.map(field => [field, row[field]]));
    const joined = /events\(([^)]*)\)/.exec(selection);
    if (joined) value.events = project(events().find(event => event.id === row.event_id) || {}, joined[1]);
    return value;
  }
  return {
    registrations,
    from(table) {
      const filters = [];
      let selection = '*', insertion, update, ordering;
      function execute(single) {
        const rows = table === 'events' ? events() : registrations;
        let result = rows.filter(row => filters.every(([key, value]) => row[key] === value));
        if (insertion) {
          if (rows.some(row => row.attendee_id === insertion.attendee_id && row.event_id === insertion.event_id)) {
            return { data: null, error: { code: '23505', message: 'Duplicate registration' } };
          }
          const now = new Date().toISOString();
          const row = { ...insertion, id: randomUUID(), created_at: now, updated_at: now };
          rows.push(row); result = [row];
        }
        if (update) result.forEach(row => Object.assign(row, update, { updated_at: new Date().toISOString() }));
        if (ordering) result.sort((a, b) => String(a[ordering.key]).localeCompare(String(b[ordering.key])) * (ordering.ascending ? 1 : -1));
        const data = result.map(row => project(row, selection));
        return { data: single ? data[0] || null : data, error: null };
      }
      const query = {
        select(fields = '*') { selection = fields; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        order(key, { ascending = true } = {}) { ordering = { key, ascending }; return query; },
        insert(value) { insertion = value; return query; },
        update(value) { update = value; return query; },
        single() { return Promise.resolve(execute(true)); },
        maybeSingle() { return Promise.resolve(execute(true)); },
        then(resolve, reject) { return Promise.resolve(execute(false)).then(resolve, reject); },
      };
      return query;
    },
  };
};
