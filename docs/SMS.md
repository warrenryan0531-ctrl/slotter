# SMS (text confirmations & reminders)

Slotter can text customers their booking confirmations and reminders (via Twilio), on top of the email
that always goes out. Texts get opened far more than email, so they meaningfully cut no-shows. SMS is
**opt-in and off by default**: it only sends when (a) the business owner turns it on in their dashboard
(**Settings → Customer options → Text message updates**), (b) the platform has a sender configured, and
(c) the customer ticks the consent box at booking. In **demo mode** it "just works" — texts land in
`/demo/outbox` with no Twilio account.

> **Read this whole page before enabling SMS on a multi-business (agency) deployment.** How the sending
> phone number is shared has real branding, compliance, and opt-out consequences you need to decide on.

## The one thing every admin must understand: who the texts come *from*

There are two ways to run the sender, and the choice matters a lot once you host more than one business.

### Default — one shared number for the whole deployment

Out of the box, you set **one** Twilio number in the deployment's environment
(`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM`). **Every business on the hub sends from that
same number, under that same Twilio account and A2P registration.** The message body names the business
(e.g. *"Joe's Barbershop: booking confirmed…"*), but the phone number is shared.

This is perfect for a **single business**. For an **agency hosting many businesses**, understand the
tradeoffs:

- **Branding.** All clients' customers get texts from *your* number, not the client's.
- **A2P 10DLC compliance (US).** US carriers require the sending number to be tied to a registered
  **brand** (a business + EIN) and **campaign** (use case). With one shared number, *you* (the hub
  operator) are the registered sender for everyone. Sending "on behalf of" many different businesses
  from a single campaign is the **ISV/reseller** pattern — carriers scrutinize it, and doing it wrong
  gets traffic filtered or blocked. It is *not* the same as each business being registered itself.
- **Shared reputation.** All clients share one number's deliverability reputation. If one client sends
  spammy or high-complaint traffic, **every** client's texts suffer.
- **Shared opt-out (STOP).** When a customer replies **STOP**, Twilio blocks that number↔customer pair.
  Because the number is shared, that customer can be opted out of texts from businesses they never even
  interacted with.
- **Shared throughput.** One number has per-second and daily send limits (based on its trust score);
  all businesses draw from that same budget.

### Per-business — each business sends from its own number (recommended for agencies)

Slotter supports giving a business its **own** purchased Twilio number, so its texts come from *its*
number, under *its* A2P registration, with *its* own reputation and opt-out list — fully isolated from
every other business on the hub. This is the correct model when you resell booking to multiple clients.

If a business has an active row in the `bh_tenant_sms` table, Slotter uses that business's number;
otherwise it falls back to the deployment-wide number (if one is set). So you can mix: most businesses on
the shared number, key clients on their own — no code changes, just data.

## Setting up SMS

### Single business (or "everyone shares my number")

1. In Twilio, buy an SMS-capable number and complete **A2P 10DLC registration** for your business
   (brand + campaign). US texts are filtered until this is approved (usually a few days).
2. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` in the deployment env. Redeploy.
3. The owner turns SMS on in **Settings → Customer options**.

### Per-business own number (agency)

Do this per client that should have its own sender:

1. In Twilio, buy that client's number and register **their** business for A2P (their brand + campaign).
   If you manage Twilio on their behalf, use **subaccounts** so each client's number, billing, and
   registration are isolated.
2. Store that client's Twilio credentials on their tenant row:

   ```sql
   insert into bh_tenant_sms (tenant_id, twilio_account_sid, twilio_auth_token, twilio_from, active)
   values ('<TENANT_ID>', 'AC…', '<their auth token>', '+1<their number>', true)
   on conflict (tenant_id) do update
     set twilio_account_sid = excluded.twilio_account_sid,
         twilio_auth_token  = excluded.twilio_auth_token,
         twilio_from        = excluded.twilio_from,
         active             = true;
   ```

3. The client (or you) turns SMS on in their dashboard **Settings → Customer options**.

That's it — that tenant now sends from its own number; everyone else keeps using the shared one (or no
SMS if none is set).

## Notes & gotchas

- **A2P is separate from the number.** Buying a number is instant; making texts actually *deliver* to US
  phones needs the A2P registration, which is a review that takes days. The wiring works immediately; the
  first live sends will show `undelivered` (error `30034`) until registration is approved.
- **Keys are secret.** `bh_tenant_sms` holds Twilio auth tokens; it's gated by the same app-key RLS as
  every other sensitive table. Never expose it to the client or commit tokens.
- **Owner toggle + consent still apply.** Per-tenant just decides *which number* sends; the owner's
  Text-updates toggle and the customer's per-booking consent are always required.
- **Non-US / toll-free.** Toll-free numbers use a separate (often faster) verification instead of 10DLC;
  many countries don't require A2P at all. Adjust per market.
