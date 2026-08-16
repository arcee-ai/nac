.PHONY: all build dev release install test test-rust test-assets check lint format-check fmt clean help

CARGO ?= cargo
PKG := nac-server
BIN := nac-web
WEB_DIR := crates/$(PKG)/web

DEV_BIND ?= 127.0.0.1:3210
DEV_URL ?= http://$(DEV_BIND)/

ifeq ($(shell uname -s),Darwin)
BROWSER_OPEN ?= open
else
BROWSER_OPEN ?= xdg-open
endif

export DEV_BIND DEV_URL BROWSER_OPEN


# Matches the location used by scripts/install.sh ($(INSTALL_ROOT)/bin).
INSTALL_ROOT ?= $(HOME)/.local

# Default target
all: build

## Build the nac-web binary (debug)
build:
	$(CARGO) build --locked -p $(PKG) --bin $(BIN)

## Build and run nac-web, then open it in the default browser
dev:
	@command -v curl >/dev/null 2>&1 || { \
			printf '%s\n' 'error: make dev requires curl'; \
			exit 1; \
		}; \
		command -v "$$BROWSER_OPEN" >/dev/null 2>&1 || { \
			printf 'error: make dev requires %s\n' "$$BROWSER_OPEN"; \
			exit 1; \
		}; \
		if curl -fsS --noproxy '*' --connect-timeout 1 --max-time 2 -- "$${DEV_URL}health" >/dev/null 2>&1; then \
			printf 'error: NAC is already responding at %s\n' "$$DEV_URL"; \
			exit 1; \
		fi; \
		$(CARGO) run --locked -p $(PKG) --bin $(BIN) -- --bind "$$DEV_BIND" & \
		server_pid=$$!; \
		trap 'kill "$$server_pid" 2>/dev/null || true' EXIT; \
		trap 'exit 130' INT TERM; \
		until curl -fsS --noproxy '*' --connect-timeout 1 --max-time 2 -- "$${DEV_URL}health" >/dev/null 2>&1; do \
			if ! kill -0 "$$server_pid" 2>/dev/null; then \
				wait "$$server_pid"; \
				exit $$?; \
			fi; \
			sleep 0.1; \
		done; \
		"$$BROWSER_OPEN" "$$DEV_URL" || exit $$?; \
		wait "$$server_pid"

## Build the nac-web binary (release)
release:
	$(CARGO) build --release --locked -p $(PKG) --bin $(BIN)

## Install nac-web into $(INSTALL_ROOT)/bin
install:
	$(CARGO) install --path crates/$(PKG) --bin $(BIN) --locked --force --root $(INSTALL_ROOT)

## Run workspace Rust tests and web asset checks
test: test-rust test-assets

test-rust:
	$(CARGO) test --workspace --locked

# Mirrors the release workflow: the bundle under assets/dist is committed, so a
# stale one has to fail here rather than in CI.
test-assets:
	npm --prefix $(WEB_DIR) run lint
	npm --prefix $(WEB_DIR) run typecheck
	npm --prefix $(WEB_DIR) run build
	@if [ -n "$$(git status --porcelain -- crates/$(PKG)/assets/dist)" ]; then \
		printf '%s\n' "error: crates/$(PKG)/assets/dist is stale; commit the rebuilt bundle"; \
		git status --porcelain -- crates/$(PKG)/assets/dist; \
		exit 1; \
	fi

## Type-check the workspace without producing binaries
check:
	$(CARGO) check --workspace --locked

## Lint frontend and production Rust targets
lint:
	npm --prefix $(WEB_DIR) run lint
	$(CARGO) clippy --workspace --locked --lib --bins -- -D warnings

## Check frontend and Rust formatting
format-check:
	npm --prefix $(WEB_DIR) run format:check
	$(CARGO) fmt --all -- --check

## Format frontend and Rust sources
fmt:
	npm --prefix $(WEB_DIR) run format
	$(CARGO) fmt --all

## Remove build artifacts
clean:
	$(CARGO) clean

## Show available targets
help:
	@printf '%s\n' \
		'Usage: make [target]' \
		'' \
		'Targets:' \
		'  build        Build nac-web (debug) [default]' \
		'  dev          Build and run nac-web, then open it in the default browser' \
		'  release      Build nac-web (release)' \
		'  install      Install nac-web into $$INSTALL_ROOT/bin (~/.local)' \
		'  test         Run Rust tests and web asset checks' \
		'  test-rust    Run cargo test --workspace --locked' \
		'  test-assets  Lint, typecheck and rebuild the web app' \
		'  check        Run cargo check --workspace --locked' \
		'  lint         Lint frontend and production Rust targets' \
		'  format-check Check frontend and Rust formatting' \
		'  fmt          Format frontend and Rust sources' \
		'  clean        Remove target/ artifacts' \
		'  help         Show this help'
