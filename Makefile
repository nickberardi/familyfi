SHELL := /bin/bash
PNPM ?= npx --yes pnpm@10.15.1
FAMILYFI_IMAGE ?= ghcr.io/nberardi/familyfi:latest
COMPOSE := docker compose -p familyfi --env-file .env -f docker/docker-compose.yml
WITH_ENV := node scripts/with-env.mjs

.PHONY: setup dev test test-api test-integration test-browser spike lint typecheck build \
	docker-build docker-dev-up docker-up docker-down docker-logs docker-smoke db-dev secrets

setup:
	corepack enable >/dev/null 2>&1 || true
	$(PNPM) install
	@if [ ! -f .env ]; then cp .env.example .env; echo "wrote .env — set DB_PASSWORD"; fi
	node scripts/validate-env.mjs
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

db-migrate:
	$(WITH_ENV) ./node_modules/.bin/prisma migrate deploy

dev:
	node scripts/ensure-dev-port.mjs 3000
	$(PNPM) dev

test:
	$(PNPM) test
	$(MAKE) test-integration

test-integration:
	DB_NAME=familyfi_test $(PNPM) test:integration

test-api:
	$(PNPM) test-api

test-browser:
	$(PNPM) test:browser

spike:
	$(PNPM) spike -- $(SPIKE_ARGS)

lint:
	$(PNPM) lint

typecheck:
	$(PNPM) typecheck

build:
	$(PNPM) build

docker-build:
	docker build -f docker/Dockerfile -t familyfi:dev .

docker-dev-up:
	FAMILYFI_IMAGE=familyfi:dev $(COMPOSE) -f docker/docker-compose.dev.yml up -d --build

docker-up:
	FAMILYFI_IMAGE=$(FAMILYFI_IMAGE) $(COMPOSE) up -d

docker-down:
	$(COMPOSE) down

docker-logs:
	$(COMPOSE) logs -f

docker-smoke:
	$(MAKE) docker-build
	FAMILYFI_IMAGE=familyfi:dev sh scripts/check-image.sh familyfi:dev
	FAMILYFI_IMAGE=familyfi:dev sh scripts/container-smoke.sh

db-dev:
	docker compose -p familyfi --env-file .env -f docker/docker-compose.dev-db.yml up -d --wait

secrets:
	node scripts/gen-secrets.mjs
