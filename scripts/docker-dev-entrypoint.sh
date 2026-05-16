#!/bin/sh
set -e

if [ -n "$POSTGRES_PASSWORD" ]; then
	export DATABASE_URL="$(node -e "console.log('postgres://postgres:'+encodeURIComponent(process.env.POSTGRES_PASSWORD)+'@postgres:5432/byos_db?sslmode=disable')")"
fi

cd /app

pnpm generate:sql
exec pnpm exec next dev --turbopack -H 0.0.0.0
