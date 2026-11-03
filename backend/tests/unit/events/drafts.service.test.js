import { test, expect, vi } from "vitest";
import { createRequire } from "node:module";

// The modules under test are CommonJS; see events.service.test.js for why they
// are loaded with createRequire.
const require = createRequire(import.meta.url);
const { stubSupabase } = require("../../helpers/stubSupabase");

stubSupabase();
const service = require("../../../src/modules/events/events.service");

const ORGANISER = "org-1";
const DRAFT_ID = "draft-1";
const fieldsOf = (result) => result.errors.map((e) => e.field).sort();
const SUBMISSION_REQUIRED = ["description", "end_time", "expected_attendance", "purpose", "start_time"];

function inFuture(days, hours = 0) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000).toISOString();
}

function completeDetails() {
  return {
    purpose: "Reconnect alumni",
    description: "Dinner, awards and networking.",
    start_time: inFuture(7),
    end_time: inFuture(7, 3),
    expected_attendance: 200,
  };
}

// The stored draft the fake repository holds for its owner only.
function fakeRepository(stored = { id: DRAFT_ID, organiser_id: ORGANISER, status: "DRAFT", name: "Gala" }) {
  return {
    createDraft: vi.fn(async (fields, organiserId) => ({ id: DRAFT_ID, status: "DRAFT", organiser_id: organiserId, ...fields })),
    findOwnDraft: vi.fn(async (id, organiserId) => (stored && id === stored.id && organiserId === stored.organiser_id ? stored : null)),
    updateDraft: vi.fn(async (id, organiserId, fields) => ({ ...stored, ...fields })),
    markSubmitted: vi.fn(async (id, organiserId, fields) => ({ ...stored, ...fields, status: "SUBMITTED" })),
  };
}

test("[SCRUM-147-UNIT-001] AC1: a name alone saves a draft for the verified organiser", async () => {
  const repository = fakeRepository();
  const result = await service.saveDraft({ name: "  Gala  " }, ORGANISER, repository);

  expect(result.ok).toBe(true);
  expect(repository.createDraft).toHaveBeenCalledExactlyOnceWith({ name: "Gala" }, ORGANISER);
});

test("[SCRUM-147-UNIT-002] AC1: a draft without a name is refused and nothing is saved", async () => {
  const repository = fakeRepository();
  for (const input of [{}, { name: "   " }, { purpose: "Reconnect alumni" }]) {
    const result = await service.saveDraft(input, ORGANISER, repository);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(fieldsOf(result)).toEqual(["name"]);
  }
  expect(repository.createDraft).not.toHaveBeenCalled();
});

test("[SCRUM-147-UNIT-003] AC2: submission rules are not applied when a draft is saved", async () => {
  const repository = fakeRepository();
  const past = "2020-01-01T10:00:00.000Z";
  const result = await service.saveDraft(
    { name: "Gala", start_time: past, end_time: "2019-12-31T10:00:00.000Z", purpose: "", expected_attendance: "" },
    ORGANISER, repository,
  );

  expect(result.ok).toBe(true);
  expect(repository.createDraft.mock.calls[0][0]).toMatchObject({ start_time: past, purpose: null, expected_attendance: null });
});

test("[SCRUM-147-UNIT-004] AC2 boundary: an unreadable value is still reported on a draft", async () => {
  const repository = fakeRepository();
  const result = await service.saveDraft({ name: "Gala", start_time: "not a date", expected_attendance: "0" }, ORGANISER, repository);

  expect(result).toMatchObject({ ok: false, reason: "invalid" });
  expect(fieldsOf(result)).toEqual(["expected_attendance", "start_time"]);
  expect(repository.createDraft).not.toHaveBeenCalled();
});

test("[SCRUM-147-UNIT-005] AC3: an edit saves only the changed fields onto the stored draft", async () => {
  const repository = fakeRepository();
  const result = await service.updateDraft(DRAFT_ID, { purpose: " Reconnect alumni " }, ORGANISER, repository);

  expect(result).toMatchObject({ ok: true, event: { name: "Gala", purpose: "Reconnect alumni" } });
  expect(repository.updateDraft).toHaveBeenCalledExactlyOnceWith(DRAFT_ID, ORGANISER, { purpose: "Reconnect alumni" });
});

test("[SCRUM-147-UNIT-006] AC3: clearing the name of a draft is refused and nothing is written", async () => {
  const repository = fakeRepository();
  const result = await service.updateDraft(DRAFT_ID, { name: "" }, ORGANISER, repository);

  expect(result).toMatchObject({ ok: false, reason: "invalid" });
  expect(fieldsOf(result)).toEqual(["name"]);
  expect(repository.updateDraft).not.toHaveBeenCalled();
});

test("[SCRUM-147-UNIT-007] AC4: another organiser's draft is not found, for edit and submit alike", async () => {
  const repository = fakeRepository();
  expect(await service.updateDraft(DRAFT_ID, { name: "Taken" }, "org-2", repository)).toEqual({ ok: false, reason: "not_found" });
  expect(await service.submitDraft(DRAFT_ID, completeDetails(), "org-2", repository)).toEqual({ ok: false, reason: "not_found" });
  expect(repository.updateDraft).not.toHaveBeenCalled();
  expect(repository.markSubmitted).not.toHaveBeenCalled();
});

test("[SCRUM-147-UNIT-008] AC2: submitting an incomplete draft lists every missing field and keeps it a draft", async () => {
  const repository = fakeRepository();
  const result = await service.submitDraft(DRAFT_ID, {}, ORGANISER, repository);

  expect(result).toMatchObject({ ok: false, reason: "invalid" });
  expect(fieldsOf(result)).toEqual(SUBMISSION_REQUIRED);
  expect(repository.markSubmitted).not.toHaveBeenCalled();
});

test("[SCRUM-147-UNIT-009] AC3: the form's latest edits complete the draft and are submitted with it", async () => {
  const repository = fakeRepository();
  const result = await service.submitDraft(DRAFT_ID, { ...completeDetails(), expected_attendance: "200" }, ORGANISER, repository);

  expect(result).toMatchObject({ ok: true, event: { status: "SUBMITTED", name: "Gala", expected_attendance: 200 } });
  expect(repository.markSubmitted).toHaveBeenCalledExactlyOnceWith(DRAFT_ID, ORGANISER, expect.objectContaining({ purpose: "Reconnect alumni" }));
});

test("[SCRUM-147-UNIT-010] AC3: a draft saved complete earlier submits with no further edits", async () => {
  const repository = fakeRepository({ id: DRAFT_ID, organiser_id: ORGANISER, status: "DRAFT", name: "Gala", ...completeDetails() });
  const result = await service.submitDraft(DRAFT_ID, {}, ORGANISER, repository);

  expect(result).toMatchObject({ ok: true, event: { status: "SUBMITTED" } });
  expect(repository.markSubmitted).toHaveBeenCalledExactlyOnceWith(DRAFT_ID, ORGANISER, {});
});

test("[SCRUM-147-UNIT-011] AC2: an edit that blanks a stored required field blocks the submission", async () => {
  const repository = fakeRepository({ id: DRAFT_ID, organiser_id: ORGANISER, status: "DRAFT", name: "Gala", ...completeDetails() });
  const result = await service.submitDraft(DRAFT_ID, { purpose: "  " }, ORGANISER, repository);

  expect(fieldsOf(result)).toEqual(["purpose"]);
  expect(repository.markSubmitted).not.toHaveBeenCalled();
});

test("[SCRUM-147-UNIT-012] conflict: a draft submitted or changed between the read and the write is a conflict", async () => {
  const complete = { id: DRAFT_ID, organiser_id: ORGANISER, status: "DRAFT", name: "Gala", ...completeDetails() };
  const repository = { ...fakeRepository(complete), updateDraft: vi.fn(async () => null), markSubmitted: vi.fn(async () => null) };

  expect(await service.updateDraft(DRAFT_ID, { name: "Gala 2" }, ORGANISER, repository)).toEqual({ ok: false, reason: "conflict" });
  expect(await service.submitDraft(DRAFT_ID, {}, ORGANISER, repository)).toEqual({ ok: false, reason: "conflict" });
});
