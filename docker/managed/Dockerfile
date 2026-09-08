# syntax=docker/dockerfile:1.7

# Managed NAC v0 is intentionally linux/amd64-only. The platform-specific
# Debian manifest prevents an accidental cross-architecture publication.
FROM --platform=linux/amd64 debian:bookworm-slim@sha256:5ae3c39ebd15e229dcedd5cee596b2497182493d41ff162e824ba13fc1b2b867 AS build

ARG RUST_VERSION=1.98.0
ARG RUSTUP_VERSION=1.29.0
ARG RUSTUP_SHA256=4acc9acc76d5079515b46346a485974457b5a79893cfb01112423c89aeb5aa10

ENV CARGO_HOME=/usr/local/cargo \
    RUSTUP_HOME=/usr/local/rustup \
    PATH=/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN test "$(dpkg --print-architecture)" = amd64 \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        cmake \
        curl \
        git \
        libssl-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/* \
    && curl --proto '=https' --tlsv1.2 -fsSLo /tmp/rustup-init \
        "https://static.rust-lang.org/rustup/archive/${RUSTUP_VERSION}/x86_64-unknown-linux-gnu/rustup-init" \
    && echo "${RUSTUP_SHA256}  /tmp/rustup-init" | sha256sum -c - \
    && chmod 0755 /tmp/rustup-init \
    && /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain "${RUST_VERSION}" \
    && rm /tmp/rustup-init \
    && rustup component add rustfmt clippy \
    && rustc --version \
    && cargo --version

WORKDIR /src/nac
COPY . .
RUN cargo build --release --locked -p nac-server --bin nac-web

FROM --platform=linux/amd64 debian:bookworm-slim@sha256:5ae3c39ebd15e229dcedd5cee596b2497182493d41ff162e824ba13fc1b2b867 AS runtime

ARG NODE_VERSION=24.20.0
ARG NODE_SHA256=2f2c0da162318f0de47665410c7c8c2ed3d36c8f3105de4bbc61176c70a7cbf2
ARG GO_VERSION=1.27.0
ARG GO_SHA256=675c26c449cbb18fc24b74650de1eabbae6e16f64326fd85a283fb3b58280685
ARG UV_VERSION=0.12.1
ARG UV_SHA256=90b2f223fb69d19db49e117da601f64978593417988530aa733d456141b4bcbb

ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    HOME=/home/nac \
    NAC_HOME=/var/lib/nac \
    CARGO_HOME=/home/nac/.cargo \
    RUSTUP_HOME=/usr/local/rustup \
    GOPATH=/home/nac/go \
    TMPDIR=/tmp \
    PATH=/usr/local/cargo/bin:/usr/local/go/bin:/home/nac/go/bin:/home/nac/.cargo/bin:/home/nac/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN test "$(dpkg --print-architecture)" = amd64 \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        bash \
        binutils \
        build-essential \
        ca-certificates \
        cmake \
        coreutils \
        curl \
        fd-find \
        findutils \
        gh \
        git \
        gzip \
        jq \
        libssl-dev \
        make \
        openssh-client \
        pkg-config \
        procps \
        python3 \
        python3-pip \
        python3-venv \
        ripgrep \
        rsync \
        tar \
        tini \
        unzip \
        xz-utils \
        zip \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/fdfind /usr/local/bin/fd \
    && curl --proto '=https' --tlsv1.2 -fsSLo /tmp/node.tar.xz \
        "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && corepack enable \
    && curl --proto '=https' --tlsv1.2 -fsSLo /tmp/go.tar.gz \
        "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" \
    && echo "${GO_SHA256}  /tmp/go.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/go.tar.gz -C /usr/local \
    && rm /tmp/go.tar.gz \
    && curl --proto '=https' --tlsv1.2 -fsSLo /tmp/uv.tar.gz \
        "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz" \
    && echo "${UV_SHA256}  /tmp/uv.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/uv.tar.gz -C /usr/local/bin --strip-components=1 \
    && rm /tmp/uv.tar.gz \
    && groupadd --gid 10001 nac \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/nac --shell /bin/bash nac \
    && install -d -o 10001 -g 10001 -m 0700 /var/lib/nac \
    && install -d -o 10001 -g 10001 -m 0755 /repositories /run/nac /run/secrets/nac \
    && install -d -o 10001 -g 10001 -m 0755 /etc/nac \
    && install -d -o 10001 -g 10001 -m 1777 /tmp \
    && install -d -o 10001 -g 10001 -m 0755 /home/nac/.cargo /home/nac/.local /home/nac/go

COPY --from=build /usr/local/rustup /usr/local/rustup
COPY --from=build /usr/local/cargo/bin /usr/local/cargo/bin
COPY --from=build /src/nac/target/release/nac-web /usr/local/bin/nac-web
COPY docker/managed/entrypoint.sh /usr/local/bin/nac-managed-entrypoint

RUN chmod 0555 /usr/local/bin/nac-web /usr/local/bin/nac-managed-entrypoint \
    && chmod -R a+rX /usr/local/rustup /usr/local/cargo/bin \
    && rustc --version \
    && cargo --version \
    && rustfmt --version \
    && cargo-clippy --version \
    && node --version \
    && npm --version \
    && corepack --version \
    && go version \
    && uv --version

USER 10001:10001
WORKDIR /repositories
EXPOSE 3210
VOLUME ["/var/lib/nac", "/repositories", "/home/nac", "/etc/nac", "/tmp", "/run/nac"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/nac-managed-entrypoint"]
