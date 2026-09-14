SHELL := /bin/bash
PNPM ?= npx --yes pnpm@10.15.1
DB_MODE ?= bundled
FAMILYFI_IMAGE ?= ghcr.io/nberardi/familyfi:latest
COMPOSE := docker compose -f docker-compose.yml
ifeq ($(DB_MODE),bundled)
COMPOSE += -f docker-compose.bundled.yml
endif
WITH_ENV := node scripts/with-env.mjs

.PHONY: setup dev test test-api spike lint typecheck build \
	docker-build docker-dev-up docker-up docker-down docker-logs db-dev

setup:
	corepack enable >/dev/null 2>&1 || true
	$(PNPM) install
	@if [ ! -f .env ]; then cp .env.example .env; echo "wrote .env — set DEFAULT_PASSWORD, SESSION_SECRET, APP_ENCRYPTION_KEY, and DB_PASSWORD"; fi
	@if command -v docker >/dev/null 2>&1; then \
		docker compose -f docker-compose.dev-db.yml up -d; \
		$(WITH_ENV) ./node_modules/.bin/prisma migrate deploy; \
	else \
		echo "Docker is not available. Start PostgreSQL yourself, then run: make db-migrate"; \
	fi
	$(WITH_ENV) ./node_modules/.bin/prisma generate

db-migrate:
	$(WITH_ENV) ./node_modules/.bin/prisma migrate deploy

dev:
	$(PNPM) dev

test:
	$(PNPM) test

test-api:
	$(PNPM) test-api

spike:
	$(PNPM) spike

lint:
	$(PNPM) lint

typecheck:
	$(PNPM) typecheck

build:
	$(PNPM) build

docker-build:
	docker build -t familyfi:dev .

docker-dev-up:
	FAMILYFI_IMAGE=familyfi:dev $(COMPOSE) -f docker-compose.dev.yml up -d --build

docker-up:
	FAMILYFI_IMAGE=$(FAMILYFI_IMAGE) $(COMPOSE) up -d

docker-down:
	$(COMPOSE) down

docker-logs:
	$(COMPOSE) logs -f

db-dev:
	docker compose -f docker-compose.dev-db.yml up -d
