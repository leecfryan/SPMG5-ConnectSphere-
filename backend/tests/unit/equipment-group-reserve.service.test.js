// SCRUM-31: tests equipment.service.js's createRequestGroup/reserveGroup as
// actually written, against a faithful-but-minimal fake Supabase client
// (stateful in-memory tables, same chain shape the real postgrest client
// exposes: select/eq/neq/in/order/insert/update, thenable or
// .maybeSingle()/.single() terminal) - not a reimplementation of the
// business logic, which is already proven pure in
// equipment-group-reserve.test.js. This is the orchestration layer: does
// reserveGroup load the right rows, call the pure planReservation correctly,
// and write back what it decided.
import { describe, expect, test } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createEquipmentService } = require("../../src/modules/equipment/equipment.service");

function createFakeClient(seed = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }));

  function ensureTable(name) {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function from(tableName) {
    const table = ensureTable(tableName);
    const filters = [];
    let pendingInsert = null;
    let pendingUpdate = null;

    function matches(row) {
      return filters.every((f) => f(row));
    }

    function compute() {
      if (pendingInsert) {
        table.push(...pendingInsert);
        return pendingInsert;
      }
      if (pendingUpdate) {
        const rows = table.filter(matches);
        for (const row of rows) Object.assign(row, pendingUpdate);
        return rows;
      }
      return table.filter(matches);
    }

    const api = {
      select() { return api; },
      eq(col, val) { filters.push((row) => row[col] === val); return api; },
      neq(col, val) { filters.push((row) => row[col] !== val); return api; },
      in(col, vals) { filters.push((row) => vals.includes(row[col])); return api; },
      order() { return api; },
      insert(rows) {
        pendingInsert = (Array.isArray(rows) ? rows : [rows]).map((row, index) => ({
          id: row.id || `inserted-${table.length}-${index}`,
          ...row,
        }));
        return api;
      },
      update(fields) { pendingUpdate = fields; return api; },
      async maybeSingle() {
        const rows = compute();
        return { data: rows[0] || null, error: null };
      },
      async single() {
        const rows = compute();
        return { data: rows[0], error: null };
      },
      then(resolve) { resolve({ data: compute(), error: null }); },
    };
    return api;
  }

  return { from, tables };
}

function makeUnit(id, overrides = {}) {
  return { id, type: "Projector", status: "AVAILABLE", ...overrides };
}

const WINDOW = { borrow_start: "2026-09-10T09:00:00.000Z", borrow_end: "2026-09-10T17:00:00.000Z" };

describe("SCRUM-31 AC1: createRequestGroup", () => {
  test("TC-15: creates one sibling row per requested unit, sharing a group_id, no equipment_id yet", async () => {
    const client = createFakeClient({ equipment: [], equipment_requests: [] });
    const service = createEquipmentService(client);

    const created = await service.createRequestGroup({
      event_id: "event-1",
      equipment_type: "Projector",
      quantity_requested: 10,
      is_essential: false,
      ...WINDOW,
    }, "coord-1");

    expect(created).toHaveLength(10);
    const groupIds = new Set(created.map((row) => row.group_id));
    expect(groupIds.size).toBe(1);
    for (const row of created) {
      expect(row.status).toBe("PENDING");
      expect(row.equipment_id).toBeUndefined();
      expect(row.equipment_type).toBe("Projector");
      expect(row.requested_by).toBe("coord-1");
      expect(row.quantity_requested).toBe(1);
    }
  });

  test("is_essential is stamped onto every sibling", async () => {
    const client = createFakeClient({ equipment_requests: [] });
    const service = createEquipmentService(client);
    const created = await service.createRequestGroup({
      event_id: "event-1", equipment_type: "Projector", quantity_requested: 3, is_essential: true, ...WINDOW,
    }, "coord-1");
    expect(created.every((row) => row.is_essential === true)).toBe(true);
  });
});

describe("SCRUM-31 AC1/AC2/AC5: reserveGroup", () => {
  test("TC-09: an unknown group id is a safe null (controller maps to 404)", async () => {
    const client = createFakeClient({ equipment: [], equipment_requests: [] });
    const service = createEquipmentService(client);
    expect(await service.reserveGroup("does-not-exist")).toBeNull();
  });

  test("TC-01: enough stock reserves every sibling with a distinct unit", async () => {
    const equipment = [makeUnit("u1"), makeUnit("u2"), makeUnit("u3")];
    const equipment_requests = [
      { id: "r1", group_id: "g1", equipment_type: "Projector", status: "PENDING", is_essential: false, ...WINDOW },
      { id: "r2", group_id: "g1", equipment_type: "Projector", status: "PENDING", is_essential: false, ...WINDOW },
      { id: "r3", group_id: "g1", equipment_type: "Projector", status: "PENDING", is_essential: false, ...WINDOW },
    ];
    const client = createFakeClient({ equipment, equipment_requests });
    const service = createEquipmentService(client);

    const result = await service.reserveGroup("g1");
    expect(result.ok).toBe(true);
    expect(result.reserved).toHaveLength(3);
    expect(result.unfulfilled).toHaveLength(0);
    const assignedUnitIds = new Set(result.reserved.map((row) => row.equipment_id));
    expect(assignedUnitIds).toEqual(new Set(["u1", "u2", "u3"]));
    expect(result.reserved.every((row) => row.status === "APPROVED")).toBe(true);
  });

  test("TC-02: short of stock partially reserves and auto-marks the rest UNFULFILLED", async () => {
    const equipment = [makeUnit("u1"), makeUnit("u2"), makeUnit("u3")];
    const equipment_requests = [1, 2, 3, 4, 5].map((n) => (
      { id: `r${n}`, group_id: "g1", equipment_type: "Projector", status: "PENDING", is_essential: false, ...WINDOW }
    ));
    const client = createFakeClient({ equipment, equipment_requests });
    const service = createEquipmentService(client);

    const result = await service.reserveGroup("g1");
    expect(result.ok).toBe(true);
    expect(result.reserved).toHaveLength(3);
    expect(result.unfulfilled).toHaveLength(2);
    expect(result.unfulfilled.every((row) => row.status === "UNFULFILLED" && row.equipment_id === undefined)).toBe(true);
  });

  test("TC-03: a retired (UNAVAILABLE) unit of the type is never assigned", async () => {
    const equipment = [makeUnit("u1", { status: "UNAVAILABLE" }), makeUnit("u2")];
    const equipment_requests = [
      { id: "r1", group_id: "g1", equipment_type: "Projector", status: "PENDING", is_essential: false, ...WINDOW },
    ];
    const client = createFakeClient({ equipment, equipment_requests });
    const service = createEquipmentService(client);

    const result = await service.reserveGroup("g1");
    expect(result.reserved).toHaveLength(1);
    expect(result.reserved[0].equipment_id).toBe("u2");
  });

  test("TC-04: a re-run only touches siblings still PENDING, leaving UNFULFILLED/APPROVED siblings alone", async () => {
    const equipment = [makeUnit("u1")];
    const equipment_requests = [
      { id: "r1", group_id: "g1", equipment_type: "Projector", status: "UNFULFILLED", is_essential: false, ...WINDOW },
      { id: "r2", group_id: "g1", equipment_type: "Projector", status: "UNFULFILLED", is_essential: false, ...WINDOW },
      { id: "r3", group_id: "g1", equipment_type: "Projector", status: "PENDING", is_essential: false, ...WINDOW },
    ];
    const client = createFakeClient({ equipment, equipment_requests });
    const service = createEquipmentService(client);

    const result = await service.reserveGroup("g1");
    expect(result.reserved).toHaveLength(1);
    expect(result.reserved[0].id).toBe("r3");
    expect(result.unfulfilled).toHaveLength(0);
    // The two already-UNFULFILLED rows are untouched in the underlying table.
    const stillUnfulfilled = client.tables.equipment_requests.filter((r) => r.status === "UNFULFILLED");
    expect(stillUnfulfilled.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
  });

  test("TC-07: an essential group short of stock is refused, nothing reserved", async () => {
    const equipment = [makeUnit("u1"), makeUnit("u2"), makeUnit("u3")];
    const equipment_requests = [1, 2, 3, 4].map((n) => (
      { id: `r${n}`, group_id: "g1", equipment_type: "Projector", status: "PENDING", is_essential: true, ...WINDOW }
    ));
    const client = createFakeClient({ equipment, equipment_requests });
    const service = createEquipmentService(client);

    const result = await service.reserveGroup("g1");
    expect(result).toEqual({ ok: false, reason: "essential_shortfall", availableCount: 3, pendingCount: 4 });
    // Nothing changed in the underlying table (Decision 9: checked before any write).
    expect(client.tables.equipment_requests.every((r) => r.status === "PENDING")).toBe(true);
  });

  test("TC-08: an essential group with exactly enough stock fully reserves", async () => {
    const equipment = [makeUnit("u1"), makeUnit("u2"), makeUnit("u3")];
    const equipment_requests = [1, 2, 3].map((n) => (
      { id: `r${n}`, group_id: "g1", equipment_type: "Projector", status: "PENDING", is_essential: true, ...WINDOW }
    ));
    const client = createFakeClient({ equipment, equipment_requests });
    const service = createEquipmentService(client);

    const result = await service.reserveGroup("g1");
    expect(result.ok).toBe(true);
    expect(result.reserved).toHaveLength(3);
    expect(result.unfulfilled).toHaveLength(0);
  });

  // Decision 5: essential if ANY sibling is - a group created with
  // is_essential true on every row (createRequestGroup always stamps the
  // same value), so this proves the "any" rule against a mixed group that
  // could only arise from SCRUM-144's later per-row toggle.
  test("Decision 5: a group with a mix of essential/non-essential siblings is treated as essential", async () => {
    const equipment = [makeUnit("u1"), makeUnit("u2")];
    const equipment_requests = [
      { id: "r1", group_id: "g1", equipment_type: "Projector", status: "PENDING", is_essential: true, ...WINDOW },
      { id: "r2", group_id: "g1", equipment_type: "Projector", status: "PENDING", is_essential: false, ...WINDOW },
      { id: "r3", group_id: "g1", equipment_type: "Projector", status: "PENDING", is_essential: false, ...WINDOW },
    ];
    const client = createFakeClient({ equipment, equipment_requests });
    const service = createEquipmentService(client);

    const result = await service.reserveGroup("g1");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("essential_shortfall");
  });

  test("TC-17: nothing left to reserve is a 200-shaped no-op, not an error", async () => {
    const equipment = [makeUnit("u1")];
    const equipment_requests = [
      { id: "r1", group_id: "g1", equipment_type: "Projector", status: "APPROVED", equipment_id: "u1", is_essential: false, ...WINDOW },
    ];
    const client = createFakeClient({ equipment, equipment_requests });
    const service = createEquipmentService(client);

    const result = await service.reserveGroup("g1");
    expect(result).toEqual({ ok: true, reserved: [], unfulfilled: [] });
  });

  // TC-18: a partially-applied reserve (e.g. an earlier call reserved 2 of 3
  // before something failed) is safe to re-run - only the still-PENDING
  // sibling is touched, no unit is double-assigned.
  test("TC-18: re-running after a partial reserve finishes the job without double-assigning a unit", async () => {
    const equipment = [makeUnit("u1"), makeUnit("u2"), makeUnit("u3")];
    const equipment_requests = [
      { id: "r1", group_id: "g1", equipment_type: "Projector", status: "APPROVED", equipment_id: "u1", is_essential: false, ...WINDOW },
      { id: "r2", group_id: "g1", equipment_type: "Projector", status: "APPROVED", equipment_id: "u2", is_essential: false, ...WINDOW },
      { id: "r3", group_id: "g1", equipment_type: "Projector", status: "PENDING", is_essential: false, ...WINDOW },
    ];
    const client = createFakeClient({ equipment, equipment_requests });
    const service = createEquipmentService(client);

    const result = await service.reserveGroup("g1");
    expect(result.reserved).toHaveLength(1);
    expect(result.reserved[0]).toMatchObject({ id: "r3", equipment_id: "u3", status: "APPROVED" });
    const assignedIds = client.tables.equipment_requests.filter((r) => r.status === "APPROVED").map((r) => r.equipment_id);
    expect(new Set(assignedIds)).toEqual(new Set(["u1", "u2", "u3"]));
  });

  // TC-19: a legacy (pre-SCRUM-31) row - already APPROVED, group_id equal to
  // its own id - is simply "a group of one" and behaves exactly as before.
  test("TC-19: a legacy group-of-one row needs no reserve action, nothing changes", async () => {
    const equipment = [makeUnit("u1")];
    const equipment_requests = [
      { id: "legacy-1", group_id: "legacy-1", equipment_type: "Projector", status: "APPROVED", equipment_id: "u1", is_essential: true, ...WINDOW },
    ];
    const client = createFakeClient({ equipment, equipment_requests });
    const service = createEquipmentService(client);

    const result = await service.reserveGroup("legacy-1");
    expect(result).toEqual({ ok: true, reserved: [], unfulfilled: [] });
  });

  // TC-23: an essential shortfall on one group in an event does not block a
  // separate, unrelated group from reserving normally.
  test("TC-23: an essential group's shortfall does not affect a separate non-essential group", async () => {
    const equipment = [makeUnit("p1", { type: "Projector" }), makeUnit("c1", { type: "Chair" }), makeUnit("c2", { type: "Chair" })];
    const essentialGroup = [1, 2].map((n) => (
      { id: `pr${n}`, group_id: "projectors", equipment_type: "Projector", status: "PENDING", is_essential: true, ...WINDOW }
    ));
    const chairGroup = [1, 2].map((n) => (
      { id: `cr${n}`, group_id: "chairs", equipment_type: "Chair", status: "PENDING", is_essential: false, ...WINDOW }
    ));
    const client = createFakeClient({ equipment, equipment_requests: [...essentialGroup, ...chairGroup] });
    const service = createEquipmentService(client);

    const projectorResult = await service.reserveGroup("projectors");
    expect(projectorResult.ok).toBe(false);

    const chairResult = await service.reserveGroup("chairs");
    expect(chairResult.ok).toBe(true);
    expect(chairResult.reserved).toHaveLength(2);
  });
});
