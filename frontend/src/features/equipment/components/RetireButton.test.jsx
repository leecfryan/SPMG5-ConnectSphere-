// @vitest-environment jsdom
// Scrum-30 AC1: same inline confirm-toggle contract as registrations'
// WithdrawButton.test.jsx, mirrored here for the Retire action.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
afterEach(cleanup);
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import RetireButton from "./RetireButton";

describe("RetireButton", () => {
  it("returns to initial state when cancel is clicked", async () => {
    const user = userEvent.setup();
    render(<RetireButton onRetire={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^retire$/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByRole("button", { name: /^retire$/i })).toBeInTheDocument();
    expect(screen.queryByText(/retire this equipment/i)).not.toBeInTheDocument();
  });

  it("calls onRetire when confirmed", async () => {
    const user = userEvent.setup();
    const onRetire = vi.fn();
    render(<RetireButton onRetire={onRetire} />);
    await user.click(screen.getByRole("button", { name: /^retire$/i }));
    await user.click(screen.getByRole("button", { name: /yes, retire/i }));
    expect(onRetire).toHaveBeenCalledOnce();
  });

  it("disables confirm buttons and shows loading text while busy", async () => {
    const user = userEvent.setup();
    const onRetire = vi.fn();
    const { rerender } = render(<RetireButton onRetire={onRetire} />);
    await user.click(screen.getByRole("button", { name: /^retire$/i }));
    rerender(<RetireButton onRetire={onRetire} busy />);
    expect(screen.getByRole("button", { name: /retiring/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
  });
});
