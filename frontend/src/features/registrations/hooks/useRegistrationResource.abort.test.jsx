// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useAuth } from "../../auth/useAuth";
import { apiFetch } from "../../../lib/api";
import { useRegistrationResource } from "./useRegistrationResource";

vi.mock("../../auth/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("../../../lib/api", () => ({ apiFetch: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

test("an AbortError does not become a resource error state", async () => {
  useAuth.mockReturnValue({ token: "test-token" });
  let rejectRequest;
  apiFetch.mockReturnValue(new Promise((_resolve, reject) => {
    rejectRequest = reject;
  }));

  const { result } = renderHook(() => useRegistrationResource("/api/events"));
  await waitFor(() => expect(rejectRequest).toBeTypeOf("function"));

  await act(async () => {
    rejectRequest(new DOMException("The operation was aborted.", "AbortError"));
    await Promise.resolve();
  });

  expect(result.current.error).toBeUndefined();
  expect(result.current.loading).toBe(true);
});
