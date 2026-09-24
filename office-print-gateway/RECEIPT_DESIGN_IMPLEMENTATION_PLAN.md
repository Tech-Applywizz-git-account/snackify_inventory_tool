# Receipt Design Control Plan

## Goal

Give `leadership` users a safe admin-dashboard control for receipt presentation while preserving the existing print queue and printer transport.

Admin-controlled fields:

- Receipt width: `58mm` or `80mm`
- Header and subheader text
- Footer text
- Custom label text and position
- Which context lines appear: order number, date, employee, location, item, note, tokens, guest-booked marker
- Bold header, label, and footer toggles
- Feed line count and cutter mode

Printer IP, port, Supabase credentials, and LAN/VPN settings remain gateway-only settings. They must never be editable from the public frontend.

## Single-folder ownership

This folder owns the feature contract and gateway-side implementation assets:

```text
office-print-gateway/
  receipt-design.schema.json       validation contract
  default-receipt-design.json     backwards-compatible defaults
                receipt-design-migration.sql    Supabase migration draft
  RECEIPT_DESIGN_IMPLEMENTATION_PLAN.md
  gateway.js                       existing gateway entrypoint
  test-print.js                    existing printer test entrypoint
```

The existing print agent remains the source of current behavior until the integration phase is enabled. No current print behavior should be removed while this feature is rolled out.

## Runtime flow

```text
Leadership admin dashboard
        |
        | PATCH /api/admin/receipt-design
        v
Render backend -> Supabase receipt_design (one active row)
        ^
        | read active design before each print job
        |
Office print gateway -> ESC/POS formatter -> LAN printer
```

The gateway must cache the last valid design in memory and fall back to `default-receipt-design.json` if Supabase is temporarily unavailable. Invalid settings must never prevent a receipt from printing.

## Integration phases

### Phase 1: Database contract

Create one `receipt_design` table with:

- `id` fixed to `default`
- `config` JSONB validated by the application against `receipt-design.schema.json`
- `updated_by` UUID referencing `profiles`
- `updated_at` timestamp

Enable RLS. Only the server-side Supabase service-role client writes the row. Leadership users read and update it through the authenticated backend API; the service-role key is never sent to Vercel.

The migration draft is kept in this folder and must be applied through the normal Supabase migration process.

### Phase 2: Backend admin API

Add leadership-only endpoints under the existing admin router:

- `GET /api/admin/receipt-design`
- `PATCH /api/admin/receipt-design`
- `POST /api/admin/receipt-design/reset`

Validation rules:

- Reject unknown fields.
- Enforce the JSON schema and maximum text lengths.
- Allow only `58mm` and `80mm`.
- Limit feed lines to `0..8`.
- Limit custom label text to 40 printable characters.
- Record `updated_by` from the authenticated leadership user.

The endpoint returns the normalized configuration, not database internals.

### Phase 3: Admin dashboard

Add a receipt-design section to the existing leadership admin page:

- Width selector: `58mm` / `80mm`
- Text inputs for header, subheader, footer, and custom label
- Custom-label enable toggle
- Custom-label position selector
- Context visibility checkboxes
- Feed/cut controls
- Live plain-text preview using the same normalized settings
- Save, reset-to-default, and unsaved-change warning

The page must only render for `profile.role === 'leadership'`. The backend remains the authority and must reject all other roles even if the frontend is bypassed.

### Phase 4: Gateway formatter

Move receipt rendering behind a settings-aware formatter used by both pantry receipts and meal tokens. Preserve current output by mapping the default configuration to the existing format.

For each job:

1. Load the active design with the service-role client.
2. Validate and normalize it.
3. Render the selected context and custom label.
4. Clamp text to the selected printable width.
5. Send the resulting ESC/POS bytes using the existing LAN transport.

Guest-booked receipts must retain the `GUEST BOOKED` marker even if the custom label is disabled. Admin custom labels are additional context, not a replacement for required operational markers.

### Phase 5: Verification

Test all of these before enabling the feature:

- Existing default output is unchanged.
- `58mm` output does not wrap beyond the printer width.
- `80mm` output uses the wider line length.
- Guest receipts retain guest name and `GUEST BOOKED`.
- Cafeteria token receipts retain token, date, cabin, choice, and name.
- Custom label appears in its selected position.
- Reset restores the existing receipt style.
- Non-leadership API calls receive `403`.
- Invalid text, width, feed, and unknown fields receive `400`.
- Gateway continues printing with the cached/default design when Supabase is unavailable.
- PM2 restart reloads the active design without losing queued jobs.

## Security boundaries

- Keep `SUPABASE_SERVICE_ROLE_KEY` only in the gateway and Render backend environment.
- Never put the service-role key in Vercel environment variables exposed to browser code.
- Do not allow dashboard users to edit `PRINTER_IP`, `PRINTER_PORT`, or credentials.
- Do not expose printer TCP port `9100` publicly.
- Audit every design update with user ID and timestamp.

## Rollout and rollback

1. Apply the database migration.
2. Deploy the backend API.
3. Deploy the admin UI.
4. Update/restart the office gateway.
5. Test-print a normal receipt and a guest token.
6. Enable design controls for leadership.

Rollback is the default configuration: disable the UI section, leave the active row at the defaults, and restart the gateway. Existing print queues and receipt job state remain untouched.

## Acceptance criteria

The feature is complete only when a leadership admin can change receipt context, width, and a custom label in Vercel; save it through Render; and observe the next receipt printed by the office gateway using those settings, while guest and token-required fields remain present.