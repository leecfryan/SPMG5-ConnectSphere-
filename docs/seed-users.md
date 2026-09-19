# Sprint 1 dummy users

These development accounts are stored in Supabase Auth (the auth.users table).
View them in the Supabase dashboard under Authentication > Users.

| Email | Role | User type |
| --- | --- | --- |
| coordinator.demo@example.com | event_coordinator | Internal |
| venue.demo@example.com | venue_staff | Internal |
| technical.demo@example.com | technical_support_staff | Internal |
| organiser.demo@example.com | event_organiser | External |
| attendee1.demo@example.com | attendee | External |
| attendee2.demo@example.com | attendee | External |
| attendee3.demo@example.com | attendee | External |

The accounts share the development password in SEED_USER_PASSWORD in the root
.env file. Keep that file private. No password is committed or printed by the seed.

## Run the seed

Install the backend dependencies with `npm --prefix backend ci` if needed.
Set SUPABASE_URL, SUPABASE_SECRET_KEY, and a SEED_USER_PASSWORD of at least
16 characters in the root .env, then run from the repository root:

```sh
npm --prefix backend run seed:users
```

The command creates missing dummy accounts and skips matching accounts on repeat
runs. It refuses to overwrite an existing account with different seed metadata.
It does not reset existing passwords: changing SEED_USER_PASSWORD only affects
new accounts. If a run stops partway through, correct the error and rerun it.

Accounts are confirmed through the admin API; no signup or invitation emails are
sent. All addresses use example.com and represent fictional users.

## Role data

Roles are stored as an array in admin-controlled `app_metadata.roles`, with
`app_metadata.user_type` identifying internal or external users.
`app_metadata.seed_id` identifies these dummy records.
Display names are in `user_metadata.full_name`.

This seed uses the five roles named in the Week 4 Release 1 instructions. It does
not establish detailed permissions or event/client relationships. The Event
Organiser is an external user, as are Attendees.

The seed itself creates no public role/profile tables, business records, access
policies, or sign-in UI. The application now provides sign-in; see the root README.
Detailed role and event-relationship enforcement remains future Sprint 1 work.
Supabase's built-in `authenticated` role is separate from these application roles.

Reference: https://supabase.com/docs/reference/javascript/auth-admin-createuser
