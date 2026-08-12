.PHONY: all build dev release install test test-rust test-web test-assets check-file-icons check fmt clippy clean help

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

# The workspace is not clippy-clean yet, so lints are advisory by default.
# Run `make clippy CLIPPY_ARGS='-D warnings'` to fail on them.
CLIPPY_ARGS ?=

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

## Run workspace Rust tests and web validation
# Keep test-web exactly once in this dependency list; test-assets intentionally
# covers only lint, typechecking, and committed-bundle freshness.
test: test-rust test-web test-assets

test-rust:
	$(CARGO) test --workspace --locked

## Run frontend unit tests
test-web:
	npm --prefix $(WEB_DIR) test

# Mirrors the release workflow: generated frontend sources and the bundle under
# assets/dist are committed, so stale output has to fail here rather than in CI.
test-assets: check-file-icons
	npm --prefix $(WEB_DIR) run lint
	npm --prefix $(WEB_DIR) run typecheck
	npm --prefix $(WEB_DIR) run build
	@if [ -n "$$(git status --porcelain --untracked-files=all -- crates/$(PKG)/assets/dist)" ]; then \
		printf '%s\n' "error: crates/$(PKG)/assets/dist is stale; commit the rebuilt bundle"; \
		git status --porcelain --untracked-files=all -- crates/$(PKG)/assets/dist; \
		exit 1; \
	fi

FILE_ICON_OUTPUTS := crates/$(PKG)/web/src/app/atoms/file-icon/icons \
	crates/$(PKG)/web/src/app/atoms/file-icon/manifest.generated.ts

## Regenerate file icons and require their committed outputs to be fresh
check-file-icons:
	npm --prefix $(WEB_DIR) run sync-file-icons
	@if [ -n "$$(git status --porcelain --untracked-files=all -- $(FILE_ICON_OUTPUTS))" ]; then \
		printf '%s\n' "error: generated file icons are stale; run 'npm --prefix $(WEB_DIR) run sync-file-icons' and commit the outputs"; \
		git status --porcelain --untracked-files=all -- $(FILE_ICON_OUTPUTS); \
		exit 1; \
	fi

## Type-check the workspace without producing binaries
check:
	$(CARGO) check --workspace --locked

## Format Rust sources
fmt:
	$(CARGO) fmt --all

## Lint with clippy
clippy:
	$(CARGO) clippy --workspace --locked --all-targets -- $(CLIPPY_ARGS)

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
		'  test         Run Rust tests and all web validation' \
		'  test-rust    Run cargo test --workspace --locked' \
		'  test-web     Run frontend unit tests' \
		'  test-assets  Check generated icons, lint, typecheck and rebuild the web app' \
		'  check-file-icons  Regenerate file icons and verify committed outputs' \
		'  check        Run cargo check --workspace --locked' \
		'  fmt          Run rustfmt' \
		'  clippy       Run clippy (CLIPPY_ARGS=-D warnings to fail on lints)' \
		'  clean        Remove target/ artifacts' \
		'  help         Show this help'
