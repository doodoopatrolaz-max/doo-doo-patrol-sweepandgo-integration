# Gmail Module

Gmail is used only as supporting source-evidence reconciliation when Sweep&Go or GoHighLevel does not already provide the same field directly.

## Sweep&Go New-Client Source Evidence

Future Sweep&Go new-client account emails can provide owner-trusted source evidence such as:

- Clean Up Frequency
- How you heard about us
- How you heard about us details

The BI-safe parser is implemented in `newClientSourceEmail.ts`. It extracts only the needed label/value fields and does not require storing the full raw email body.

Matched evidence is stored in `sweepandgo_new_client_email_sources` with:

- `email_source = sweepandgo_new_client_email`
- `source_confidence = owner_email_evidence`
- `clean_up_frequency`
- `how_heard_about_us`
- `how_heard_about_us_details`
- matched onboarding intake or customer ID when safe

## Automation Boundary

This repository now has the parser, matcher, source-evidence table, and dashboard read path. It does not yet have a deployed Gmail inbox reader.

Recommended next automation pattern:

1. Add an approved read-only Gmail runtime or connector for `doodoopatrolaz@gmail.com`.
2. Search every 15 or 30 minutes for Sweep&Go new-client account emails from the last 3 days.
3. Parse each message with the new-client parser.
4. Match using email/date, phone/date, stable Sweep&Go ID when available, then name/address/date.
5. Store only parsed source evidence and match status.
6. Do not modify Gmail messages unless a later explicit approval adds labels.

Manual command target when Gmail runtime is added:

`npm run sync:gmail:new-client-sources -- --since-days=3`

## Boundary

- Gmail is not the source of truth when the same information is available directly from Sweep&Go or GoHighLevel.
- Do not store full raw email bodies unless a future review explicitly approves it.
- Do not log customer names, emails, phone numbers, addresses, message bodies, tokens, or raw payloads.
