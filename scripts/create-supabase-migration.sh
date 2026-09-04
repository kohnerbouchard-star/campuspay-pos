#!/usr/bin/env sh
set -eu

command -v supabase >/dev/null 2>&1 || {
  echo "Supabase CLI is required." >&2
  exit 1
}

supabase --help >/dev/null
supabase migration new campuspay_initial_schema
LATEST="$(find supabase/migrations -type f -name '*_campuspay_initial_schema.sql' | sort | tail -n 1)"
cat supabase/bootstrap.sql > "$LATEST"
echo "Created $LATEST"
