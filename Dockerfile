# syntax=docker/dockerfile:1.7

FROM rust:1-bookworm AS builder

WORKDIR /src

ARG NAC_RELEASE_VERSION
ARG NAC_BUILD_REVISION

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates

RUN cargo build --release --locked -p nac-server --bin nac-web && \
    install -Dm0755 target/release/nac-web /out/nac-web

FROM debian:bookworm-slim AS runtime

ARG NAC_BUILD_REVISION=unknown

LABEL org.opencontainers.image.source="https://github.com/arcee-ai/nac" \
      org.opencontainers.image.revision="${NAC_BUILD_REVISION}" \
      org.opencontainers.image.licenses="Apache-2.0"

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      openssh-client \
      python3 \
      ripgrep \
      tini && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --gid 10001 nac && \
    useradd --uid 10001 --gid 10001 --home-dir /nac-home --no-create-home --shell /bin/bash nac && \
    install -d -o nac -g nac -m 0750 /nac-home /repositories

COPY --from=builder /out/nac-web /usr/local/bin/nac-web
COPY LICENSE /usr/share/licenses/nac/LICENSE

ENV HOME=/nac-home \
    NAC_HOME=/nac-home

USER 10001:10001
WORKDIR /repositories

EXPOSE 3210
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD ["curl", "--fail", "--silent", "--show-error", "--noproxy", "*", "--connect-timeout", "1", "--max-time", "2", "http://127.0.0.1:3210/health"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/nac-web"]
CMD ["--bind", "0.0.0.0:3210", "--allow-remote", "--no-open", "--directory", "/repositories"]
