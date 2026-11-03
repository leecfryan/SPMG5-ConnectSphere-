// @vitest-environment jsdom
// Only network transport is faked; the component, service, hook and apiFetch are real.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AuthContext } from "../../auth/useAuth";
import SafetyCheckControls from "./SafetyCheckControls";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EVENT_ID = "aaaaaaaa-0139-4000-8000-000000000001";
const READINESS = `/api/internal/events/${EVENT_ID}/safety-readiness`;
const ok = (body) => ({ status: 200, ok: true, json: async () => body });
const fail = (status, body) => ({ status, ok: false, json: async () => body });
const HALL_B = { kind: "venue", label: "Hall B · 2099-05-02", reason: "Waiting for Venue Staff to decide." };
const PROJECTOR = { kind: "equipment", label: "Projector", reason: "Waiting for Technical Support Staff to reserve it." };

function setup(status, respond) {
  const fetchMock = vi.fn(async (url, options = {}) => respond(url, options));
  vi.stubGlobal("fetch", fetchMock);
  const onChanged = vi.fn();
  render(<AuthContext.Provider value={{ token: "coordinator-token" }}>
    <SafetyCheckControls event={{ id: EVENT_ID, status }} onChanged={onChanged} />
  </AuthContext.Provider>);
  return { fetchMock, onChanged, user: userEvent.setup() };
}

const posts = (fetchMock) => fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");

test("[SCRUM-139-UI-001] AC2: an approved event that is not ready lists every missing item and cannot be submitted", async () => {
  const { fetchMock } = setup("APPROVED", () => ok({ ready: false, missing: [HALL_B, PROJECTOR] }));

  const list = await screen.findByRole("list", { name: "Missing arrangements" });
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
    "Hall B · 2099-05-02: Waiting for Venue Staff to decide.",
    "Projector: Waiting for Technical Support Staff to reserve it.",
  ]);
  expect(screen.getByRole("button", { name: "Submit for safety check" })).toBeDisabled();
  expect(fetchMock.mock.calls[0][0]).toBe(READINESS);
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer coordinator-token");
});

test("[SCRUM-139-UI-002] AC3: a ready event is submitted and the event under safety review is handed back", async () => {
  const { fetchMock, onChanged, user } = setup("APPROVED", (url) => url === READINESS
    ? ok({ ready: true, missing: [] })
    : ok({ event: { id: EVENT_ID, status: "SAFETY_REVIEW" } }));

  await user.click(await screen.findByRole("button", { name: "Submit for safety check", disabled: false }));

  await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ id: EVENT_ID, status: "SAFETY_REVIEW" }));
  expect(posts(fetchMock).map(([url]) => url)).toEqual([`/api/internal/events/${EVENT_ID}/submit-safety-check`]);
  expect(screen.queryByRole("list", { name: "Missing arrangements" })).not.toBeInTheDocument();
});

test("[SCRUM-139-UI-003] AC2: a submit refused because arrangements changed shows why and the fresh missing list", async () => {
  let readinessCalls = 0;
  const { onChanged, user } = setup("APPROVED", (url) => {
    if (url !== READINESS) return fail(409, {
      message: "This event is not ready for the safety check. Finish the arrangements listed.", missing: [PROJECTOR],
    });
    readinessCalls += 1;
    return readinessCalls === 1 ? ok({ ready: true, missing: [] }) : ok({ ready: false, missing: [PROJECTOR] });
  });

  await user.click(await screen.findByRole("button", { name: "Submit for safety check", disabled: false }));

  expect(await screen.findByRole("alert")).toHaveTextContent("This event is not ready for the safety check.");
  const list = await screen.findByRole("list", { name: "Missing arrangements" });
  expect(within(list).getByRole("listitem")).toHaveTextContent("Projector: Waiting for Technical Support Staff to reserve it.");
  expect(screen.getByRole("button", { name: "Submit for safety check" })).toBeDisabled();
  expect(onChanged).not.toHaveBeenCalled();
});

test("[SCRUM-139-UI-004] AC2: a readiness check that fails says so safely and can be retried", async () => {
  let attempt = 0;
  const { user } = setup("APPROVED", () => (attempt++ === 0
    ? fail(500, { message: "Something went wrong. Please try again." })
    : ok({ ready: false, missing: [HALL_B] })));

  expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
  expect(screen.getByRole("button", { name: "Submit for safety check" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Try again" }));

  expect(await screen.findByRole("list", { name: "Missing arrangements" })).toHaveTextContent("Hall B · 2099-05-02");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("[SCRUM-139-UI-005] AC2: while readiness loads, the coordinator is told and Submit stays disabled", async () => {
  setup("APPROVED", () => new Promise(() => {}));

  expect(screen.getByRole("status")).toHaveTextContent("Checking arrangements…");
  expect(screen.getByRole("button", { name: "Submit for safety check" })).toBeDisabled();
});

test("[SCRUM-139-UI-006] AC4: an event under safety review explains the lock and withdraws back to approved", async () => {
  const { fetchMock, onChanged, user } = setup("SAFETY_REVIEW", () => ok({ event: { id: EVENT_ID, status: "APPROVED" } }));

  expect(screen.getByText(/arrangements are locked until you withdraw it/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Withdraw from safety check" }));

  await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ id: EVENT_ID, status: "APPROVED" }));
  expect(fetchMock.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
    [`/api/internal/events/${EVENT_ID}/withdraw-safety-check`, "POST"],
  ]);
});

test("[SCRUM-139-UI-007] AC4: a refused withdrawal shows the server's message and keeps the event as it was", async () => {
  const { onChanged, user } = setup("SAFETY_REVIEW", () => fail(409, {
    message: "This event has changed since you opened it. Refresh to see its current status.",
  }));

  await user.click(screen.getByRole("button", { name: "Withdraw from safety check" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("This event has changed since you opened it.");
  expect(onChanged).not.toHaveBeenCalled();
});

test.each(["SUBMITTED", "UNDER_REVIEW", "CONFIRMED", "REJECTED", "CANCELLED", "COMPLETED"])(
  "[SCRUM-139-UI-008] AC3: a %s event shows no safety-check controls and asks the server nothing", (status) => {
    const { fetchMock } = setup(status, () => { throw new Error("no request expected"); });

    expect(screen.queryByRole("heading", { name: "Operational Safety Check" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

test("[SCRUM-139-UI-011] AC2: Check again fetches readiness afresh, so arrangements finished meanwhile enable Submit", async () => {
  let readinessCalls = 0;
  const { user } = setup("APPROVED", () => (readinessCalls++ === 0
    ? ok({ ready: false, missing: [HALL_B] })
    : ok({ ready: true, missing: [] })));

  await user.click(await screen.findByRole("button", { name: "Check again" }));

  expect(await screen.findByRole("button", { name: "Submit for safety check", disabled: false })).toBeEnabled();
  expect(screen.queryByRole("list", { name: "Missing arrangements" })).not.toBeInTheDocument();
  expect(readinessCalls).toBe(2);
});

test.each([
  ["APPROVED", "Submit for safety check", "Submitting…", "/submit-safety-check"],
  ["SAFETY_REVIEW", "Withdraw from safety check", "Withdrawing…", "/withdraw-safety-check"],
])("[SCRUM-139-UI-012] AC3/AC4: while a %s action is in flight the button is disabled, so it is sent once",
  async (status, label, busyLabel, path) => {
    let answer;
    const { fetchMock, onChanged, user } = setup(status, (url) => (url === READINESS
      ? ok({ ready: true, missing: [] })
      : new Promise((resolve) => { answer = resolve; })));

    await user.click(await screen.findByRole("button", { name: label, disabled: false }));

    const busy = await screen.findByRole("button", { name: busyLabel });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(posts(fetchMock).map(([url]) => url)).toEqual([`/api/internal/events/${EVENT_ID}${path}`]);

    answer(ok({ event: { id: EVENT_ID, status: "SAFETY_REVIEW" } }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });
