// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import RegistrationWindowEditor from "./RegistrationWindowEditor";
import { updateRegistrationWindow } from "../managedEventsService";
import { toLocalDateTimeInput } from "../../events/registrationWindowFields";

vi.mock("../managedEventsService", () => ({
  updateRegistrationWindow: vi.fn(),
}));

const NOW = Date.now();
const EVENT = {
  id: "aaaaaaaa-0001-0000-0000-000000000000",
  name: "Window event",
  start_time: new Date(NOW + 60 * 60 * 1000).toISOString(),
  registration_start: null,
  registration_end: new Date(NOW - 1000).toISOString(),
  server_time: new Date(NOW).toISOString(),
  server_time_received_at: NOW,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("a closed window offers an end-date edit to reopen registration", () => {
  render(<RegistrationWindowEditor event={EVENT} token="token" onSaved={vi.fn()} />);

  expect(screen.getByText(/registration closed on/i)).toBeInTheDocument();
  expect(screen.getByLabelText("Registration closes")).toHaveValue(
    toLocalDateTimeInput(EVENT.registration_end),
  );
  expect(screen.getByRole("button", { name: "Save registration window" })).toBeEnabled();
});

test("saving an end-only change sends a partial update and refreshes the editor", async () => {
  const end = "2030-01-03T12:00:00.000Z";
  const onSaved = vi.fn();
  updateRegistrationWindow.mockResolvedValue({
    ...EVENT,
    registration_end: end,
    server_time: new Date(NOW).toISOString(),
    server_time_received_at: NOW,
  });
  render(<RegistrationWindowEditor event={EVENT} token="token" onSaved={onSaved} />);

  fireEvent.change(screen.getByLabelText("Registration closes"), {
    target: { value: "2030-01-03T12:00" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Save registration window" }).closest("form"));

  await waitFor(() => expect(updateRegistrationWindow).toHaveBeenCalledTimes(1));
  expect(updateRegistrationWindow.mock.calls[0][0]).toBe(EVENT.id);
  expect(updateRegistrationWindow.mock.calls[0][1]).toEqual({
    registration_end: "2030-01-03T12:00",
  });
  expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ registration_end: end }));
});

test("the coordinator form warns when registration closes after the event starts", () => {
  const event = {
    ...EVENT,
    start_time: "2030-01-02T10:00:00.000Z",
    registration_end: "2030-01-02T12:00:00.000Z",
    server_time: new Date(NOW).toISOString(),
  };
  render(<RegistrationWindowEditor event={event} token="token" onSaved={vi.fn()} />);

  expect(screen.getByText(/registration closes after the event starts/i)).toBeInTheDocument();
});

test("the form permits end dates in the past to be edited without a date minimum", () => {
  render(<RegistrationWindowEditor event={EVENT} token="token" onSaved={vi.fn()} />);

  expect(screen.getByLabelText("Registration closes")).not.toHaveAttribute("min");
});
