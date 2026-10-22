# syntax=docker/dockerfile:1.7

# Managed NAC v0 is intentionally linux/amd64-only. The platform-specific
# Debian manifest prevents an accidental cross-architecture publication.
FROM --platform=linux/amd64 debian:trixie-slim@sha256:4876fdea29cac1a33a3195f1eb1952feb1fca7dd6dd00be3e2f1879cf20d34d2 AS build

ARG RUST_VERSION=1.98.0
ARG RUSTUP_VERSION=1.29.0
ARG RUSTUP_SHA256=4acc9acc76d5079515b46346a485974457b5a79893cfb01112423c89aeb5aa10
ARG NAC_BUILD_TRACK=dev
ARG NAC_BUILD_ID
ARG NAC_SOURCE_REVISION

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
RUN NAC_BUILD_TRACK="${NAC_BUILD_TRACK}" \
    NAC_BUILD_ID="${NAC_BUILD_ID}" \
    NAC_SOURCE_REVISION="${NAC_SOURCE_REVISION}" \
    cargo build --release --locked -p nac-server --bin nac-web

FROM --platform=linux/amd64 debian:trixie-slim@sha256:4876fdea29cac1a33a3195f1eb1952feb1fca7dd6dd00be3e2f1879cf20d34d2 AS runtime

ARG NODE_VERSION=24.22.1
ARG NODE_SHA256=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6
ARG GO_VERSION=1.27.3
ARG GO_SHA256=65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40
ARG GH_VERSION=2.103.0
ARG GH_SHA256=fdd768eb70f6409f80fcfa9f3a1c0adf0fc98d827ab3ce0bed2ac22762c5d786
ARG GIT_LFS_VERSION=3.8.0
ARG GIT_LFS_MODULE_SUM=h1:D0WiUyq5J3ZOv/9bvCcPToHqHF+WIQQKF5BK8bxlc5o=
ARG NPM_VERSION=11.21.1
ARG NPM_SHA256=dd77c48eb845f4856c2cdba347cfb52bd877a2655a1ea48ff0c4796e3df9dd7b
ARG UV_VERSION=0.13.4
ARG UV_SHA256=2b428396f12572d4429cf210ca234dd599a33b3af0958a4d5ed569d63e3f344f

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
    && curl --proto '=https' --tlsv1.2 -fsSLo /tmp/npm.tgz \
        "https://registry.npmjs.org/npm/-/npm-${NPM_VERSION}.tgz" \
    && echo "${NPM_SHA256}  /tmp/npm.tgz" | sha256sum -c - \
    && rm -rf /usr/local/lib/node_modules/npm \
    && mkdir -p /usr/local/lib/node_modules/npm \
    && tar -xzf /tmp/npm.tgz -C /usr/local/lib/node_modules/npm --strip-components=1 \
    && rm /tmp/npm.tgz \
    && corepack enable \
    && curl --proto '=https' --tlsv1.2 -fsSLo /tmp/gh.tar.gz \
        "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
    && echo "${GH_SHA256}  /tmp/gh.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/gh.tar.gz -C /usr/local --strip-components=1 \
    && rm /tmp/gh.tar.gz \
    && curl --proto '=https' --tlsv1.2 -fsSLo /tmp/go.tar.gz \
        "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" \
    && echo "${GO_SHA256}  /tmp/go.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/go.tar.gz -C /usr/local \
    && rm /tmp/go.tar.gz \
    && test "$(GOTOOLCHAIN=local GOPATH=/tmp/nac-lfs-build /usr/local/go/bin/go mod download -json \
        "github.com/git-lfs/git-lfs/v3@v${GIT_LFS_VERSION}" | jq -r .Sum)" = "$GIT_LFS_MODULE_SUM" \
    && GOTOOLCHAIN=local CGO_ENABLED=0 GOPATH=/tmp/nac-lfs-build \
        GOCACHE=/tmp/nac-lfs-cache GOBIN=/usr/local/bin \
        /usr/local/go/bin/go install "github.com/git-lfs/git-lfs/v3@v${GIT_LFS_VERSION}" \
    && install -d /usr/local/share/licenses/git-lfs \
    && cp "/tmp/nac-lfs-build/pkg/mod/github.com/git-lfs/git-lfs/v3@v${GIT_LFS_VERSION}/LICENSE.md" \
        /usr/local/share/licenses/git-lfs/LICENSE.md \
    && rm -rf /tmp/nac-lfs-build /tmp/nac-lfs-cache \
    && git lfs install --system --skip-repo \
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
COPY docker/managed/check-process-capabilities.sh /usr/local/libexec/nac/check-process-capabilities

RUN chmod 0555 /usr/local/bin/nac-web /usr/local/bin/nac-managed-entrypoint /usr/local/libexec/nac/check-process-capabilities \
    && chmod -R a+rX /usr/local/rustup /usr/local/cargo/bin \
    && rustc --version \
    && cargo --version \
    && rustfmt --version \
    && cargo-clippy --version \
    && git lfs version \
    && node --version \
    && npm --version \
    && corepack --version \
    && go version \
    && uv --version

# Keep LFS filters outside HOME, which is replaced by a persistent mount.
# The system installation above remains available after dropping privileges.
USER 10001:10001
WORKDIR /repositories
EXPOSE 3210 3211
VOLUME ["/var/lib/nac", "/repositories", "/home/nac", "/etc/nac", "/tmp", "/run/nac"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/nac-managed-entrypoint"]
