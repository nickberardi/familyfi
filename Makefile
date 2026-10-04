SHELL := /bin/bash
PNPM ?= npx --yes pnpm@10.15.1
FAMILYFI_IMAGE ?= ghcr.io/nickberardi/familyfi:latest
COMPOSE := docker compose -p familyfi --env-file .env -f docker/docker-compose.yml
WITH_ENV := node scripts/runtime/with-env.mjs
# Tests and checks run through one harness; these targets are aliases for it (scripts/README.md).
TEST := scripts/test.py

.PHONY: setup hooks dev release test test-unit test-coverage test-api test-api-breaking test-api-version test-integration test-browser test-mutation spike lint typecheck build \
	docker-build docker-dev-up docker-up docker-down docker-logs docker-smoke db-dev db-drift db-upgrade secrets

setup:
	corepack enable >/dev/null 2>&1 || true
	$(PNPM) install
	@if [ ! -f .env ]; then cp .env.example .env; echo "wrote .env — set DB_PASSWORD"; fi
	node scripts/runtime/validate-env.mjs
	@if command -v docker >/dev/null 2>&1; then \
		docker compose -p familyfi --env-file .env -f docker/docker-compose.dev-db.yml up -d --wait; \
		i=0; \
		until $(WITH_ENV) ./node_modules/.bin/prisma migrate deploy; do \
			i=$$((i + 1)); \
			if [ "$$i" -ge 20 ]; then echo "database was not ready for migrations after 40s" >&2; exit 1; fi; \
			echo "waiting for PostgreSQL…"; \
			sleep 2; \
		done; \
	else \
		echo "Docker is not available. Start PostgreSQL yourself, then run: make db-migrate"; \
	fi
	$(WITH_ENV) ./node_modules/.bin/prisma generate
	git config core.hooksPath .githooks

hooks:
	git config core.hooksPath .githooks

db-migrate:
	$(WITH_ENV) ./node_modules/.bin/prisma migrate deploy

db-drift:
	$(TEST) check db-drift

db-upgrade:
	$(TEST) check db-upgrade

dev:
	node scripts/runtime/ensure-dev-port.mjs 3000
	$(PNPM) dev

# Build, push and publish a release from this machine, e.g. RELEASE_ARGS="--tag v0.12.1".
release:
	scripts/release.sh $(RELEASE_ARGS)

test:
	$(TEST) run --platform host

test-unit:
	$(TEST) run --platform host --layer unit

test-coverage:
	$(TEST) run --platform host --coverage

test-integration:
	$(TEST) run --layer integration

test-api:
	$(TEST) check api

test-api-breaking:
	$(TEST) check api-breaking

test-api-version:
	$(TEST) check api-version

# CI's browser job: a production build, then desktop and phone, each against its own database.
test-browser:
	$(TEST) run --layer ui

# Weekly in CI, and by hand. Report: reports/mutation/index.html.
test-mutation:
	$(TEST) check mutation

spike:
	$(PNPM) spike -- $(SPIKE_ARGS)

lint:
	$(TEST) check lint

typecheck:
	$(TEST) check typecheck

build:
	$(PNPM) build

docker-build:
	docker build -f docker/Dockerfile -t familyfi:dev .

docker-dev-up:
	@if [ ! -f .env ]; then cp .env.example .env; echo "wrote .env — set DB_PASSWORD"; fi
	node scripts/runtime/validate-env.mjs
	FAMILYFI_IMAGE=familyfi:dev $(COMPOSE) -f docker/docker-compose.dev.yml up -d --build

docker-up:
	@if [ ! -f .env ]; then cp .env.example .env; echo "wrote .env — set DB_PASSWORD"; fi
	node scripts/runtime/validate-env.mjs
	FAMILYFI_IMAGE=$(FAMILYFI_IMAGE) $(COMPOSE) up -d

docker-down:
	$(COMPOSE) down

docker-logs:
	$(COMPOSE) logs -f

docker-smoke:
	$(MAKE) docker-build
	FAMILYFI_IMAGE=familyfi:dev sh scripts/ci/check-image.sh familyfi:dev
	FAMILYFI_IMAGE=familyfi:dev sh scripts/ci/container-smoke.sh

db-dev:
	docker compose -p familyfi --env-file .env -f docker/docker-compose.dev-db.yml up -d --wait

secrets:
	node scripts/runtime/gen-secrets.mjs
