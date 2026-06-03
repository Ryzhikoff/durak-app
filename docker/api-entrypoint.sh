#!/bin/sh
set -e

# Apply pending Prisma migrations before starting the API. Idempotent.
npx --no-install prisma migrate deploy

exec node dist/main.js
