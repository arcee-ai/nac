.PHONY: all build release install test test-rust test-assets check fmt clippy clean help

CARGO ?= cargo
PKG := nac-server
BIN := nac-web

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

test-assets:
	node --check crates/nac-server/assets/app.js
	node --test crates/nac-server/assets/app.test.js

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
		'  release      Build nac-web (release)' \
		'  install      Install nac-web into $$INSTALL_ROOT/bin (~/.local)' \
		'  test         Run Rust tests and web asset checks' \
		'  test-rust    Run cargo test --workspace --locked' \
		'  test-assets  Check/run Node web asset tests' \
		'  check        Run cargo check --workspace --locked' \
		'  fmt          Run rustfmt' \
		'  clippy       Run clippy (CLIPPY_ARGS=-D warnings to fail on lints)' \
		'  clean        Remove target/ artifacts' \
		'  help         Show this help'
