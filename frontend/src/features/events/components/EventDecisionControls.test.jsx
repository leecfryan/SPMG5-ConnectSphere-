// @vitest-environment jsdom
// Only network transport is faked; the component, service and apiFetch are real.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AuthContext } from "../../auth/useAuth";
import EventDecisionControls from "./EventDecisionControls";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EVENT_ID = "aaaaaaaa-0098-4000-8000-000000000001";
const ok = (body) => ({ status: 200, ok: true, json: async () => body });
const fail = (status, message) => ({ status, ok: false, json: async () => ({ message }) });

function setup(status, respond = (url) => ok({ event: { id: EVENT_ID, status: url.endsWith("/start-review") ? "UNDER_REVIEW" : "APPROVED" } })) {
  const fetchMock = vi.fn(async (url) => respond(url));
  vi.stubGlobal("fetch", fetchMock);
  const onDecided = vi.fn();
  render(<AuthContext.Provider value={{ token: "coordinator-token" }}>
    <EventDecisionControls event={{ id: EVENT_ID, status }} onDecided={onDecided} />
  </AuthContext.Provider>);
  return { fetchMock, onDecided, user: userEvent.setup() };
}

const sent = (fetchMock, call = 0) => {
  const [url, options] = fetchMock.mock.calls[call];
  return { url, method: options.method, auth: options.headers.Authorization, body: options.body && JSON.parse(options.body) };
};

test("[SCRUM-98-UI-001] AC2: a SUBMITTED event offers Start review, which asks the server to move it to Under review", async () => {
  const { fetchMock, onDecided, user } = setup("SUBMITTED");
  await user.click(screen.getByRole("button", { name: "Start review" }));

  await waitFor(() => expect(onDecided).toHaveBeenCalledWith({ id: EVENT_ID, status: "UNDER_REVIEW" }));
  expect(sent(fetchMock)).toEqual({ url: `/api/internal/events/${EVENT_ID}/start-review`, method: "POST", auth: "Bearer coordinator-token", body: undefined });
  expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
});

test("[SCRUM-99-UI-001] AC1: approving without a note sends the approval and hands back the approved event", async () => {
  const { fetchMock, onDecided, user } = setup("UNDER_REVIEW");
  await user.click(screen.getByRole("button", { name: "Approve" }));

  await waitFor(() => expect(onDecided).toHaveBeenCalledWith({ id: EVENT_ID, status: "APPROVED" }));
  expect(sent(fetchMock)).toEqual({ url: `/api/internal/events/${EVENT_ID}/approve`, method: "POST", auth: "Bearer coordinator-token", body: { note: "" } });
});

test("[SCRUM-99-UI-002] AC1: an approval note is sent with the approval", async () => {
  const { fetchMock, user } = setup("UNDER_REVIEW");
  await user.type(screen.getByLabelText("Decision note"), "Venue needs are clear.");
  await user.click(screen.getByRole("button", { name: "Approve" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(sent(fetchMock).body).toEqual({ note: "Venue needs are clear." });
});

test("[SCRUM-99-UI-003] AC2: the coordinator is told approval books nothing", () => {
  setup("UNDER_REVIEW");
  expect(screen.getByText(/does not book anything/)).toBeInTheDocument();
});

test("[SCRUM-98-UI-002] AC3: rejecting with a reason sends the rejection and the reason", async () => {
  const { fetchMock, onDecided, user } = setup("UNDER_REVIEW", () => ok({ event: { id: EVENT_ID, status: "REJECTED" } }));
  await user.type(screen.getByLabelText("Decision note"), "Dates clash with exams.");
  await user.click(screen.getByRole("button", { name: "Reject" }));

  await waitFor(() => expect(onDecided).toHaveBeenCalledWith({ id: EVENT_ID, status: "REJECTED" }));
  expect(sent(fetchMock)).toEqual({ url: `/api/internal/events/${EVENT_ID}/reject`, method: "POST", auth: "Bearer coordinator-token", body: { note: "Dates clash with exams." } });
});

test.each([["empty", ""], ["whitespace-only", "   "]])("[SCRUM-98-UI-003] AC3: rejecting with an %s note asks for a reason and sends nothing", async (_, note) => {
  const { fetchMock, onDecided, user } = setup("UNDER_REVIEW");
  if (note) await user.type(screen.getByLabelText("Decision note"), note);
  await user.click(screen.getByRole("button", { name: "Reject" }));

  expect(screen.getByText("Give a reason for rejecting this request.")).toBeInTheDocument();
  expect(screen.getByLabelText("Decision note")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Decision note")).toHaveAccessibleDescription(/Give a reason for rejecting this request\./);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onDecided).not.toHaveBeenCalled();
});

test("[SCRUM-98-UI-004] AC4: a refusal from the server is shown and nothing is recorded as decided", async () => {
  const { onDecided, user } = setup("UNDER_REVIEW", () => fail(403, "You do not have permission to do that."));
  await user.click(screen.getByRole("button", { name: "Approve" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission to do that.");
  expect(onDecided).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
});

test("[SCRUM-98-UI-005] conflict: a request that changed meanwhile shows the server's refresh message", async () => {
  const message = "This event request has changed since you opened it. Refresh to see its current status.";
  const { onDecided, user } = setup("SUBMITTED", () => fail(409, message));
  await user.click(screen.getByRole("button", { name: "Start review" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(onDecided).not.toHaveBeenCalled();
});

test("[SCRUM-98-UI-006] failure: while a decision is being sent both buttons are disabled, so it is sent once", async () => {
  let finish;
  const { fetchMock, user } = setup("UNDER_REVIEW", () => new Promise((resolve) => { finish = resolve; }));
  await user.click(screen.getByRole("button", { name: "Approve" }));

  expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Approve" }));
  expect(fetchMock).toHaveBeenCalledOnce();
  finish(ok({ event: { id: EVENT_ID, status: "APPROVED" } }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled());
});

test.each(["DRAFT", "APPROVED", "CONFIRMED", "REJECTED", "CANCELLED", "COMPLETED"])(
  "[SCRUM-98-UI-007] AC2: a %s event offers no review action", (status) => {
    setup(status);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  },
);
