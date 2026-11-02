# Tokisla — Brand & Design System (Stage 2 foundation)

## Identity
- Name: **Tokisla** — wordmark in a clean geometric sans (Inter / Poppins class), lowercase "tokisla" for the logo lockup, "Tokisla" in UI text.
- Mark: the owner's own logo (supplied 2026-10-28): a black rounded square holding a cyan-to-pink gradient "T" with a play triangle, and the white "Tokisla" wordmark. Source: `assets/branding/logo-original.jpg`; the app uses white-background-removed PNGs (`logo-lockup.png`, `icon-192.png`, `icon-512.png`, launcher icon).

## Colors (re-skinned 2026-10-28, owner's direction)
- Base — near-black `#0B0B10` (dark-first; dark is the default theme, light stays available in Settings).
- Brand gradient — Cyan `#22D3EE` → Violet `#8B5CF6` → Pink `#EC4899` (the logo's gradient). Used sparingly: the Create (+) button, the video progress bar, primary-button gradient `#7C3AED → #DB2777`, follow/avatar plus badges.
- Primary solid — Violet `#7C3AED` (dark variant `#5B21B6`); soft tint `#F0EAFB`.
- Secondary — White `#FFFFFF`; light surface `#F8F7FA`.
- Verified tick stays sky blue `#38BDF8` (matches the gradient's cyan).
- The visual identity is deliberately general and catchy — no religious styling (owner's decision, 2026-10-28: the catalogue mixes comedy, motivation and general content). Content policies are unchanged.
- Semantic: error `#D64545`, success violet, warning `#9A7B2D`.

## Typography
- Inter (bundled, OFL) for English UI; headings 20–28 semibold, body 14–16 regular, captions 12–13. Urdu (future): Noto Nastaliq Urdu, wired through the same text theme slots.

## Components (Flutter theme)
- Buttons: 52px height, 14px radius, violet-to-pink gradient primary / white-on-dark secondary.
- Cards: white, 16px radius, 1px `#E3EAE6` border, no heavy shadows.
- Bottom nav: 5 tabs (Home, Friends, Create, Alerts, Profile); Create is a gradient rounded-rectangle with a white plus — not a copy of any other app's mark.
- Feed overlay: right rail 44px circular glass buttons; bottom-left caption block max 78% width; progress bar 3px white/25 track with the brand-gradient fill.
- States are designed, not afterthoughts: loading shimmer, empty (illustration + action), error (retry), offline banner.
