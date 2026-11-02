// @vitest-environment jsdom
// Only network transport is faked; the component, service and apiFetch are real.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AuthContext } from "../../auth/useAuth";
import EventPostponeControl from "./EventPostponeControl";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EVENT_ID = "aaaaaaaa-0149-4000-8000-000000000001";
const ok = (body) => ({ status: 200, ok: true, json: async () => body });
const fail = (status, message) => ({ status, ok: false, json: async () => ({ message }) });

function setup(status, respond = () => ok({ event: { id: EVENT_ID, status: "POSTPONED" } })) {
  const fetchMock = vi.fn(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
  const onPostponed = vi.fn();
  render(<AuthContext.Provider value={{ token: "coordinator-token" }}>
    <EventPostponeControl event={{ id: EVENT_ID, status }} onPostponed={onPostponed} />
  </AuthContext.Provider>);
  return { fetchMock, onPostponed, user: userEvent.setup() };
}

const sent = (fetchMock, call = 0) => {
  const [url, options] = fetchMock.mock.calls[call];
  return { url, method: options.method, auth: options.headers.Authorization, body: options.body && JSON.parse(options.body) };
};

// SCRUM-141: PREPARATION is not postponable until the PO agrees it.
test.each(["DRAFT", "COMPLETED", "REJECTED", "CANCELLED", "POSTPONED", "PREPARATION"])(
  "[TC-149-13] a %s event offers no postpone action", (status) => {
    setup(status);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  },
);

test.each(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "SAFETY_REVIEW", "CONFIRMED"])(
  "[TC-149-13] a %s event offers a postpone action", (status) => {
    setup(status);
    expect(screen.getByRole("button", { name: "Postpone event" })).toBeInTheDocument();
  },
);

test("[TC-149-13] postponing without a reason asks for one and sends nothing", async () => {
  const { fetchMock, onPostponed, user } = setup("APPROVED");
  await user.click(screen.getByRole("button", { name: "Postpone event" }));

  expect(screen.getByText("Give a reason for postponing this event.")).toBeInTheDocument();
  expect(screen.getByLabelText("Reason")).toHaveAttribute("aria-invalid", "true");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onPostponed).not.toHaveBeenCalled();
});

test.each([["empty", ""], ["whitespace-only", "   "]])(
  "[TC-149-13] a %s reason also asks for one and sends nothing", async (_, reason) => {
    const { fetchMock, user } = setup("APPROVED");
    if (reason) await user.type(screen.getByLabelText("Reason"), reason);
    await user.click(screen.getByRole("button", { name: "Postpone event" }));

    expect(screen.getByText("Give a reason for postponing this event.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

test("[TC-149-13] postponing with a reason sends the reason and hands back the postponed event", async () => {
  const { fetchMock, onPostponed, user } = setup("APPROVED");
  await user.type(screen.getByLabelText("Reason"), "New date not yet known.");
  await user.click(screen.getByRole("button", { name: "Postpone event" }));

  await waitFor(() => expect(onPostponed).toHaveBeenCalledWith({ event: { id: EVENT_ID, status: "POSTPONED" }, venueRecheck: null }));
  expect(sent(fetchMock)).toEqual({
    url: `/api/internal/events/${EVENT_ID}/postpone`, method: "POST",
    auth: "Bearer coordinator-token", body: { reason: "New date not yet known." },
  });
});

// SCRUM-170 phase 2: the new date is optional, but both ends or neither.
test.each([["start", "New start"], ["end", "New end"]])(
  "[TC-SCRUM-170-23] only a new %s asks for both and sends nothing", async (_, label) => {
    const { fetchMock, user } = setup("APPROVED");
    await user.type(screen.getByLabelText("Reason"), "Roof repairs");
    await user.type(screen.getByLabelText(label), "2099-07-08T09:00");
    await user.click(screen.getByRole("button", { name: "Postpone event" }));

    expect(screen.getByText("Give both a new start and a new end, or leave both empty.")).toBeInTheDocument();
    expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

test("[TC-SCRUM-170-20] a new date is sent as the exact instant of the local time entered, and the venue report is handed back", async () => {
  const report = [{ booking_id: "req-1", venue_name: "Marina Hall", new_booking_date: "2099-07-08", slots: ["am"], passed: true, reasons: [] }];
  const { fetchMock, onPostponed, user } = setup("APPROVED", () => ok({ event: { id: EVENT_ID, status: "POSTPONED" }, venue_recheck: report }));
  await user.type(screen.getByLabelText("Reason"), "Roof repairs");
  await user.type(screen.getByLabelText("New start"), "2099-07-08T09:00");
  await user.type(screen.getByLabelText("New end"), "2099-07-08T17:00");
  await user.click(screen.getByRole("button", { name: "Postpone event" }));

  await waitFor(() => expect(onPostponed).toHaveBeenCalledWith({ event: { id: EVENT_ID, status: "POSTPONED" }, venueRecheck: report }));
  // vitest runs in Asia/Singapore (UTC+8), so 09:00 local is 01:00Z.
  expect(sent(fetchMock).body).toEqual({
    reason: "Roof repairs", new_start_time: "2099-07-08T01:00:00.000Z", new_end_time: "2099-07-08T09:00:00.000Z",
  });
});

test("[TC-149-13] a refusal from the server is shown and nothing is recorded as postponed", async () => {
  const { onPostponed, user } = setup("APPROVED", () => fail(403, "You do not have permission to do that."));
  await user.type(screen.getByLabelText("Reason"), "New date not yet known.");
  await user.click(screen.getByRole("button", { name: "Postpone event" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission to do that.");
  expect(onPostponed).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Postpone event" })).toBeEnabled();
});

test("[TC-149-13] while postponing is in flight the button is disabled, so it is sent once", async () => {
  let finish;
  const { fetchMock, user } = setup("APPROVED", () => new Promise((resolve) => { finish = resolve; }));
  await user.type(screen.getByLabelText("Reason"), "New date not yet known.");
  await user.click(screen.getByRole("button", { name: "Postpone event" }));

  expect(screen.getByRole("button", { name: "Postponing…" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Postponing…" }));
  expect(fetchMock).toHaveBeenCalledOnce();
  finish(ok({ event: { id: EVENT_ID, status: "POSTPONED" } }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Postpone event" })).toBeEnabled());
});
