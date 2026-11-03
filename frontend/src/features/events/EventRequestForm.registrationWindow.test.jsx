// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import EventRequestForm from "./components/EventRequestForm";
import { submitEventRequest } from "./eventsService";

vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({ token: "organiser-token" }),
}));

vi.mock("./eventsService", () => ({
  EVENT_LIMITS: { name: 200, text: 2000 },
  submitEventRequest: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("the event request form includes optional local registration start and end inputs", () => {
  render(<EventRequestForm onSubmitted={vi.fn()} />);

  expect(screen.getByLabelText("Registration opens")).toHaveAttribute("type", "datetime-local");
  expect(screen.getByLabelText("Registration closes")).toHaveAttribute("type", "datetime-local");
  expect(screen.getByLabelText("Registration opens")).not.toBeRequired();
  expect(screen.getByLabelText("Registration closes")).not.toBeRequired();
});

test("the create form rejects a window whose end is not after its start", () => {
  render(<EventRequestForm onSubmitted={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Registration opens"), {
    target: { value: "2030-01-02T12:00" },
  });
  fireEvent.change(screen.getByLabelText("Registration closes"), {
    target: { value: "2030-01-02T11:00" },
  });
  fireEvent.submit(screen.getByRole("button", { name: "Submit request" }).closest("form"));

  expect(screen.getByText("must be after registration start")).toBeInTheDocument();
  expect(submitEventRequest).not.toHaveBeenCalled();
});

test("the create form only warns when registration closes after the event starts", () => {
  render(<EventRequestForm onSubmitted={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/Starts/), {
    target: { value: "2030-01-02T10:00" },
  });
  fireEvent.change(screen.getByLabelText("Registration closes"), {
    target: { value: "2030-01-02T11:00" },
  });

  expect(screen.getByText(/registration closes after the event starts/i)).toBeInTheDocument();
  expect(screen.getByLabelText("Registration closes")).toBeEnabled();
});
