import { expect, test } from "vitest";
import {
  getRegistrationAvailability,
  registrationAvailabilityLabel,
} from "./registrationAvailability";

test("server availability keeps a queue-owned place unavailable", () => {
  const event = {
    slots_remaining: 0,
    waitlist_queue_count: 2,
    waitlist_reserved: 0,
    expected_attendance: 5,
    enrolled_attendees: 4,
  };

  expect(getRegistrationAvailability(event)).toMatchObject({
    remaining: 0,
    isFull: true,
    queueOwnsSeat: true,
    known: true,
  });
  expect(registrationAvailabilityLabel(event)).toBe("Waitlist priority · 0 slots left");
});

test("server availability keeps an offered place reserved", () => {
  expect(registrationAvailabilityLabel({
    slots_remaining: 0,
    waitlist_queue_count: 0,
    waitlist_reserved: 1,
  })).toBe("Waitlist priority · 0 slots left");
});

test("server availability reports capacity as free when queue and offers are empty", () => {
  expect(registrationAvailabilityLabel({
    slots_remaining: 1,
    waitlist_queue_count: 0,
    waitlist_reserved: 0,
  })).toBe("Slots left: 1");
});

test("a short registration window does not create a client-side waitlist reservation", () => {
  expect(registrationAvailabilityLabel({
    start_time: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
    slots_remaining: 1,
    waitlist_queue_count: 0,
    waitlist_reserved: 0,
  })).toBe("Slots left: 1");
});

test("server availability supports uncapped events and reports missing server values", () => {
  expect(getRegistrationAvailability({
    slots_remaining: null,
    waitlist_queue_count: 0,
    waitlist_reserved: 0,
  }).unlimited).toBe(true);
  expect(getRegistrationAvailability({ expected_attendance: 10, enrolled_attendees: 9 }).known).toBe(false);
});
