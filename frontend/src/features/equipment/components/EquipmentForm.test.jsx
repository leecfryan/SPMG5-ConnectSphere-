// @vitest-environment jsdom
// Scrum-30 AC1/AC2: the shared add/edit form.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
afterEach(cleanup);
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import EquipmentForm from "./EquipmentForm";

describe("Scrum-30 AC1: EquipmentForm create mode", () => {
  it("has no status field - new records start AVAILABLE by default", () => {
    render(<EquipmentForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
  });

  it("submits trimmed type, location and description; omits status", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<EquipmentForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText("Type"), "  Projector  ");
    await user.type(screen.getByLabelText("Location"), "  Store A  ");
    await user.type(screen.getByLabelText("Description"), "  4K  ");
    await user.click(screen.getByRole("button", { name: /add equipment/i }));

    expect(onSubmit).toHaveBeenCalledWith({ type: "Projector", current_location: "Store A", description: "4K" });
  });

  it("submit is disabled until type and location are filled", async () => {
    const user = userEvent.setup();
    render(<EquipmentForm mode="create" onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: /add equipment/i })).toBeDisabled();
    await user.type(screen.getByLabelText("Type"), "Projector");
    expect(screen.getByRole("button", { name: /add equipment/i })).toBeDisabled();
    await user.type(screen.getByLabelText("Location"), "Store A");
    expect(screen.getByRole("button", { name: /add equipment/i })).toBeEnabled();
  });
});

describe("Scrum-30 AC1: EquipmentForm edit mode", () => {
  it("pre-fills from the initial record and offers a status dropdown excluding UNAVAILABLE", () => {
    render(<EquipmentForm mode="edit" initial={{ type: "Mic", current_location: "A", description: "x", status: "MAINTENANCE" }} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText("Type")).toHaveValue("Mic");
    expect(screen.getByLabelText("Status")).toHaveValue("MAINTENANCE");
    expect(screen.queryByRole("option", { name: "UNAVAILABLE" })).not.toBeInTheDocument();
  });

  it("falls back to AVAILABLE in the dropdown when the record is somehow UNAVAILABLE - retire is a separate action, not reachable here", () => {
    render(<EquipmentForm mode="edit" initial={{ type: "Mic", current_location: "A", status: "UNAVAILABLE" }} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText("Status")).toHaveValue("AVAILABLE");
  });

  it("submits the edited fields including status", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<EquipmentForm mode="edit" initial={{ type: "Mic", current_location: "A", description: "", status: "AVAILABLE" }} onSubmit={onSubmit} onCancel={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("Status"), "MAINTENANCE");
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(onSubmit).toHaveBeenCalledWith({ type: "Mic", current_location: "A", description: null, status: "MAINTENANCE" });
  });
});
