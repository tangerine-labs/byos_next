# Session changes — 2026-05-31

Log of everything done in this session so it can be reproduced from a clean
clone on this machine (macOS, Homebrew, pnpm).

---

## 1. CLAUDE.md added (committed)

Added `/CLAUDE.md` at repo root: architecture overview, command reference,
DB-scoping rule (`db` bypasses RLS, must use `withUserScope` for tenant work),
migrations workflow, render pipeline, caching, auth notes.

- Commit: `27ec19b docs: add CLAUDE.md with architecture and command reference`
- Branch: `stuff`
- No reproduction needed — it's in git.

---

## 2. Global Claude Code permission mode (outside the repo)

Edited `~/.claude/settings.json` to set `permissions.defaultMode`. Started as
`"bypassPermissions"`, then the user/linter changed it to `"auto"`. Either way
new Claude Code sessions skip most permission prompts.

To restore prompts: change `defaultMode` to `"default"` or run `/permissions`.

---

## 3. Local Postgres provisioned

Postgres 16 was already running via Homebrew (`brew services list` showed
`postgresql@16 started`). The `psql` binary lives at
`/opt/homebrew/opt/postgresql@16/bin/psql` (not on PATH by default).

```bash
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
createdb -U b byos_db
```

Database owner: `b` (the macOS user, superuser in this Homebrew install).
No password needed — peer auth on localhost.

---

## 4. `.env.local` created

```ini
# /Users/b/code/byos_next/.env.local
DATABASE_URL=postgres://b@localhost:5432/byos_db?sslmode=disable
AUTH_ENABLED=false
NODE_ENV=development
ENABLE_EXTERNAL_CATALOG=true
```

- `AUTH_ENABLED=false` puts the app in mono-user mode, so no
  `BETTER_AUTH_SECRET`, `ADMIN_EMAIL`, or sign-up flow is needed.
  `getCurrentUserId()` returns the seeded `byos_mono_user`, which satisfies RLS.
- `ENABLE_EXTERNAL_CATALOG=true` un-gates the community / TRMNL recipe catalog
  on `/catalog` (added later in the session — see §8).
- `DATABASE_URL` uses `sslmode=disable` so `lib/database/db.ts` doesn't try to
  negotiate TLS to the local socket.

---

## 5. Migrations applied

Ran every SQL file in `migrations/` in lexical order, stopping on first error:

```bash
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
cd /Users/b/code/byos_next/migrations
for f in $(ls *.sql | sort); do
  echo "=== Running $f ==="
  psql -U b -d byos_db -v ON_ERROR_STOP=1 -q -f "$f" || { echo "FAILED at $f"; exit 1; }
done
```

All 15 migrations (`0000_initial_schema.sql` → `0014_harden_rls.sql`) applied
cleanly. `NOTICE` lines about "already exists, skipping" are expected
idempotency — the migrations use `IF NOT EXISTS` and `DROP POLICY IF EXISTS`.

Migration 0009 creates the non-superuser `byos_app` role and runs
`format('GRANT byos_app TO %I', CURRENT_USER)` — works on local Postgres
because we connect as `b`, the superuser. Managed providers (Supabase/Neon)
need this line edited per the README; not relevant for local.

Verified post-migration state:

```bash
psql -U b -d byos_db -c "\dt"
# → 15 tables in public schema
psql -U b -d byos_db -c "SELECT rolname FROM pg_roles WHERE rolname='byos_app';"
# → byos_app
psql -U b -d byos_db -c "SELECT id FROM \"user\" WHERE id='byos_mono_user';"
# → byos_mono_user (seeded by 0013_seed_mono_user.sql)
```

---

## 6. Dev server smoke-tested

```bash
cd /Users/b/code/byos_next
pnpm dev   # → http://localhost:3000, Ready in ~200ms
```

End-to-end verification:

```bash
# Homepage renders (proves RLS-scoped reads work)
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/
# → 200

# Device registration round-trip (proves scoped write through /api/setup)
curl -sS -H "ID: AA:BB:CC:DD:EE:FF" -H "Model: og" http://localhost:3000/api/setup
# → {"status":200,"api_key":"...","friendly_id":"CQ7MEG",...}

# DB confirms the row was scoped to byos_mono_user
psql -U b -d byos_db -c "SELECT friendly_id, user_id FROM devices WHERE mac_address='AA:BB:CC:DD:EE:FF';"
```

That test row (`CQ7MEG`) is still in the DB — harmless, delete with
`DELETE FROM devices WHERE friendly_id='CQ7MEG';` if you want a clean slate.

---

## 7. OG firmware troubleshooting (reverted)

Real OG kit on firmware **1.5.12** was hitting `/api/display` with HTTP 401.
Diagnosis from the logs: device called `/api/setup` and got back
`{"status":400,"message":"Model header is required"}` (HTTP 200 body, but
status: 400 in the JSON). Setup never created a device row, so subsequent
`/api/display` calls had no `Access-Token` and 401'd.

Root cause: commit `04c3026 Fix api endpoint and biome` had added a
mandatory `Model` header check on `/api/setup`. OG firmware 1.5.12 sends
`Model` on `/api/display` but **not** on `/api/setup`, so the check rejected
every device.

Applied fix in `app/api/setup/route.ts`: default `Model` to `og_png` when
missing, and dropped the 400-reject branch. Real device's first display call
then patched the actual model (`xiao_epaper_display`) onto the row via
`findOrCreateDevice`.

Committed as `426b0b0 fix(api/setup): make Model header optional for OG firmware`,
then **reverted** (`git reset --hard HEAD~1`) at user's request after they
upgraded to firmware 1.6.10. Commit is still in reflog if anyone needs it.

If reproducing this fix later (e.g. supporting any firmware that omits
Model on setup), the diff is in the reflog commit `426b0b0`.

---

## 8. External catalog enabled

Added `ENABLE_EXTERNAL_CATALOG=true` to `.env.local`. Restarted dev server
(env-var changes don't hot-reload):

```bash
pkill -f "next dev"
pnpm dev
```

Verified by re-fetching `/catalog` — page jumped from empty-state to ~370KB
with community recipe content rendered.

---

## 9. Firmware-update gate (UNCOMMITTED — in working tree)

**File:** `app/api/display/route.ts`

The display route was unconditionally telling every connected device to OTA
to `https://trmnl-fw.s3.us-east-2.amazonaws.com/FW<latest>.bin` (currently
`FW1.8.5.bin`, fetched from GitHub `usetrmnl/trmnl-firmware` releases). That
binary is only built for the official TRMNL OG hardware. Flashing it onto
third-party hardware (Seeed Studio Xiao ePaper, Inkplate, Kobo, Kindle,
Waveshare, etc.) will brick the unit.

Wrapped the firmware-update suggestion in a model allow-list:

```ts
const TRMNL_FIRMWARE_MODELS = new Set(["og_png", "og_plus"]);
if (device.model && TRMNL_FIRMWARE_MODELS.has(device.model)) {
  const latestFirmware = await getLatestFirmware();
  if (latestFirmware && isUpdateAvailable(device.firmware_version, latestFirmware.version)) {
    firmwareExtra.update_firmware = true;
    firmwareExtra.firmware_url = latestFirmware.downloadUrl;
    // ...
  }
}
```

Verified the user's `xiao_epaper_display` now gets `update_firmware: false`
in the response.

This change is **not committed** — `git status` shows it as a modified file.
To keep it: `git add app/api/display/route.ts && git commit -m "..."`.
To drop it: `git checkout app/api/display/route.ts`.

---

## Recreating from scratch

If wiping and starting over:

```bash
# 1. Bring up local Postgres
brew services start postgresql@16
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
createdb -U b byos_db

# 2. Env
cat > .env.local <<'EOF'
DATABASE_URL=postgres://b@localhost:5432/byos_db?sslmode=disable
AUTH_ENABLED=false
NODE_ENV=development
ENABLE_EXTERNAL_CATALOG=true
EOF

# 3. Migrations
cd migrations
for f in $(ls *.sql | sort); do
  psql -U b -d byos_db -v ON_ERROR_STOP=1 -q -f "$f" || break
done
cd ..

# 4. Run
pnpm install
pnpm dev
```

To wipe and rerun: `dropdb -U b byos_db && createdb -U b byos_db` and repeat
step 3.

---

## Things deliberately left alone

- `package-lock.json` (untracked) — this project uses pnpm; the file appeared
  from some other tool. Don't commit it.
- `.claude/` (untracked) — Claude Code local project settings; safe to keep
  out of git.
