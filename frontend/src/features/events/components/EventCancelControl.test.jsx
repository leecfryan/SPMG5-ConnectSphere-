// @vitest-environment jsdom
// Only network transport is faked; the component, service and apiFetch are real.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AuthContext } from "../../auth/useAuth";
import EventCancelControl from "./EventCancelControl";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EVENT_ID = "aaaaaaaa-0148-4000-8000-000000000001";
const ok = (body) => ({ status: 200, ok: true, json: async () => body });
const fail = (status, message) => ({ status, ok: false, json: async () => ({ message }) });

function setup(status, respond = () => ok({ event: { id: EVENT_ID, status: "CANCELLED" } })) {
  const fetchMock = vi.fn(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
  const onCancelled = vi.fn();
  render(<AuthContext.Provider value={{ token: "coordinator-token" }}>
    <EventCancelControl event={{ id: EVENT_ID, status }} onCancelled={onCancelled} />
  </AuthContext.Provider>);
  return { fetchMock, onCancelled, user: userEvent.setup() };
}

const sent = (fetchMock, call = 0) => {
  const [url, options] = fetchMock.mock.calls[call];
  return { url, method: options.method, auth: options.headers.Authorization, body: options.body && JSON.parse(options.body) };
};

test.each(["DRAFT", "COMPLETED", "REJECTED", "CANCELLED"])(
  "[TC-148-18] a %s event offers no cancel action", (status) => {
    setup(status);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  },
);

test.each(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "CONFIRMED"])(
  "[TC-148-18] a %s event offers a cancel action", (status) => {
    setup(status);
    expect(screen.getByRole("button", { name: "Cancel event" })).toBeInTheDocument();
  },
);

test("[TC-148-18] cancelling without a reason asks for one and sends nothing", async () => {
  const { fetchMock, onCancelled, user } = setup("APPROVED");
  await user.click(screen.getByRole("button", { name: "Cancel event" }));

  expect(screen.getByText("Give a reason for cancelling this event.")).toBeInTheDocument();
  expect(screen.getByLabelText("Reason")).toHaveAttribute("aria-invalid", "true");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onCancelled).not.toHaveBeenCalled();
});

test.each([["empty", ""], ["whitespace-only", "   "]])(
  "[TC-148-18] a %s reason also asks for one and sends nothing", async (_, reason) => {
    const { fetchMock, user } = setup("APPROVED");
    if (reason) await user.type(screen.getByLabelText("Reason"), reason);
    await user.click(screen.getByRole("button", { name: "Cancel event" }));

    expect(screen.getByText("Give a reason for cancelling this event.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

test("[TC-148-18] cancelling with a reason sends the reason and hands back the cancelled event", async () => {
  const { fetchMock, onCancelled, user } = setup("APPROVED");
  await user.type(screen.getByLabelText("Reason"), "Venue flooded.");
  await user.click(screen.getByRole("button", { name: "Cancel event" }));

  await waitFor(() => expect(onCancelled).toHaveBeenCalledWith({ id: EVENT_ID, status: "CANCELLED" }));
  expect(sent(fetchMock)).toEqual({
    url: `/api/internal/events/${EVENT_ID}/cancel`, method: "POST",
    auth: "Bearer coordinator-token", body: { reason: "Venue flooded." },
  });
});

test("[TC-148-18] a refusal from the server is shown and nothing is recorded as cancelled", async () => {
  const { onCancelled, user } = setup("APPROVED", () => fail(403, "You do not have permission to do that."));
  await user.type(screen.getByLabelText("Reason"), "Venue flooded.");
  await user.click(screen.getByRole("button", { name: "Cancel event" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission to do that.");
  expect(onCancelled).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Cancel event" })).toBeEnabled();
});

test("[TC-148-18] while cancelling is in flight the button is disabled, so it is sent once", async () => {
  let finish;
  const { fetchMock, user } = setup("APPROVED", () => new Promise((resolve) => { finish = resolve; }));
  await user.type(screen.getByLabelText("Reason"), "Venue flooded.");
  await user.click(screen.getByRole("button", { name: "Cancel event" }));

  expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Cancelling…" }));
  expect(fetchMock).toHaveBeenCalledOnce();
  finish(ok({ event: { id: EVENT_ID, status: "CANCELLED" } }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Cancel event" })).toBeEnabled());
});
