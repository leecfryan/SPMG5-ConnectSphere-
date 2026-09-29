import { test, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { STATUSES, TRANSITIONS, canTransition } = require("../../../src/modules/events/lifecycle");

const AGREED_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
];

const AGREED_TRANSITIONS = [
  ["DRAFT", "SUBMITTED"],
  ["SUBMITTED", "UNDER_REVIEW"],
  ["SUBMITTED", "CANCELLED"],
  ["UNDER_REVIEW", "APPROVED"],
  ["UNDER_REVIEW", "REJECTED"],
  ["UNDER_REVIEW", "CANCELLED"],
  ["APPROVED", "CONFIRMED"],
  ["APPROVED", "CANCELLED"],
  ["CONFIRMED", "COMPLETED"],
  ["CONFIRMED", "CANCELLED"],
];

const isAgreed = (from, to) => AGREED_TRANSITIONS.some(([a, b]) => a === from && b === to);

test("SCRUM-97 AC1: the lifecycle has exactly the eight agreed statuses", () => {
  expect([...STATUSES].sort()).toEqual([...AGREED_STATUSES].sort());
});

test.each(AGREED_TRANSITIONS)("SCRUM-97 AC2: %s -> %s is a permitted transition", (from, to) => {
  expect(canTransition(from, to)).toBe(true);
});

test("SCRUM-97 AC3: every pair not in the agreed table is refused", () => {
  const refused = [];
  for (const from of AGREED_STATUSES) {
    for (const to of AGREED_STATUSES) {
      if (!isAgreed(from, to) && canTransition(from, to)) refused.push(`${from} -> ${to}`);
    }
  }
  expect(refused).toEqual([]);
});

test("SCRUM-97 AC3: an event cannot be confirmed directly from draft", () => {
  expect(canTransition("DRAFT", "CONFIRMED")).toBe(false);
});

test("SCRUM-97 AC3: a submitted event cannot skip review and be approved", () => {
  expect(canTransition("SUBMITTED", "APPROVED")).toBe(false);
});

test.each(["COMPLETED", "CANCELLED", "REJECTED"])(
  "SCRUM-97 AC3: %s is terminal and refuses every next status",
  (terminal) => {
    expect(AGREED_STATUSES.filter((to) => canTransition(terminal, to))).toEqual([]);
  },
);

test("SCRUM-97 AC3: an event cannot move backwards to an earlier status", () => {
  expect(canTransition("UNDER_REVIEW", "SUBMITTED")).toBe(false);
  expect(canTransition("APPROVED", "UNDER_REVIEW")).toBe(false);
  expect(canTransition("SUBMITTED", "DRAFT")).toBe(false);
});

test.each(AGREED_STATUSES)("SCRUM-97 AC3: %s -> itself is not a transition", (status) => {
  expect(canTransition(status, status)).toBe(false);
});

test("SCRUM-97 AC3: unknown, missing or wrongly-cased statuses are refused, not thrown", () => {
  expect(canTransition("BOGUS", "SUBMITTED")).toBe(false);
  expect(canTransition("DRAFT", "BOGUS")).toBe(false);
  expect(canTransition(undefined, "SUBMITTED")).toBe(false);
  expect(canTransition("DRAFT", undefined)).toBe(false);
  expect(canTransition(null, null)).toBe(false);
  expect(canTransition("draft", "submitted")).toBe(false);
  // Inherited object keys must not read as statuses.
  expect(canTransition("toString", "SUBMITTED")).toBe(false);
  expect(canTransition("__proto__", "SUBMITTED")).toBe(false);
});

test("SCRUM-97 AC2: the lifecycle cannot be changed at runtime", () => {
  expect(Object.isFrozen(STATUSES)).toBe(true);
  expect(Object.isFrozen(TRANSITIONS)).toBe(true);
  for (const next of Object.values(TRANSITIONS)) expect(Object.isFrozen(next)).toBe(true);
});
