import { test, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";

// The modules under test are CommonJS; see events.repository.test.js for why
// they are loaded with createRequire.
const require = createRequire(import.meta.url);
const { stubSupabase } = require("../../helpers/stubSupabase");

// Records every call on the query chain and resolves with `result`, standing in
// for supabase.from(TABLE)...
let calls;
let result;
function recordingClient() {
  const query = new Proxy({}, {
    get(_target, method) {
      if (method === "then") return (resolve) => resolve(result);
      return (...args) => {
        calls.push([method, ...args]);
        return method === "single" || method === "maybeSingle" ? Promise.resolve(result) : query;
      };
    },
  });
  return { from: (table) => { calls.push(["from", table]); return query; } };
}
stubSupabase(recordingClient());
const repository = require("../../../src/modules/events/events.repository");

beforeEach(() => {
  calls = [];
  result = { data: { id: "draft-1" }, error: null };
});

const called = (method) => calls.filter(([name]) => name === method).map(([, ...args]) => args);

test("[SCRUM-147-REPO-001] AC1: createDraft inserts a DRAFT for the organiser and ignores lifecycle fields", async () => {
  await repository.createDraft(
    { name: "Gala", status: "SUBMITTED", submitted_at: "1999-01-01T00:00:00.000Z", organiser_id: "someone-else", coordinator_id: "x" },
    "org-1",
  );

  expect(called("from")).toEqual([["events"]]);
  expect(called("insert")).toEqual([[{ name: "Gala", organiser_id: "org-1", status: "DRAFT" }]]);
});

test("[SCRUM-147-REPO-002] AC3/AC4: drafts are listed newest first, only the caller's and only DRAFT", async () => {
  result = { data: [], error: null };
  await repository.findOwnDrafts("org-1");

  expect(called("eq")).toEqual([["organiser_id", "org-1"], ["status", "DRAFT"]]);
  expect(called("order")).toEqual([["created_at", { ascending: false }]]);
});

test("[SCRUM-147-REPO-003] AC4: one draft is read only when it is the caller's and still a DRAFT", async () => {
  await repository.findOwnDraft("draft-1", "org-1");

  expect(called("eq")).toEqual([["organiser_id", "org-1"], ["status", "DRAFT"], ["id", "draft-1"]]);
});

test("[SCRUM-147-REPO-004] AC3/AC4: an edit writes only editable fields, scoped to the owner's DRAFT", async () => {
  await repository.updateDraft("draft-1", "org-1", { purpose: "Reconnect", status: "APPROVED", organiser_id: "someone-else" });

  expect(called("update")).toEqual([[{ purpose: "Reconnect" }]]);
  expect(called("eq")).toEqual([["id", "draft-1"], ["organiser_id", "org-1"], ["status", "DRAFT"]]);
});

test("[SCRUM-147-REPO-005] AC3: submitting writes the last edits with SUBMITTED and submitted_at, only from the owner's DRAFT", async () => {
  const at = "2026-10-19T02:00:00.000Z";
  await repository.markSubmitted("draft-1", "org-1", { purpose: "Reconnect", status: "APPROVED" }, at);

  expect(called("update")).toEqual([[{ purpose: "Reconnect", status: "SUBMITTED", submitted_at: at }]]);
  expect(called("eq")).toEqual([["id", "draft-1"], ["organiser_id", "org-1"], ["status", "DRAFT"]]);
});

test("[SCRUM-147-REPO-006] failure: a Supabase error is thrown with the action named", async () => {
  result = { data: null, error: { message: "boom" } };

  await expect(repository.createDraft({ name: "Gala" }, "org-1")).rejects.toThrow(/createDraft failed - boom/);
  await expect(repository.findOwnDrafts("org-1")).rejects.toThrow(/findOwnDrafts failed - boom/);
  await expect(repository.findOwnDraft("draft-1", "org-1")).rejects.toThrow(/findOwnDraft failed - boom/);
  await expect(repository.updateDraft("draft-1", "org-1", {})).rejects.toThrow(/updateDraft failed - boom/);
  await expect(repository.markSubmitted("draft-1", "org-1", {})).rejects.toThrow(/markSubmitted failed - boom/);
});
