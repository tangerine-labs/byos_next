#!/bin/sh
set -e

if [ -n "$POSTGRES_PASSWORD" ]; then
	export DATABASE_URL="$(node -e "console.log('postgres://postgres:'+encodeURIComponent(process.env.POSTGRES_PASSWORD)+'@postgres:5432/byos_db?sslmode=disable')")"
fi

exec node server.js
