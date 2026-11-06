#!/bin/sh
# Container entrypoint: apply migrations, optionally load the demo church, then run the website and the worker.
set -e
echo "Waiting for the database..."
i=0
until node -e "require('postgres')(process.env.DATABASE_ADMIN_URL)\`select 1\`.then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; do
  i=$((i+1)); [ "$i" -gt 60 ] && { echo "The database didn't start in time."; exit 1; }
  sleep 1
done
npx tsx scripts/migrate.ts
if [ "$SEED_DEMO" = "1" ]; then npx tsx scripts/seed.ts; fi
npx tsx scripts/worker.ts &
exec npx next start -p "${PORT:-3000}"
