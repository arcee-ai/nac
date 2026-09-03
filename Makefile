.PHONY: all setup build dev demo linked release install ci test test-rust test-web test-source-size generate-api-contract test-api-contract test-assets test-e2e test-durability test-managed-image-contract managed-image test-managed-image check lint fix format-check fmt crate-check crate-test crate-build clean help

CARGO ?= cargo
PKG := nac-server
BIN := nac-web
WEB_DIR := crates/$(PKG)/web
MANAGED_IMAGE ?= nac-managed:local

DEV_BIND ?= 127.0.0.1:3210
DEV_URL ?= http://$(DEV_BIND)/
DEV_STORE_PATH ?=
DEMO_STORE_PATH ?= $(HOME)/.config/nac/dev.db
LINKED_STORE_PATH ?= $(HOME)/.config/nac/linked-allison-demo.db

ifeq ($(shell uname -s),Darwin)
BROWSER_OPEN ?= open
else
BROWSER_OPEN ?= xdg-open
endif

export DEV_BIND DEV_URL DEV_STORE_PATH BROWSER_OPEN


# Matches the location used by scripts/install.sh ($(INSTALL_ROOT)/bin).
INSTALL_ROOT ?= $(HOME)/.local

# Default target
all: build

## Prepare a fresh worktree with all locked development dependencies
setup:
	@command -v "$(CARGO)" >/dev/null 2>&1 || { \
		printf '%s\n' 'error: make setup requires Cargo; install Rust from https://rustup.rs'; \
		exit 1; \
	}
	@command -v npm >/dev/null 2>&1 || { \
		printf '%s\n' 'error: make setup requires npm; install Node.js from https://nodejs.org'; \
		exit 1; \
	}
	$(CARGO) fetch --locked
	npm --prefix $(WEB_DIR) ci
	npm --prefix $(WEB_DIR) exec -- playwright install chromium

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
		if [ -n "$$DEV_STORE_PATH" ]; then \
			set -- --store-path "$$DEV_STORE_PATH"; \
		else \
			set --; \
		fi; \
		$(CARGO) run --locked -p $(PKG) --bin $(BIN) -- --bind "$$DEV_BIND" "$$@" & \
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

## Rebuild the production bundle, then run with an isolated development store
demo:
	npm --prefix $(WEB_DIR) run build
	$(MAKE) dev DEV_STORE_PATH="$(DEMO_STORE_PATH)"

## Run with an isolated allison-runtime store (does not migrate store.db)
linked:
	$(MAKE) dev DEV_STORE_PATH="$(LINKED_STORE_PATH)"

## Build the nac-web binary (release)
release:
	$(CARGO) build --release --locked -p $(PKG) --bin $(BIN)

## Install nac-web into $(INSTALL_ROOT)/bin
install:
	$(CARGO) install --path crates/$(PKG) --bin $(BIN) --locked --force --root $(INSTALL_ROOT)

## Run portable formatting, lint, unit, and asset gates (release CI also runs test-e2e)
ci: format-check lint test

## Run workspace Rust tests, frontend tests, source-size, and web asset checks
test: test-source-size test-rust test-web test-assets test-managed-image-contract

test-rust:
	$(CARGO) test --workspace --locked

## Run frontend unit and component tests
test-web:
	npm --prefix $(WEB_DIR) test

## Keep tracked human-authored files within the agent-context budget
test-source-size:
	bash scripts/check-source-size.sh

## Regenerate the checked-in OpenAPI document and frontend schema types
generate-api-contract:
	$(CARGO) run --locked -p nac-server --example export-openapi -- $(WEB_DIR)/openapi.json
	npm --prefix $(WEB_DIR) run generate:api

## Fail when Rust routes/schemas and checked-in frontend contract types drift
test-api-contract:
	$(CARGO) run --locked -p nac-server --example export-openapi -- --check $(WEB_DIR)/openapi.json
	npm --prefix $(WEB_DIR) run check:api

# Mirrors the release workflow: the bundle under assets/dist is committed, so a
# stale one has to fail here rather than in CI.
test-assets: test-api-contract
	npm --prefix $(WEB_DIR) run lint
	npm --prefix $(WEB_DIR) run typecheck
	npm --prefix $(WEB_DIR) run build
	@if [ -n "$$(git status --porcelain -- crates/$(PKG)/assets/dist)" ]; then \
		printf '%s\n' "error: crates/$(PKG)/assets/dist is stale; commit the rebuilt bundle"; \
		git status --porcelain -- crates/$(PKG)/assets/dist; \
		exit 1; \
	fi

## Run production-embedded Playwright tests with an isolated scripted provider
test-e2e:
	npm --prefix $(WEB_DIR) run build
	$(CARGO) build --locked -p $(PKG) --bin $(BIN)
	NAC_E2E_BINARY="$(CURDIR)/target/debug/$(BIN)" npm --prefix $(WEB_DIR) run test:e2e

## Run focused deterministic lifecycle and crash-window regressions
test-durability:
	$(CARGO) test --locked -p nac-core cancellation_adopts_a_committed_single_direct_steer_after_async_abort
	$(CARGO) test --locked -p nac-core canonical_terminal_recovery_is_retained_until_relationship_settlement
	$(CARGO) test --locked -p nac-core child_terminal_crash_window_recovers_report_and_delivers_once
	$(CARGO) test --locked -p nac-core child_pre_prompt_crash_is_interrupted_and_delivered_once_after_restart
	$(CARGO) test --locked -p nac-core shared_store_recovery_after_peer_crash_preserves_committed_transcript
	$(CARGO) test --locked -p nac-server parent_deletion_excludes_late_child_relationship_commit
	$(CARGO) test --locked -p nac-server managed_monitor_treats_peer_lease_as_live
	$(CARGO) test --locked -p nac-server managed_binding_failure_precedes_run_and_prompt_execution
	$(CARGO) test --locked -p nac-server parent_attachment_settles_canonical_managed_terminal_once_after_restart
	$(CARGO) test --locked -p nac-server wrong_parent_relationship_reads_are_opaque_not_found

## Check the managed image/workflow contract without a container runtime
test-managed-image-contract:
	sh -n docker/managed/entrypoint.sh
	sh -n scripts/smoke-managed-image.sh
	sh -n scripts/test-managed-image-contract.sh
	sh scripts/test-managed-image-contract.sh

## Build the linux/amd64 managed image with Docker or Podman
managed-image:
	@runtime="$${CONTAINER_RUNTIME:-}"; \
	if [ -z "$$runtime" ]; then \
		if command -v docker >/dev/null 2>&1; then runtime=docker; \
		elif command -v podman >/dev/null 2>&1; then runtime=podman; \
		else printf '%s\n' 'error: managed-image requires Docker or Podman'; exit 2; fi; \
	fi; \
	"$$runtime" build --platform linux/amd64 --file docker/managed/Dockerfile --tag "$(MANAGED_IMAGE)" .

## Build and smoke the managed image, including readiness/restart/SIGTERM
test-managed-image:
	MANAGED_IMAGE="$(MANAGED_IMAGE)" sh scripts/smoke-managed-image.sh

## Check source ownership size and type-check without producing binaries
check: test-source-size
	$(CARGO) check --workspace --locked

## Lint frontend and production Rust targets
lint:
	npm --prefix $(WEB_DIR) run lint
	$(CARGO) clippy --workspace --locked --lib --bins -- -D warnings

## Apply machine-safe Rust lint fixes, then format the workspace
fix:
	$(CARGO) clippy --workspace --locked --lib --bins --fix --allow-dirty --allow-staged
	$(CARGO) fmt --all

## Check frontend and Rust formatting
format-check:
	npm --prefix $(WEB_DIR) run format:check
	$(CARGO) fmt --all -- --check

## Format frontend and Rust sources
fmt:
	npm --prefix $(WEB_DIR) run format
	$(CARGO) fmt --all

## Format-check and lint one crate: make crate-check CRATE=nac-core
crate-check:
	@test -n "$(CRATE)" || { printf '%s\n' 'error: set CRATE, e.g. make crate-check CRATE=nac-core'; exit 2; }
	$(CARGO) fmt --package $(CRATE) -- --check
	$(CARGO) clippy --locked --package $(CRATE) --lib --bins -- -D warnings

## Test one crate: make crate-test CRATE=nac-core
crate-test:
	@test -n "$(CRATE)" || { printf '%s\n' 'error: set CRATE, e.g. make crate-test CRATE=nac-core'; exit 2; }
	$(CARGO) test --locked --package $(CRATE)

## Build one crate: make crate-build CRATE=nac-core
crate-build:
	@test -n "$(CRATE)" || { printf '%s\n' 'error: set CRATE, e.g. make crate-build CRATE=nac-core'; exit 2; }
	$(CARGO) build --locked --package $(CRATE)

## Remove build artifacts
clean:
	$(CARGO) clean

## Show available targets
help:
	@printf '%s\n' \
		'Usage: make [target]' \
		'' \
		'Targets:' \
		'  setup        Install locked Rust/web dependencies and Playwright Chromium' \
		'  build        Build nac-web (debug) [default]' \
		'  dev          Build and run nac-web, then open it in the default browser' \
		'  demo         Rebuild production assets and run with ~/.config/nac/dev.db' \
		'  linked       Run with ~/.config/nac/linked-allison-demo.db (this branch)' \
		'  release      Build nac-web (release)' \
		'  install      Install nac-web into $$INSTALL_ROOT/bin (~/.local)' \
		'  ci           Run formatting, lint, and test gates' \
		'  test         Run Rust/frontend tests and web asset checks' \
		'  test-rust    Run cargo test --workspace --locked' \
		'  test-web     Run frontend unit and component tests' \
		'  test-source-size Enforce the 2,000-line human-source ceiling' \
		'  test-assets  Lint, typecheck and rebuild the web app' \
		'  test-e2e     Run production-embedded Playwright tests' \
		'  test-durability Run focused lifecycle/crash-window regressions' \
		'  test-managed-image-contract Check managed image/workflow statically' \
		'  managed-image Build the linux/amd64 managed developer image' \
		'  test-managed-image Build and smoke the managed image locally' \
		'  check        Run cargo check --workspace --locked' \
		'  lint         Lint frontend and production Rust targets' \
		'  fix          Apply safe Rust lint fixes and format Rust sources' \
		'  format-check Check frontend and Rust formatting' \
		'  fmt          Format frontend and Rust sources' \
		'  crate-check  Format-check and lint $$CRATE' \
		'  crate-test   Test $$CRATE' \
		'  crate-build  Build $$CRATE' \
		'  clean        Remove target/ artifacts' \
		'  help         Show this help'
