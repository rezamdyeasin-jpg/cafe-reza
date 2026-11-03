# Café Reza — Firebase build

Standalone React + Vite + Firebase (Firestore + Auth) build of the Café Reza
shop. No server, no local database, no Hatch packages. The customer panel and
the admin panel are separate routes of the same app and share one Firestore:

- Customer site: `#/` — menu, cart, checkout, order tracking, reservations,
  account, gallery, about. Sign-in with **Google, Facebook or phone number**
  only — there is no email-verification step anywhere.
- Admin panel: `#/admin` — manages everything the customer panel shows
  (products, prices, categories, banners, offers, orders, reservations,
  settings, content, users, support, inventory). Staff roles come from the
  `/users/{uid}` document; the owner's account bootstraps as admin.

See **FIREBASE-DEPLOY.md** (Bengali) for the full launch steps: GitHub upload,
Firebase Console setup, `.env` values, deploy, first admin sign-in, and
catalog seeding.

## Develop

```bash
npm install
cp .env.example .env   # fill values from Firebase Console — never commit .env
npm run dev
```

## Build & deploy

```bash
npm run build
firebase deploy --only firestore:rules,storage,hosting
```

## Data model (Firestore)

`categories`, `products`, `settings/cafe`, `coupons`, `orders`, `reservations`,
`tables`, `users`, `messages`, `tickets`, `reviews`, `inventory`, `suppliers`,
`expenses`, `refundRequests`, `auditLogs`, `shifts`. Rules in `firestore.rules`
(deny by default); Storage rules in `storage.rules`.

Orders are created inside a Firestore transaction that re-reads each product,
checks availability/price/stock, decrements stock, and validates the coupon —
totals are never trusted from the client. Mobile payments stay
"Pending verification" until a manager/admin verifies them manually.

Products priced 0 (price not yet set by the owner) are shown as unpriced and
cannot be ordered; no price is invented.
