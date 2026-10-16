# Starhome booking system — Google Apps Script

This folder is **not published** on starhomecleaners.co.za (GitHub Pages skips folders that start with `_`).
It's kept here so the website and its booking backend live in one place.

| File | What it is |
|---|---|
| `Code.gs` | Backend: bookings, Google Calendar sync, emails & reminders, quotes, staff, clients, admin logins, client portal API |
| `Admin.html` | Admin app — Calendar · Quotes · Clients · Staff · Alerts (email + password login) |
| `Portal.html` | Client portal "My Starhome" — book, reschedule, cancel, accept quotes (phone + PIN) |
| `appsscript.json` | Project settings (Johannesburg time zone, Web app access) |

## How the website connects

- `../starhome-config.js` holds the Web app URL (`window.STARHOME_APP_URL`).
- `../index.html` laundry booking form and `../book.html` / `../book.js` cleaning calculator post every booking to it.
- "My Account", "Client login" and "Staff login" links open `?page=portal` / `?page=admin`.

## Setup (once)

1. New Google Sheet → **Extensions → Apps Script**.
2. Paste `Code.gs` (set `ADMIN_EMAIL`). Add HTML files named **Admin** and **Portal** and paste the two `.html` files.
3. Run `setup` → approve permissions.
4. **Deploy → New deployment → Web app** · Execute as **Me** · Access **Anyone** → copy the `/exec` URL.
5. Put that URL in `CONFIG.WEB_APP_URL` (Code.gs) **and** in `../starhome-config.js`, then **Deploy → Manage deployments → ✏️ → New version**.
6. Reload the Sheet → **Starhome → Set / reset an admin login**.

## Updating the code

Edit here → paste into the Apps Script editor → **Deploy → Manage deployments → ✏️ → New version**.
The live Web app only runs the published version.
