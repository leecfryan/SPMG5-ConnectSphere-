//@vitest-environment jsdom

import { afterEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SignIn from "./SignIn";

afterEach(cleanup);

test("[AUTH-FORM-001] Empty email prevents authentication", async () => {
  const user = userEvent.setup();

  const signInWithPassword = vi.fn().mockResolvedValue({ error: null });

  const fakeClient = {
    auth: { signInWithPassword },
  };

  render(<SignIn client={fakeClient} />);

  // Act: enter only a password and attempt to submit.
  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    "password123",
  );

  await user.click(
    screen.getByRole("button", { name: "Sign in", exact: true }),
  );

  //Assert: email is missing, and authentication was not attempted.
  const emailInput = screen.getByLabelText("Email address");

  expect(emailInput.validity.valueMissing).toBe(true);
  expect(signInWithPassword).not.toHaveBeenCalled();
});

test("[AUTH-FORM-002] Empty password prevents authentication", async () => {
  const user = userEvent.setup();

  const signInWithPassword = vi.fn().mockResolvedValue({ error: null });

  const fakeClient = {
    auth: { signInWithPassword },
  };

  render(<SignIn client={fakeClient} />);

  // Act: enter only an email and attempt to submit.
  await user.type(
    screen.getByLabelText("Email address", { exact: true }),
    "attendee1.demo@example.com",
  );

  await user.click(
    screen.getByRole("button", { name: "Sign in", exact: true }),
  );

  //Assert: password is missing, and authentication was not attempted.
  const passwordInput = screen.getByLabelText("Password", { exact: true });

  expect(passwordInput.validity.valueMissing).toBe(true);
  expect(signInWithPassword).not.toHaveBeenCalled();
});

test("[AUTH-FORM-003] Invalid email syntax prevents authentication", async () => {
  //Arrange
  const user = userEvent.setup();

  const signInWithPassword = vi.fn().mockResolvedValue({ error: null });

  const fakeClient = {
    auth: { signInWithPassword },
  };

  render(<SignIn client={fakeClient} />);

  //Act: enter an invalid email and a password
  await user.type(screen.getByLabelText("Email address"), "not-an-email");

  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    "ExamplePassword123!",
  );

  await user.click(
    screen.getByRole("button", { name: "Sign in", exact: true }),
  );

  //Assert
  const emailInput = screen.getByLabelText("Email address");

  expect(emailInput.validity.typeMismatch).toBe(true);
  expect(signInWithPassword).not.toHaveBeenCalled();
});

test.each([
  ["AUTH-FORM-004", "ryan@gmail.com"],
  ["AUTH-FORM-005", "staff@connectsphere.sg"],
  ["AUTH-FORM-006", "attendee.demo@example.com"],
])("[%s] Submit entered credentials for %s without a domain allowlist", async (_id, email) => {
  //Arrange
  const user = userEvent.setup();

  const signInWithPassword = vi.fn().mockResolvedValue({ error: null });

  const fakeClient = {
    auth: { signInWithPassword },
  };

  render(<SignIn client={fakeClient} />);

  //Act: enter an invalid email and a password
  const emailInput = screen.getByLabelText("Email address");

  await user.type(emailInput, email);

  await user.type(
    screen.getByLabelText("Password", { exact: true }),
    "ExamplePassword123!",
  );

  await user.click(
    screen.getByRole("button", { name: "Sign in", exact: true }),
  );

  //Assert
  expect(emailInput.validity.typeMismatch).toBe(false);
  expect(emailInput.validity.valid).toBe(true);
  expect(signInWithPassword).toHaveBeenCalledExactlyOnceWith({
    email,
    password: "ExamplePassword123!",
  });
  expect(screen.getByLabelText("Password", { exact: true }).value).toBe("");
  expect(screen.queryByRole("alert")).toBeNull();
});

test.each([
  ["AUTH-FORM-007", 400, "Unable to sign in. Check your email and password and try again."],
  ["AUTH-FORM-008", 422, "Unable to sign in. Check your email and password and try again."],
  ["AUTH-FORM-009", 429, "Too many sign-in attempts. Please wait a moment and try again."],
  ["AUTH-FORM-010", 503, "Sign-in is temporarily unavailable. Please try again."],
  ["AUTH-FORM-011", undefined, "Sign-in is temporarily unavailable. Please try again."],
])(
  "[%s] Provider status %s displays a safe message and clears the password",
  async (_id, status, message) => {
    const user = userEvent.setup();
    const signInWithPassword = vi.fn().mockResolvedValue({
      error: { status, message: "Private account and provider details" },
    });
    render(<SignIn client={{ auth: { signInWithPassword } }} />);
    await user.type(screen.getByLabelText("Email address"), "user@client.sg");
    const password = screen.getByLabelText("Password", { exact: true });
    await user.type(password, "SomePassword!");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    await user.click(
      screen.getByRole("button", { name: "Sign in", exact: true }),
    );

    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(password.value).toBe("");
    expect(password.type).toBe("password");
    expect(password.disabled).toBe(false);
    expect(
      screen.getByRole("button", { name: "Sign in", exact: true }).disabled,
    ).toBe(false);
  },
);

test("[AUTH-FORM-012] Concurrent submissions send one request and disable the form", async () => {
  let finish;
  const signInWithPassword = vi.fn().mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<SignIn client={{ auth: { signInWithPassword } }} />);
  const email = screen.getByLabelText("Email address");
  const password = screen.getByLabelText("Password", { exact: true });
  fireEvent.change(email, { target: { value: "user@client.sg" } });
  fireEvent.change(password, { target: { value: "SomePassword!" } });
  const form = email.closest("form");
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });

  expect(signInWithPassword).toHaveBeenCalledTimes(1);
  expect(email.disabled).toBe(true);
  expect(password.disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Show password" }).disabled).toBe(
    true,
  );
  expect(screen.getByRole("button", { name: "Signing in…" }).disabled).toBe(
    true,
  );
  await act(async () => {
    finish({ error: null });
  });
  expect(password.value).toBe("");
  expect(
    screen.getByRole("button", { name: "Sign in", exact: true }).disabled,
  ).toBe(false);
});

test("[AUTH-FORM-013] Network failure clears the password and permits a successful retry", async () => {
  const user = userEvent.setup();
  const signInWithPassword = vi
    .fn()
    .mockRejectedValueOnce(new Error("Private network details"))
    .mockResolvedValueOnce({ error: null });
  render(<SignIn client={{ auth: { signInWithPassword } }} />);
  await user.type(screen.getByLabelText("Email address"), "user@client.sg");
  const password = screen.getByLabelText("Password", { exact: true });
  await user.type(password, "SomePassword!");
  await user.click(
    screen.getByRole("button", { name: "Sign in", exact: true }),
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "Unable to connect. Check your connection and try again.",
  );
  expect(password.value).toBe("");

  await user.type(password, "CorrectPassword!");
  await user.click(
    screen.getByRole("button", { name: "Sign in", exact: true }),
  );
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(signInWithPassword).toHaveBeenLastCalledWith({
    email: "user@client.sg",
    password: "CorrectPassword!",
  });
});

test("[AUTH-FORM-014] Password visibility toggles without submitting or changing the password", async () => {
  const user = userEvent.setup();
  const signInWithPassword = vi.fn();
  render(<SignIn client={{ auth: { signInWithPassword } }} />);
  const password = screen.getByLabelText("Password", { exact: true });
  await user.type(password, "Secret with spaces");
  expect(password.type).toBe("password");
  await user.click(screen.getByRole("button", { name: "Show password" }));
  expect(password.type).toBe("text");
  expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("aria-pressed")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Hide password" }));
  expect(password.type).toBe("password");
  expect(password.value).toBe("Secret with spaces");
  expect(signInWithPassword).not.toHaveBeenCalled();
});

test("[AUTH-FORM-015] Keyboard Enter submits the filled form exactly once", async () => {
  const user = userEvent.setup();
  const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
  render(<SignIn client={{ auth: { signInWithPassword } }} />);
  await user.type(screen.getByLabelText("Email address"), "user@client.sg");
  await user.type(screen.getByLabelText("Password", { exact: true }), "TypedPassword!{Enter}");
  expect(signInWithPassword).toHaveBeenCalledExactlyOnceWith({ email: "user@client.sg", password: "TypedPassword!" });
  expect(screen.getByLabelText("Password", { exact: true }).value).toBe("");
});
