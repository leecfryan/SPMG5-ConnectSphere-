// @vitest-environment jsdom
// SCRUM-37 AC4: the confirm-before-save step for a significant edit on an
// event that may already have arrangements. Only network transport is
// faked; the component and its validation are real.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { AuthContext } from "../../auth/useAuth";
import EventRequestForm from "./EventRequestForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EVENT_ID = "aaaaaaaa-0037-4000-8000-000000000001";
const ok = (body) => ({ status: 200, ok: true, json: async () => body });

function baseEvent(status) {
  return {
    id: EVENT_ID, status,
    name: "Annual Partner Summit", purpose: "Partners", description: "A day of talks",
    start_time: "2099-01-01T10:00:00.000Z", end_time: "2099-01-01T12:00:00.000Z",
    registration_start: "", registration_end: "",
    expected_attendance: 100, venue_requirements: "A stage",
    accessibility_needs: "", equipment_needs: "A projector", other_comments: "",
  };
}

function setup(status, respond = () => ok({ event: { ...baseEvent(status), expected_attendance: 150 } })) {
  const fetchMock = vi.fn(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
  const onSubmitted = vi.fn();
  const onCancel = vi.fn();
  render(<AuthContext.Provider value={{ token: "organiser-token" }}>
    <EventRequestForm event={baseEvent(status)} onSubmitted={onSubmitted} onCancel={onCancel} />
  </AuthContext.Provider>);
  return { fetchMock, onSubmitted, onCancel, user: userEvent.setup() };
}

async function changeAttendance(user, value = "150") {
  const field = screen.getByLabelText(/^Expected attendance/);
  await user.clear(field);
  await user.type(field, value);
}

test.each([
  ["APPROVED", false],
  ["SAFETY_REVIEW", true],
  ["PREPARATION", true],
  ["CONFIRMED", true],
])("[TC-37-FE-01] a significant edit on a %s event shows the warning, naming safety review only where applicable", async (status, namesSafetyReview) => {
  const { fetchMock, user } = setup(status);
  await changeAttendance(user);
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  const warning = await screen.findByRole("alert", { name: "" });
  expect(warning).toHaveTextContent(/sends the event back to your coordinator for re-approval/);
  expect(warning).toHaveTextContent(/arrangements will be released/);
  if (namesSafetyReview) expect(warning).toHaveTextContent(/go through safety review again/);
  else expect(warning).not.toHaveTextContent(/safety review/);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("[TC-37-FE-02] backing out with \"Never mind\" dismisses the warning and sends nothing", async () => {
  const { fetchMock, user } = setup("CONFIRMED");
  await changeAttendance(user);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("alert", { name: "" });

  await user.click(screen.getByRole("button", { name: "Never mind" }));

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("[TC-37-FE-03] confirming a second time actually saves the change", async () => {
  const { fetchMock, onSubmitted, user } = setup("CONFIRMED");
  await changeAttendance(user);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("alert", { name: "" });

  await user.click(screen.getByRole("button", { name: "Confirm and save changes" }));

  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe(`/api/event-workspace/organiser/${EVENT_ID}`);
  expect(options.method).toBe("PATCH");
  expect(JSON.parse(options.body)).toEqual({ expected_attendance: "150" });
  await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalled());
});

test("[TC-37-FE-04] editing another field after the warning dismisses it - it no longer describes what's about to save", async () => {
  const { user } = setup("CONFIRMED");
  await changeAttendance(user);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("alert", { name: "" });

  await user.type(screen.getByLabelText("Other comments"), "One more note");

  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
});

test("[TC-37-FE-05] a non-significant edit on a CONFIRMED event saves in one click, no warning", async () => {
  const { fetchMock, onSubmitted, user } = setup("CONFIRMED");
  await user.type(screen.getByLabelText("Other comments"), "Catering confirmed separately");
  await user.click(screen.getByRole("button", { name: "Save changes" }));

  expect(fetchMock).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalled());
});

test.each(["SUBMITTED", "UNDER_REVIEW"])(
  "[TC-37-FE-06] a significant edit on a %s event saves in one click - nothing live to protect yet", async (status) => {
    const { fetchMock, onSubmitted, user } = setup(status);
    await changeAttendance(user);
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalled());
  });

// Reviewer feedback on PR #60: the card note below the form always claimed
// "status stays the same", even while the warning above it was saying the
// opposite - EventRequestForm.jsx hides it for as long as that warning shows.
test("[TC-37-FE-08] the warning replaces the contradictory \"status stays the same\" note, which returns once dismissed", async () => {
  const { user } = setup("CONFIRMED");
  expect(screen.getByText(/status and assignment stay the same/)).toBeInTheDocument();

  await changeAttendance(user);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("alert", { name: "" });

  expect(screen.queryByText(/status and assignment stay the same/)).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Never mind" }));

  expect(screen.getByText(/status and assignment stay the same/)).toBeInTheDocument();
});
