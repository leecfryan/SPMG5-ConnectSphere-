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

test("AUTH-01: does not submit when email is empty", async () => {
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

test("AUTH-02: does not submit when password is empty", async () => {
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

test("AUTH-03: does not submit when email format is invalid", async () => {
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
  "ryan@gmail.com",
  "staff@connectsphere.sg",
  "attendee.demo@example.com",
])("AUTH-04: submits entered credentials for %s", async (email) => {
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
  [400, "Unable to sign in. Check your email and password and try again."],
  [422, "Unable to sign in. Check your email and password and try again."],
  [429, "Too many sign-in attempts. Please wait a moment and try again."],
  [503, "Sign-in is temporarily unavailable. Please try again."],
  [undefined, "Sign-in is temporarily unavailable. Please try again."],
])(
  "AUTH-05/07: handles provider status %s without revealing details",
  async (status, message) => {
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

test("AUTH-06: concurrent submissions send only one request and disable the form", async () => {
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

test("AUTH-07: connection failure clears the password and allows a successful retry", async () => {
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
