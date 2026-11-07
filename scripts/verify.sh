#!/bin/sh
# Runs what is available locally; skipped toolchains are explicitly reported.
set -eu
cd "$(dirname "$0")/.."
FAIL=0
if command -v cargo >/dev/null 2>&1;then
  (cd apps/server && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test) || FAIL=1
  [ -z "${DATABASE_URL_TEST:-}" ] && echo 'NOTE: DATABASE_URL_TEST unset; database-backed tests were skipped'
else echo 'SKIP Rust build: cargo unavailable';fi
if command -v npm >/dev/null 2>&1;then
  if [ -d apps/web/node_modules ];then (cd apps/web && npm run format:check && npm run lint && npm test && npm run build) || FAIL=1
  else echo 'SKIP web production build: dependencies not installed';fi
else echo 'SKIP web build: npm unavailable';fi
if command -v flutter >/dev/null 2>&1;then
  (cd apps/mobile && flutter pub get && flutter analyze) || FAIL=1
else echo 'SKIP mobile analysis: Flutter SDK unavailable';fi
if command -v python3 >/dev/null 2>&1;then
  python3 -m py_compile scripts/seed_demo.py tests/smoke.py
else echo 'SKIP Python scripts: python3 unavailable';fi
exit "$FAIL"
