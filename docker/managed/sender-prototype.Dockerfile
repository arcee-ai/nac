# Fixture-only target. Both base images must be explicitly selected local builds.
# No normal managed image/startup/enrollment contract is changed by this target.
ARG NAC_SENDER_BUILD_IMAGE
ARG NAC_MANAGED_IMAGE
FROM ${NAC_SENDER_BUILD_IMAGE} AS sender-prototype-build
WORKDIR /src/nac
COPY . .
RUN cargo test --offline --release --locked -p nac-core --lib --no-run \
    && find target/release/deps -maxdepth 1 -type f -name 'nac_core-*' -executable > /tmp/sender-probe-binaries \
    && test "$(wc -l < /tmp/sender-probe-binaries)" -eq 1 \
    && install -m 0555 "$(cat /tmp/sender-probe-binaries)" /tmp/nac-sender-probe

FROM ${NAC_MANAGED_IMAGE} AS sender-prototype
COPY --from=sender-prototype-build /tmp/nac-sender-probe /usr/local/libexec/nac-sender-probe
USER 10001:10001
