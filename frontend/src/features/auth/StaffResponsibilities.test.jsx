// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import StaffResponsibilities from "./StaffResponsibilities";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

const responsibilities = [
  { permission: "equipment.read", label: "Equipment information and availability", requiresRecordCheck: false },
  { permission: "technical_requests.read", label: "Technical requirements and arrangements", requiresRecordCheck: true },
];
const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test("[RBAC-DATA-001] Responsibilities stay hidden while the protected API request is pending", async () => {
  let finish;
  const fetchMock = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  render(<StaffResponsibilities token="verified-token" />);
  expect(screen.getByRole("status").textContent).toBe("Checking your staff access…");
  expect(screen.queryByRole("list")).toBeNull();
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/internal/access", expect.objectContaining({
    headers: { Authorization: "Bearer verified-token" }, cache: "no-store", signal: expect.any(AbortSignal),
  }));

  await act(async () => { finish(reply(200, { responsibilities })); });
  const list = screen.getByRole("list");
  expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(responsibilities.map((item) => item.label));
  expect(screen.queryByRole("status")).toBeNull();
});

test.each([
  ["RBAC-DATA-002", 401],
  ["RBAC-DATA-003", 403],
])("[%s] HTTP %s exposes no protected responsibilities or raw server details", async (_id, status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(status, { message: "Private server details", responsibilities })));
  render(<StaffResponsibilities token="verified-token" />);
  expect((await screen.findByRole("alert")).textContent).toBe("Your staff access is unavailable. Sign in again or contact your coordinator.");
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.queryByText("Private server details")).toBeNull();
  for (const { label } of responsibilities) expect(screen.queryByText(label)).toBeNull();
});

test("[RBAC-DATA-004] Provider outage hides data and a successful retry restores the permitted list", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(reply(503, { message: "Private server details", responsibilities }))
    .mockResolvedValueOnce(reply(200, { responsibilities }));
  vi.stubGlobal("fetch", fetchMock);
  render(<StaffResponsibilities token="verified-token" />);
  expect((await screen.findByRole("alert")).textContent).toBe("We couldn’t load your responsibilities. Please try again.");
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.queryByText("Private server details")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Retry staff access" }));
  expect(await screen.findByRole("list")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("[RBAC-DATA-005] Network failure grants no data access and permits retry", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(reply(200, { responsibilities }));
  vi.stubGlobal("fetch", fetchMock);
  render(<StaffResponsibilities token="verified-token" />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Retry staff access" }));
  expect(await screen.findByRole("list")).toBeTruthy();
});

test("[RBAC-DATA-006] An empty permitted list does not invent staff responsibilities", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { responsibilities: [] })));
  render(<StaffResponsibilities token="verified-token" />);
  expect(await screen.findByRole("list")).toBeTruthy();
  expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});

test("[RBAC-DATA-007] Leaving the staff component aborts a pending request and ignores its late response", async () => {
  let finish;
  const fetchMock = vi.fn().mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<StaffResponsibilities token="verified-token" />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  view.unmount();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { finish(reply(200, { responsibilities })); });
  expect(screen.queryByRole("list")).toBeNull();
});
