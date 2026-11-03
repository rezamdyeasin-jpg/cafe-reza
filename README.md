# Premium Cafe Management System — Café Reza

A full-stack cafe system for Café Reza (Bangladesh, BDT ৳, Asia/Dhaka):
mobile-first storefront, customer accounts, admin dashboard, POS with
shifts and receipts, orders, reservations/tables, inventory, coupons,
loyalty, staff, expenses, reports, notifications and support — in
Bengali and English, with dark/light themes.

## Current state: Demo Mode

The whole system starts in **Demo Mode**. Orders, POS, stock, accounts
and the admin panel are fully working against this app's own secure
server actions and database. **No real Firebase connection and no real
payment gateway are connected yet** — that is deliberate, per the
owner's direction: verify everything first, then connect payments.

- Mobile-banking payments (bKash / Nagad / Rocket) are **manual/demo
  verification only**: an order is marked *"Pending verification"* and
  is only marked Paid when an admin verifies it in Admin → Orders.
- No default credentials exist. The first admin account is created
  through the owner-setup screen (only while no admin exists); staff
  accounts are created only by an admin in Admin → Staff.
- The Firebase project **cafe-reza** already exists in the owner's
  Google account, and its public web config (including the web API
  key supplied by the owner on 3 Nov 2026) is now built into the app,
  so Firebase Auth verification email can run. Firestore/Storage and
  payments are still not live — nothing here claims a live Firebase
  data connection beyond what Admin → Security's probe reports. The
  migration path is documented below.

## Prices — authoritative source

Prices follow the owner's **printed menu photo** exactly. Two items
needed owner decisions, both now resolved by the owner:

- **Horlicks Tea** is listed as 30/50 TK on the menu. It is seeded at
  30 TK with a note to confirm the option with the cafe. Flagged for
  the owner to confirm.
- **Iced Mint Lemonade**: Half 60 TK / Full 120 TK (owner's correction),
  sold as two separate items.

Testing/poster items **not on the printed menu** (Blue Lagoon Mocktail
and Crusher, Grapes Juice, Green Mango Juice, Litchi Juice, Dragon
Fruit Juice, Orange Juice, Mango Milkshake, Mango Smoothie) are seeded
with price 0 and hidden until the owner sets a real price in
Admin → Products. No price was invented for them. The Hot Coffee poster
was **not** used as a product image because the original photo contains
a Windows right-click menu; a clean coffee photo is used instead. All
other product images are the owner's real posters/photos.

## Running it here

This artifact is served by the Muse runtime: the React client in
`client/`, typed server actions in `server/src/actions.ts`, the schema
in `server/src/schema.ts`, and Drizzle/SQLite migrations in `drizzle/`.
Build and publish only through the artifact tooling. The catalog seeds
once, automatically, when the products table is empty (`seedCatalog`
is idempotent and never overwrites existing rows).

## Domain & hosting: fully configurable, no rebuild needed

**No domain or hosting URL is hardcoded anywhere in the app code.**
All in-app navigation and all API calls use relative URLs, so the app
behaves identically on any domain or hosting provider. The domain
lives only in DNS + hosting configuration and, optionally, in
environment variables:

| Setting | Where | What to change |
|---|---|---|
| Domain / hosting | DNS + hosting provider | Point DNS at the host; no code change |
| `VITE_APP_URL` | `.env` / hosting env settings | Optional public base URL; leave empty to use "whatever domain serves the page" |
| `VITE_FIREBASE_*` | `.env` / hosting env settings | Firebase web config (see below) |
| Firebase project | `.firebaserc` | `{"projects": {"default": "cafe-reza"}}` — change the project id to move projects |
| Hosting behaviour | `firebase.json` | `public` dir, SPA rewrites, cache headers, rules/indexes references |

See `.env.example` for every variable (copy it to `.env`; never commit
real keys). Configuration is read in exactly one place:
`client/src/config.ts`. Verify no hardcoded domain crept in with:

```sh
grep -rn "https\?://" client/src server/src --include='*.ts' --include='*.tsx'
# only the cafe's public Facebook link should appear
```

### Connect a custom domain later (Firebase Hosting)

1. In the Firebase console, open **Hosting → Add custom domain** and
   enter the new domain (e.g. `www.cafereza.example`).
2. Firebase shows the DNS records to add (an `A` record, or a `TXT`
   record for verification). Add them at the domain registrar/DNS host.
3. Wait for verification — Firebase provisions the SSL certificate
   automatically. No app change is needed; the same build serves the
   new domain.
4. Optionally set `VITE_APP_URL` to the new domain in the hosting
   environment and redeploy, only if an absolute URL is needed
   somewhere outside the page. The app itself keeps working with it
   empty.
5. Add the new domain to Firebase Auth **Authorized domains**
   (Authentication → Settings) before enabling real sign-in on it,
   and to App Check / reCAPTCHA allowed domains if used.

### Free hosting with GitHub + Vercel (preview only)

From the owner's video (GitHub upload → Vercel Import → Deploy → free
subdomain): the full Bengali steps are in `DEPLOY.md`. `vercel.json`
(SPA rewrite + asset cache headers) and `.gitignore` (blocks `.env`,
`app.db`, `node_modules`) are in the repo root. **Honest limit:** a
Vercel deploy serves only the static copy — this artifact's server
actions and SQLite database do not run on Vercel, so login, orders,
POS and admin keep working only on this artifact's own link until the
backend is migrated to Cloud Functions + Firestore (step 6 of "Going
live on Firebase"). The customer and admin panels stay fully separate
on hosting too — separate entries (`#/` and `#/admin`), separate
logins, and no role change can move an account between them; the app
is the same site installed (PWA, two manifests in `client/app/`, see
`DEPLOY.md` §6), with no feature difference from the website. The GitHub-upload zip (`cafe-reza-github.zip`,
prepared 3 Nov 2026, full source, no `.env`/`app.db`/`node_modules`)
and the env-var names are listed in `DEPLOY.md` and `ENV-VARS.md`.
No live deployment was made from this build; the Vercel build has
NOT been verified on a real Vercel deploy — `package.json` ties
`@hatch/space-sdk` to a Hatch-runtime `file:` path, so a direct
Vercel deploy may fail at install/build until a standalone client
build is made. The Vercel settings in `DEPLOY.md` still need
verifying on the first real deploy, because no Vercel account was
available here.

### Move to another hosting provider later

1. Build the client (`client/dist` is the static output; `firebase.json`
   already points Hosting at it — change `public` there if the output
   directory moves).
2. Serve the static output from any static host (Netlify, Vercel,
   Cloudflare Pages, Nginx, …) with a single-page-app fallback: every
   path rewrites to `/index.html` (the `rewrites` section of
   `firebase.json` shows the rule to replicate).
3. Point the app's server-action endpoint at the deployed backend by
   the hosting setup's own mechanism (relative `./actions` calls keep
   working when frontend and actions share an origin; if they are
   split, configure the API base in the hosting environment — no
   source change).
4. Set the same environment variables from `.env.example` in the new
   host's dashboard and redeploy. Set DNS as in the custom-domain
   steps above.
5. Re-run the verification checklist below on the new domain before
   announcing it.

### Registration email verification (Firebase verification email + OTP fallback)

New customer accounts start **unverified** and cannot place orders
until the Gmail is verified — after email+password registration **and**
after **Continue with Google** alike. There are two accepted ways,
either one verifies the account:

1. **Firebase verification email (recommended).** The app uses the
   Firebase Auth SDK (`sendEmailVerification`) — Firebase itself sends
   the link to the Gmail, so no Resend/SMTP setup is needed for this
   path. Registration creates the Firebase email/password user and
   sends the mail; the account page can resend it, and after the user
   clicks the link, **“I clicked the link — finish verification”**
   sends a fresh Firebase ID token to the new
   `confirmFirebaseEmailVerified` action, which verifies the token
   with Google's tokeninfo endpoint and marks the account verified
   only when Firebase reports `email_verified=true` for the same
   email. The client never decides verification on its own.
   **Console step — done:** Firebase Console → Authentication →
   Sign-in method → **Email/Password is enabled** (verified 3 Nov
   2026), with the verification template sending from
   `noreply@cafe-reza.firebaseapp.com`. **Config — owner action
   still needed:** no Firebase credential is baked into shipped
   source. The client loads the web config at runtime from the
   server-side `getFirebaseConfig` action, which reads it only from
   the hosting environment (`FIREBASE_API_KEY`,
   `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID`, plus the optional
   auth-domain/storage/sender fields). Until those are set,
   Firebase Auth stays unavailable and registration honestly
   reports that no verification email was sent. The web API key
   that was previously baked into the build must be rotated /
   restricted in Firebase Console → Project settings.
2. **6-digit OTP by email (fallback).** The server generates the
   code, stores only its hash (15-minute expiry, 5 attempts), and
   sends it through **Resend** when configured, via a host-only
   privileged sender. To enable delivery, the owner must provide: a
   Resend account, a **verified sender domain/email**, and the
   hosting-environment secrets `RESEND_API_KEY` and `RESEND_FROM`
   (see `.env.example`). Without them, requesting a code honestly
   reports that no email was sent, the code row is discarded, and no
   code is shown anywhere — delivery is never faked.

Deleting an account: account deletion is not offered on the
customer Account → Privacy page (the customer can download their
own data there); an admin/manager deletes a customer from Admin → Staff
(`adminDeleteUser`, staff/admin accounts can never be deleted that
way, past orders are anonymised). The unverified account
`yeasinreza81@gmail.com` was removed once by the guarded one-time
`applyRequestedAccountRoles` action (only that exact email, only while
unverified with no orders and created before 4 Nov 2026) so it could
be registered fresh with Firebase verification email; the same action
also makes `rezamdyeasin@gmail.com` the owner/Super Admin (role
`admin`) when that account exists, and sets `yeasinreza81@gmail.com`
back to an ordinary customer if it ever holds a staff role. Replaying
that action can never delete a fresh or verified account. Role
pinning is enforced on every path: customer sign-in rejects staff
accounts, staff sign-in rejects customers, customer registration
refuses the owner email, owner creation refuses the customer email,
Google sign-in refuses the owner email, role changes and suspension
can never move the owner away from admin or the customer away from
the customer role, and website orders from a staff session are
refused (POS counter sales are unaffected).

### Going live on Firebase (after Demo Mode verification)

Current console state (3 Nov 2026): project **cafe-reza**, Web app
"Cafe Reza Web" registered (no Hosting), **Google sign-in provider
Enabled**, **Firestore created in Production mode** (asia-south1,
database `(default)`, deny-by-default, no collections yet). The app
loads the Firebase web config at runtime from the server
(`getFirebaseConfig`, hosting environment only) — no key is baked
into the build. Until the steps below are done, Demo Mode (server
actions + database) stays the source of truth for data, and the app
shows the honest Firebase status in Admin → Security instead of
claiming a live data connection.

1. Set the Firebase web config in the **hosting provider's
   environment/secret settings**: `FIREBASE_API_KEY`,
   `FIREBASE_PROJECT_ID` and `FIREBASE_APP_ID` (plus
   `FIREBASE_AUTH_DOMAIN`, `FIREBASE_STORAGE_BUCKET`,
   `FIREBASE_MESSAGING_SENDER_ID` as needed), copied from Firebase
   console → Project settings → Your apps → Web ("Cafe Reza Web").
   Never commit real keys; locally, copy `.env.example` to `.env`
   and fill it there. Rotate/restrict the web API key that was
   previously baked into the build. Once the config is set,
   registration sends Firebase's verification email directly.
   Email/Password sign-in is already enabled in the console, with
   the verification template sending from
   `noreply@cafe-reza.firebaseapp.com`. Before announcing Google sign-in,
   add this site's domain to Authentication → Settings → Authorized
   domains (step 2).
2. Install the Firebase CLI (`npm i -g firebase-tools`), sign in as
   the project owner (`firebase login`), and deploy the strict rules
   in this repo (deny by default, role-based, customers only their
   own data — see the header of `firestore.rules`):
   `firebase deploy --only firestore:rules,storage`
   Then verify in the console: **Firestore → Rules** shows the
   deployed rules, and **Authentication → Settings → Authorized
   domains** includes this site's domain (Google sign-in fails with
   `auth/unauthorized-domain` without it).
3. Enable **App Check** (Console → App Check → Firestore/Storage,
   reCAPTCHA Enterprise provider), add the site key as
   `VITE_FIREBASE_APPCHECK_KEY` in the hosting environment, and turn
   on **enforcement**. Without enforcement, App Check is reporting
   only.
4. Two-factor authentication for staff is not live yet: it needs
   Firebase Auth multi-factor (TOTP/phone) enrollment plus
   server-side session checks. Do not treat the Google sign-in alone
   as 2FA. Remaining steps: enable MFA enrollment in the console,
   add an enrollment screen, and require a second factor in
   `loginStaff` before a staff session is issued.
5. Set staff roles as **custom claims** with the Admin SDK (or rely
   on the `/users/{uid}` role field the rules fall back to), keying
   user documents by Firebase UID. Test the rules with the Firestore
   Rules Playground and the emulator (`firebase emulators:start
   --only firestore`) using a customer account, a staff account and
   an admin account before trusting them in production.
6. Migrate the server-action logic to Cloud Functions behind the same
   action shapes, keeping server-side price/coupon/stock validation
   and manual payment verification. `firestore.rules` already encodes
   the deny-by-default policy the actions enforce today. Until that
   migration is done, Firestore holds only the catalog snapshot the
   admin publishes from Admin → Security; orders, reservations and
   messages still live in this artifact's database.
7. Enable **Cloud Messaging** for push notifications and **Hosting**
   (`firebase.json` is ready; `firebase deploy` publishes it).
8. Only after order, POS, stock, accounts and admin are verified,
   connect a real gateway (bKash/Nagad/Rocket/SSLCommerz) with
   merchant credentials stored in Functions secrets — never in client
   code or in this repo — and server-side callback verification.

## Ad placements (optional, off by default)

Four configurable slots exist — **below the hero, below the menu list,
in the gallery/offers area, and above the footer** — all **OFF by
default**, with **no ad-network code hardcoded and no ads shown now**.
Slots appear only between content sections on the storefront: strictly
**no popups, no interstitials, no content-covering or sticky ads, no
ads inside checkout, cart, POS, login or the admin panel, and no
auto-playing or flashing ads** (embed frames run sandboxed with
autoplay disabled). An empty or disabled slot renders nothing and
collapses cleanly with no blank gap, and each slot can be turned on/off
individually.

Until an ad is enabled, each slot shows the cafe's own promo content
instead: the owner's promo videos (muted loop autoplay, with a sound
toggle and play/pause control, loaded only as they scroll into view)
in the hero, below the menu list, and in the gallery/offers area, and a
rotating banner carousel of the owner's posters (each banner opens its
product — Green Mango Juice, Blue Lagoon Crusher, Coconut Smoothie,
Special Faluda, Blue Lagoon Mocktail, Pineapple Juice) below the hero
and above the footer. Enabling an ad in a slot replaces that slot's
promo content; disabling it brings the promo back.

Admin → Settings → *Optional future ad placements* lets an admin, per
slot: enable/disable it, choose **Banner image + link** (paste an image
URL or upload a banner image under 2 MB, plus a link URL) or **Embed
code** (paste the ad network's snippet). Embed code is never injected
into the page: it runs inside a sandboxed iframe isolated from the
app, so it cannot read the page, storage or session tokens. Slots are
labelled "Advertisement" when shown. Slot content is stored in the
settings row (`ads_json`) and served with the storefront settings.

## Verification checklist (run before going live)

1. Owner setup → login; customer registration → login.
2. Add to cart → checkout (Cash on Delivery, and bKash → *Pending
   verification*) → track the order → admin changes status and
   verifies payment.
3. Set a price on a testing item in Admin → Products, then order it.
4. POS: open shift → cash sale with change → receipt download → close
   shift and check the expected/difference figures; offline sale queues
   as *Pending sync* and is never shown as confirmed until synced.
5. Reservation within capacity; a 7th overlapping reservation is
   rejected server-side.
6. Stock decreases on order, restores on eligible cancellation.
7. Role checks: kitchen sees Orders only; cashier sees
   Dashboard/Orders/POS; inventory sees Inventory/Products.
8. Mobile (phone-width, bottom nav) and desktop layouts; no
   horizontal overflow.
9. After a domain/hosting move: repeat 1–8 on the new domain.

## What is intentionally not here yet

Real Firebase Auth/Firestore/Storage/Functions/Messaging/App Check
connections, real payment-gateway integrations, email/SMS/push
delivery, PDF/Excel exports beyond the CSV order export and text
receipts/invoices, recipe-level ingredient deduction, and attendance/
leave tracking — all are structured for later phases and must only be
added with real credentials and successful testing, never simulated.
