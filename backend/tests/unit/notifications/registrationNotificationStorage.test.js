import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const registrationStorage = require("../../../../tests/playwright/support/registration-storage.cjs");
const notificationStorage = require("../../../../tests/playwright/support/registration-notification-storage.cjs");
const start = Date.parse("2030-01-01T00:00:00Z");
const at = minutes => new Date(start + minutes * 60000).toISOString();

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); });
afterEach(() => { vi.useRealTimers(); });

function fixture(eventStart = at(30)) {
  const event = { id: "event-a", name: "Original event", status: "APPROVED", start_time: eventStart, cancelled_at: null, expected_attendance: 1, enrolled_attendees: 1 };
  const data = registrationStorage(new Map([["organiser", { events: [event] }]]));
  const pending = new Map();
  const work = notificationStorage(data, pending, { post: vi.fn() });
  async function offer(attendee = "attendee-a", deadline = at(120)) {
    return (await data.from("event_waitlist_entries").insert({ event_id: event.id, attendee_id: attendee,
      status: "active", offer_state: "offered", offered_at: at(0), offer_expires_at: deadline }).single()).data;
  }
  return { event, data, pending, work, offer };
}

test("[TC-SCRUM-43-D01] Browser double preserves the captured event name and status correlation after a rename", async () => {
  const f = fixture();
  await f.offer();
  f.event.name = "Renamed event";
  await f.work.prepareRegistrations();
  const [notice] = f.pending.values();
  expect(notice.payload).toMatchObject({ eventName: "Original event", changeType: "promoted", requestPath: "/registrations/me", effectiveDeadline: at(30) });
  expect(notice.payload.changeId).toBe(notice.id);
  expect(notice.payload.message).toBe("A place is available for you at Original event. Accept your offer by 2030-01-01 00:30:00 UTC.");
  f.pending.clear();
  await f.work.prepareRegistrations();
  expect(f.pending.size).toBe(0);
});

test("[TC-SCRUM-43-D02] Browser double retires a changed reminder deadline and permits one replacement when due", async () => {
  const f = fixture();
  await f.offer();
  await f.work.prepareRegistrations();
  f.pending.clear();
  await f.work.prepareReminders();
  const [oldReminder] = f.pending.values();
  expect(await f.work.reminderIsCurrent(oldReminder)).toBe(true);
  f.event.start_time = at(120);
  expect(await f.work.reminderIsCurrent(oldReminder)).toBe(false);
  f.pending.delete(oldReminder.id);
  await f.work.prepareReminders();
  expect(f.pending.size).toBe(0);
  f.event.start_time = at(20);
  await f.work.prepareReminders();
  expect(f.pending.size).toBe(1);
  const [replacement] = f.pending.values();
  expect(replacement.id).not.toBe(oldReminder.id);
  expect(replacement.payload.offerChangeId).toBe(oldReminder.payload.offerChangeId);
  expect(replacement.payload.effectiveDeadline).toBe(at(20));
  await f.work.prepareReminders();
  expect(f.pending.size).toBe(1);
});

test("[TC-SCRUM-43-D03] Browser double applies both ends of the reminder window with a controlled clock", async () => {
  const f = fixture(at(120));
  await f.offer("attendee-a", at(60));
  await f.work.prepareRegistrations();
  f.pending.clear();
  vi.setSystemTime(start - 1);
  await f.work.prepareReminders();
  expect(f.pending.size).toBe(0);
  vi.setSystemTime(start);
  await f.work.prepareReminders();
  expect(f.pending.size).toBe(1);
  const [reminder] = f.pending.values();
  expect(await f.work.reminderIsCurrent(reminder)).toBe(true);
  vi.setSystemTime(start - 1);
  expect(await f.work.reminderIsCurrent(reminder)).toBe(false);
  vi.setSystemTime(start + 3600000);
  expect(await f.work.reminderIsCurrent(reminder)).toBe(false);
});

test("[TC-SCRUM-43-D04] Concurrent browser preparations keep reminders separate for two owners of one event", async () => {
  const f = fixture();
  await f.offer("attendee-a");
  await f.offer("attendee-b");
  await f.work.prepareRegistrations();
  f.pending.clear();
  await Promise.all([f.work.prepareReminders(), f.work.prepareReminders()]);
  const notices = [...f.pending.values()];
  expect(notices).toHaveLength(2);
  expect(new Set(notices.map(row => row.id)).size).toBe(2);
  expect(notices.map(row => row.recipient_id).sort()).toEqual(["attendee-a", "attendee-b"]);
  expect(new Set(notices.map(row => row.payload.offerChangeId)).size).toBe(2);
  const forged = { ...notices[0], recipient_id: "unrelated-attendee" };
  expect(await f.work.reminderIsCurrent(forged)).toBe(false);
});
