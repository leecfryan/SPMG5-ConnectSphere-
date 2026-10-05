# Sprint 1 dummy users

These development accounts are stored in Supabase Auth (the auth.users table).
View them in the Supabase dashboard under Authentication > Users.

| Email | Role | User type |
| --- | --- | --- |
| coordinator.demo@example.com | event_coordinator | Internal |
| coordinator2.demo@example.com | event_coordinator | Internal |
| coordinator3.demo@example.com | event_coordinator | Internal |
| venue-technical.demo@example.com | venue_staff + technical_support_staff | Internal |
| eventopsmanager.demo@example.com | event_ops_manager | Internal |
| venue.demo@example.com | venue_staff | Internal |
| technical.demo@example.com | technical_support_staff | Internal |
| organiser.demo@example.com | event_organiser | External |
| organiser2.demo@example.com | event_organiser | External |
| organiser3.demo@example.com | event_organiser | External |
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

The coordinator accounts share one role; each has a different verified user ID.
Managers assign events to those IDs through the event management workspace.
The venue/technical account has both trusted roles in the same array. It does
not establish detailed permissions or event/client relationships. The Event
Organiser is an external user, as are Attendees.

The seed itself creates no public role/profile tables, business records, access
policies, or sign-in UI. The application now provides sign-in; see the root README.
Role and event-relationship enforcement is described in [event access](event-access.md).
Supabase's built-in `authenticated` role is separate from these application roles.

Reference: https://supabase.com/docs/reference/javascript/auth-admin-createuser

## SCRUM-100 client organisations

The existing seed now gives new organiser accounts trusted Auth organisation
metadata: organiser.demo and organiser2.demo belong to `demo-client-alpha`;
organiser3.demo belongs to `demo-client-beta`. These are fictional client IDs.
All three have only the external `event_organiser` role. The agent has not run
this seed or changed existing users. Its repeat-run behaviour preserves existing
metadata; an older organiser.demo without an organisation still needs manual setup.

1. Tell teammates before changing shared demo metadata. From the repository root
   run `npm --prefix backend run seed:users` with the existing private seed
   configuration. Expect missing accounts to be created and matching accounts
   to be skipped. On a collision error, inspect the account in Supabase Auth;
   do not overwrite an unrelated account. No passwords or roles are reset.
2. In the Supabase dashboard SQL editor, run the following only for these demo
   accounts. It merges one metadata key, preserving roles and other Auth data:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('organisation_id', 'demo-client-alpha')
where email in ('organiser.demo@example.com', 'organiser2.demo@example.com')
  and raw_app_meta_data->'roles' @> '["event_organiser"]'::jsonb
returning id, email, raw_app_meta_data->>'organisation_id' as organisation_id;

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('organisation_id', 'demo-client-beta')
where email = 'organiser3.demo@example.com'
  and raw_app_meta_data->'roles' @> '["event_organiser"]'::jsonb
returning id, email, raw_app_meta_data->>'organisation_id' as organisation_id;
```

Expect two Alpha rows and one Beta row. If fewer appear, stop and check the emails
and trusted roles in Authentication > Users. Do not broaden the WHERE clause.
Tell teammates after setup. For real clients use their own verified account IDs
and organisation identifier, rather than these demo values.

3. Start backend and frontend using the root README commands. Submit one distinct
   future event from each organiser account at `/events/new`.
4. Sign in as organiser.demo. At `/my-event-requests` its event is editable,
   organiser2.demo's event is view only, and organiser3.demo's event is absent.
   Edit the first event's name, save and refresh to verify persistence.
5. Search for the Beta event name: no matches. Open its known organiser detail
   URL: "Event not found." A direct PATCH to Alpha's colleague returns 403; a
   direct PATCH to Beta returns 404. Compare the entire stored row before/after.
   Repeat with keyboard navigation at 375px width.

Removing organisation_id with an admin metadata edit restores own-only scope
on the next request; use Refresh events to check. Removing a role also revokes
that capability on the next authenticated request.
