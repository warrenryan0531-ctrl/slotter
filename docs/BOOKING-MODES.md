# The four booking modes — what each one is, and when to use it

Slotter ships with four ways to take a booking. You don't have to choose just one — a single business can offer several at once (each *service* picks its own mode). This guide explains, in plain English, what each mode does, the kind of business it fits, and exactly how to turn it on.

Two quick ideas to hold onto before the details:

- **A "service" is the unit of booking.** "Express Wash", "Free 15-min intro call", "Vinyasa Flow" — each is a row in the `bh_services` table, and each row carries the settings that decide its mode.
- **Some settings the business owner flips themselves in the dashboard; some you (the host) set once in SQL.** Wherever that matters, it's called out below. The rule of thumb: *turning a knob on an existing service* is usually a dashboard action; *creating the service or enabling money/capacity* is a host action.

Here's the whole picture at a glance:

| | **V1 · Instant appointment** | **V2 · Request / callback** | **V3 · Paid deposit** | **V4 · Group class** |
|---|---|---|---|---|
| Customer books and it's… | confirmed instantly | requested, owner approves | held until deposit is paid | a seat in a shared class |
| Best for | one-to-one services with open availability | screening, quotes, phone consults | no-show-prone or high-value jobs | classes, workshops, tours |
| Owner has to act? | no | yes — approve/decline | no (payment gates it) | no |
| Needs Stripe? | no | no | yes (in production) | no |
| Set up by | host (create service) | host + owner toggle | host (SQL + Stripe) | host (SQL), owner runs classes |

---

## V1 · Instant appointment

**What it is.** The classic. A customer picks a service, a staff member, and an open time slot, enters their details, and the booking is confirmed on the spot. A calendar invite goes to them and a notice to the owner. No one has to approve anything.

**Best for.** Any one-to-one service where the owner is happy to let the calendar fill itself: mobile detailing, a haircut, a dog groom, a handyman visit, a tutoring session.

**When to reach for it.** This is the default. Use it whenever the availability shown on the calendar is genuinely bookable and you don't need to vet the customer first.

**What the customer sees.** Service → staff → day → time → their name/phone/email → "Booked." Done in under a minute, mobile-first.

**What the owner gets.** An email notification and the appointment on their real calendar (via the `.ics` invite). It also appears under **Bookings** in the dashboard.

**How to turn it on.** This is the baseline configuration of any service: `booking_mode = 'instant'`, `requires_payment = false`, `is_group = false`. Creating the service is a host action (SQL):

```sql
insert into bh_services
  (tenant_id, name, description, duration_min, buffer_after_min, price_cents, kind, location_mode, booking_mode)
values
  ('<TENANT_ID>', 'Express Wash', 'Exterior hand wash + wheels.', 45, 15, 6000, 'onsite', 'address', 'instant');
-- then let the relevant staff perform it:
insert into bh_service_staff (service_id, staff_id) values ('<SERVICE_ID>', '<STAFF_ID>');
```

`kind` is one of `appointment` (they come to the business), `onsite` (you go to them), or `call` (phone). `location_mode` is `business`, `address`, or `phone` to match.

---

## V2 · Request-to-book & callbacks

There are really two independent dials here, and people lump them together as "version 2." Keep them separate in your head:

**Dial A — is it a phone call?** If the service is a callback or phone consultation, set `kind = 'call'` and `location_mode = 'phone'`. The customer leaves a number instead of an address, and the flow is framed as "we'll call you." That's the "callback" flavor.

**Dial B — does the owner approve each one?** Set `booking_mode = 'request'` and the booking lands as **pending** instead of confirmed. The owner sees it under **Bookings** with Approve / Decline buttons; nothing is on their calendar until they approve. Set it back to `'instant'` and it auto-confirms again.

**What it is.** A booking that isn't final until the owner says yes — optionally combined with the phone-call framing.

**Best for.** Screening leads before committing time, giving a quote first, solo professionals who want a human check (attorneys, consultants, contractors), or any callback offer ("request a call back and we'll ring you").

**When to reach for it.** Whenever "the calendar says I'm free" isn't the same as "yes, I'll take this job." Request mode buys the owner a look before it's real.

**What the customer sees.** Same smooth flow, but the confirmation reads "Requested — you'll hear back shortly" rather than "Confirmed."

**What the owner gets.** A pending item in the dashboard and a notification. Approving sends the customer their confirmation + calendar invite; declining notifies them politely. The slot is held while pending, so it can't be double-taken.

**How to turn it on.**

- *The approve-each toggle is an owner action* — no SQL needed. In the dashboard under **Services**, each service has a "Require my approval for each booking" / "Switch to auto-confirm" button. (Under the hood that flips `booking_mode`.)
- *To create a callback/phone service*, that's a host action, same as V1 but with `kind='call'`, `location_mode='phone'`, and — if you want it to require approval out of the gate — `booking_mode='request'`:

```sql
insert into bh_services
  (tenant_id, name, description, duration_min, buffer_after_min, price_cents, kind, location_mode, booking_mode)
values
  ('<TENANT_ID>', 'Request a callback', 'Leave your number and we''ll call you back.', 15, 0, 0, 'call', 'phone', 'request');
```

---

## V3 · Paid deposit

**What it is.** Before the slot is confirmed, the customer pays a deposit. The booking is held as *pending / awaiting payment*; once the deposit clears it flips to confirmed. If they never pay, the hold is released automatically (a background sweep frees it after ~40 minutes) so the time never stays locked.

**Best for.** High-value or no-show-prone work where a little skin in the game matters: ceramic coatings, long detailing jobs, premium consultations, equipment rental, anything where an empty chair costs real money.

**When to reach for it.** When you'd rather lose a tire-kicker at checkout than lose a Saturday to a no-show. Also a gentle filter — people who pay a deposit tend to show up.

**What the customer sees.** The normal flow, then a checkout step. In **demo mode** that's a built-in test page (no real charge) so you can see the whole pending → paid → confirmed cycle with zero setup. In **production** it's a real Stripe Checkout page.

**What the owner gets.** The deposit lands in *their own* Stripe account — Slotter never touches card data or holds the money. The confirmed booking then behaves like any other.

**Prerequisites.** Two things, both host actions:

1. **Mark the service as paid** (SQL) — set `requires_payment` and a `deposit_cents` amount:

   ```sql
   update bh_services
     set requires_payment = true, deposit_cents = 5000  -- $50.00
     where id = '<SERVICE_ID>';
   ```

2. **Give the tenant their Stripe keys** (production only) — each business connects its *own* Stripe account:

   ```sql
   insert into bh_tenant_payments (tenant_id, stripe_secret_key, stripe_publishable_key, stripe_webhook_secret, active)
   values ('<TENANT_ID>', 'sk_live_...', 'pk_live_...', 'whsec_...', true)
   on conflict (tenant_id) do update
     set stripe_secret_key = excluded.stripe_secret_key,
         stripe_publishable_key = excluded.stripe_publishable_key,
         stripe_webhook_secret = excluded.stripe_webhook_secret,
         active = true;
   ```

   In demo mode you can skip step 2 entirely — the test checkout stands in.

> **Production requires one more step that's easy to miss:** a paid booking only confirms when Stripe calls Slotter's webhook. You must create a Stripe webhook endpoint pointing at `/api/webhooks/stripe` and subscribe `checkout.session.completed`, or deposits will charge but bookings will never confirm. Full walkthrough + checklist: **[docs/PAYMENTS.md](./PAYMENTS.md)**.

---

## V4 · Group class / event

**What it is.** Instead of one-to-one slots, the owner publishes specific **events** (a class at a specific date and time) each with a seat **capacity**. Customers reserve a seat, the page shows live "seats remaining," and once it's full it says so. Cancel a seat and it frees up for the next person.

**Best for.** Anything one-to-many on a fixed schedule: yoga and fitness classes, workshops, guided tours, tastings, small-group lessons, webinars with a room cap.

**When to reach for it.** When the thing being booked is "a spot in *this* session at *this* time," not "an appointment sometime in my open hours."

**What the customer sees.** A list of upcoming sessions with times and seats-left, rather than a slot picker. They reserve one seat and get a calendar invite for that session.

**What the owner gets.** Each reservation shows against the event; capacity is enforced at the database level, so a class can never oversell even under a rush.

**How to turn it on.**

- *Marking a service as a group class is a host action* (SQL) — set `is_group` and a default `capacity`:

   ```sql
   insert into bh_services
     (tenant_id, name, description, duration_min, price_cents, kind, location_mode, is_group, capacity)
   values
     ('<TENANT_ID>', 'Vinyasa Flow', 'All-levels 60-minute flow.', 60, 1800, 'appointment', 'business', true, 12);
   insert into bh_service_staff (service_id, staff_id) values ('<SERVICE_ID>', '<STAFF_ID>');
   ```

- *Publishing the actual class times is an owner action* — in the dashboard under **Classes**, they add each session (date, time, capacity). No SQL needed for day-to-day scheduling. (You can also pre-seed sessions in `bh_events`; see `db/seed.sql` for a pattern that generates recurring classes.)

---

## Choosing quickly

- *Someone books an open time and it's just confirmed?* → **V1**.
- *You want to look before you commit, or it's a "call me back"?* → **V2** (toggle approval in the dashboard anytime).
- *Money should change hands before the slot is held?* → **V3** (needs the tenant's Stripe in production).
- *Many people booking the same session with a seat cap?* → **V4** (owner publishes sessions under Classes).

A single business can mix all four — e.g. the demo detailer offers instant washes (V1), a paid ceramic-coating deposit (V3), and could add a request-only quote (V2) all at once. See `docs/HOSTING-GUIDE.md` for the end-to-end setup of a new business.
