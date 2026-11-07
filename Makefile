.PHONY: manifest up down full-up dev-web dev-api test test-web test-api fmt lint openapi e2e
up:
	docker compose -f infra/docker-compose.yml up -d
down:
	docker compose -f infra/docker-compose.yml down
full-up:
	docker compose -f infra/docker-compose.full.yml up --build -d
dev-api:
	cd apps/server && cargo run
dev-web:
	cd apps/web && npm run dev
# DB-backed tests need DATABASE_URL_TEST pointing at a disposable database.
test-api:
	cd apps/server && cargo test
test-web:
	cd apps/web && npm test && npm run build
test: test-api test-web
fmt:
	cd apps/server && cargo fmt --all
	cd apps/web && npm run format
lint:
	cd apps/server && cargo clippy --all-targets -- -D warnings
	cd apps/web && npm run lint
# Regenerate the checked-in spec and the web client types from the Rust handlers.
openapi:
	cd apps/server && cargo run --quiet -- --openapi > ../../docs/openapi.json
	cd apps/web && npm run gen:api
e2e:
	cd apps/web && npm run e2e
manifest:
	python3 scripts/gen_manifest.py
