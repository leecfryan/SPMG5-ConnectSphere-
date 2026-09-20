-- 002_yc_seed_venues.sql
-- Development seed data for SCRUM-15

insert into public.venues
  (name, address, city, country, capacity, facilities,
   accessibility_features, room_layouts, operating_hours,
   setup_minutes, teardown_minutes, turnaround_minutes, notes)
values
  ('Marina Grand Ballroom',
   '10 Bayfront Avenue', 'Singapore', 'Singapore', 500,
   '{"Stage","AV system","Wi-Fi","Catering kitchen"}',
   '{"Step-free access","Accessible restrooms","Hearing loop"}',
   '{"Theatre","Banquet","Cabaret"}',
   '{"mon":{"open":"08:00","close":"22:00"},
     "tue":{"open":"08:00","close":"22:00"},
     "wed":{"open":"08:00","close":"22:00"},
     "thu":{"open":"08:00","close":"22:00"},
     "fri":{"open":"08:00","close":"23:00"},
     "sat":{"open":"10:00","close":"23:00"},
     "sun":{"closed":true}}'::jsonb,
   120, 90, 60, 'Loading bay available at basement level.'),

  ('Orchard Seminar Room 3',
   '350 Orchard Road', 'Singapore', 'Singapore', 60,
   '{"Projector","Whiteboard","Wi-Fi"}',
   '{"Step-free access","Lift access"}',
   '{"Classroom","U-shape","Boardroom"}',
   '{"mon":{"open":"09:00","close":"18:00"},
     "tue":{"open":"09:00","close":"18:00"},
     "wed":{"open":"09:00","close":"18:00"},
     "thu":{"open":"09:00","close":"18:00"},
     "fri":{"open":"09:00","close":"18:00"},
     "sat":{"closed":true},
     "sun":{"closed":true}}'::jsonb,
   30, 30, 15, null),

  ('KLCC Conference Hall A',
   'Jalan Ampang', 'Kuala Lumpur', 'Malaysia', 220,
   '{"Stage","AV system","Wi-Fi","Breakout rooms"}',
   '{"Step-free access","Accessible restrooms"}',
   '{"Theatre","Banquet"}',
   '{"mon":{"open":"08:30","close":"21:00"},
     "tue":{"open":"08:30","close":"21:00"},
     "wed":{"open":"08:30","close":"21:00"},
     "thu":{"open":"08:30","close":"21:00"},
     "fri":{"open":"08:30","close":"21:00"},
     "sat":{"open":"09:00","close":"17:00"},
     "sun":{"closed":true}}'::jsonb,
   90, 60, 45, 'Shared loading dock with adjacent hall.');