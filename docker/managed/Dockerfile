# syntax=docker/dockerfile:1.7

# Managed NAC v0 is intentionally linux/amd64-only. The platform-specific
# Wolfi manifest prevents an accidental cross-architecture publication.
# Owned package builds retain exact upstream source, correction and notice evidence.
FROM --platform=linux/amd64 cgr.dev/chainguard/wolfi-base@sha256:76811b6958657eb28da6f2ce79bbb97516e5818df442a086e94ab4c67303608b AS build

ARG RUST_VERSION=1.98.0
ARG RUSTUP_VERSION=1.29.0
ARG RUSTUP_SHA256=4acc9acc76d5079515b46346a485974457b5a79893cfb01112423c89aeb5aa10
ARG NAC_BUILD_TRACK=dev
ARG NAC_BUILD_ID
ARG NAC_SOURCE_REVISION

ENV CARGO_HOME=/usr/local/cargo \
    RUSTUP_HOME=/usr/local/rustup \
    PATH=/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN test "$(apk --print-arch)" = x86_64 \
    && apk upgrade --no-cache \
    && apk add --no-cache \
        build-base ca-certificates-bundle cmake curl git gnutar xz \
        openssl-dev=3.6.5-r5 pkgconf \
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

FROM --platform=linux/amd64 cgr.dev/chainguard/wolfi-base@sha256:76811b6958657eb28da6f2ce79bbb97516e5818df442a086e94ab4c67303608b AS runtime-package-sdk
RUN apk upgrade --no-cache && apk add --no-cache build-base autoconf automake bison flex \
    ca-certificates-bundle curl git gnutar gzip xz patch python3 jq perl pkgconf \
    e2fsprogs-dev keyutils-dev krb5-conf krb5-dev libverto-dev openldap-2.6-dev=2.6.14-r0 openssl-dev=3.6.5-r5
FROM runtime-package-sdk AS runtime-packages
COPY docker/managed/packages/sources.lock.json docker/managed/packages/fetch-sources.sh /recipe/
RUN sh /recipe/fetch-sources.sh
COPY docker/managed/packages/build-krb5.sh docker/managed/packages/krb5-libraries.list /recipe/
RUN sh /recipe/build-krb5.sh
COPY docker/managed/packages/build-curl.sh /recipe/
RUN sh /recipe/build-curl.sh
COPY docker/managed/packages/build-sasl.sh /recipe/
RUN sh /recipe/build-sasl.sh
COPY docker/managed/packages/build-gcc-headers.sh /recipe/
RUN sh /recipe/build-gcc-headers.sh
COPY docker/managed/packages/package-runtime-apk.py docker/managed/packages/check-supplier-packages.py /recipe/
RUN python3 /recipe/package-runtime-apk.py /recipe/sources.lock.json \
    && cp /recipe/* /out/ \
    && cd /out && sha256sum ./*.apk > packages.sha256

FROM --platform=linux/amd64 cgr.dev/chainguard/wolfi-base@sha256:76811b6958657eb28da6f2ce79bbb97516e5818df442a086e94ab4c67303608b AS runtime

ARG NODE_VERSION=24.22.1
ARG NODE_SHA256=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6
ARG GO_VERSION=1.27.3
ARG GO_SHA256=65efbc80fdc1fa2cd2631cad5b481777a68e8725f34e89f50fc6ac714e379b40
ARG GH_VERSION=2.103.0
ARG GH_SHA256=fdd768eb70f6409f80fcfa9f3a1c0adf0fc98d827ab3ce0bed2ac22762c5d786
ARG GIT_LFS_VERSION=3.8.0
ARG GIT_LFS_MODULE_SUM=h1:D0WiUyq5J3ZOv/9bvCcPToHqHF+WIQQKF5BK8bxlc5o=
ARG GIT_LFS_REVISION=aece9221f8c09221a14395d964806b956289bc07
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

COPY docker/managed/git-lfs/go.mod docker/managed/git-lfs/go.sum /tmp/nac-lfs-dependencies/
COPY --from=runtime-packages /out/ /usr/share/nac/runtime-package-build/
COPY docker/managed/packages/brotli-supplier.lock.json /usr/share/nac/
COPY docker/managed/packages/npm-bundle.lock.json docker/managed/packages/correct-npm-bundle.py docker/managed/packages/npm-bundle-probe.cjs /usr/share/nac/npm-runtime-build/

RUN test "$(apk --print-arch)" = x86_64 \
    && apk upgrade --no-cache \
    && apk add --no-cache \
        bash binutils build-base ca-certificates-bundle cmake coreutils \
        gcc=16.2.0-r1 libgcc=16.2.0-r1 libstdc++=16.2.0-r1 libstdc++-dev=16.2.0-r1 \
        krb5-libs=1.22.2-r5 cyrus-sasl-heimdal-libs=2.1.28-r58 \
        curl=8.23.0-r1 libcurl-openssl4=8.23.0-r1 fd findutils git gzip jq libssh2 openssl-dev=3.6.5-r5 make \
        openssh-client pkgconf procps python-3.13=3.13.16_git20261016-r1 \
        py3-pip=26.2.2-r0 ripgrep rsync gnutar tini unzip xz zip shadow perl util-linux libxml2 py3-setuptools \
        zlib=1.3.2.1_rc20260921-r0 \
        libbrotlicommon1=1.2.1-r2 libbrotlidec1=1.2.1-r2 libbrotlienc1=1.2.1-r2 \
    && cd /usr/share/nac/runtime-package-build \
    && sha256sum -c packages.sha256 \
    && python3 check-supplier-packages.py sources.lock.json > supplier-predecessors.json \
    && apk --no-network --repositories-file /dev/null add --no-cache --allow-untrusted ./*.apk \
    && test -x /usr/bin/fd \
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
    && python3 /usr/share/nac/npm-runtime-build/correct-npm-bundle.py \
        /usr/share/nac/npm-runtime-build /usr/local/lib/node_modules/npm \
    && corepack enable \
    && curl --proto '=https' --tlsv1.2 -fsSLo /tmp/gh.tar.gz \
        "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
    && echo "${GH_SHA256}  /tmp/gh.tar.gz" | sha256sum -c - \
    && mkdir /tmp/nac-gh \
    && tar -xzf /tmp/gh.tar.gz -C /tmp/nac-gh --strip-components=1 \
    && install -m 0755 /tmp/nac-gh/bin/gh /usr/local/bin/gh \
    && cp -R /tmp/nac-gh/share/. /usr/local/share/ \
    && install -d /usr/local/share/licenses/gh \
    && cp /tmp/nac-gh/LICENSE /usr/local/share/licenses/gh/LICENSE \
    && rm -rf /tmp/nac-gh /tmp/gh.tar.gz \
    && curl --proto '=https' --tlsv1.2 -fsSLo /tmp/go.tar.gz \
        "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" \
    && echo "${GO_SHA256}  /tmp/go.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/go.tar.gz -C /usr/local \
    && rm /tmp/go.tar.gz \
    && XDG_CONFIG_HOME=/tmp/nac-lfs-config GOTOOLCHAIN=local /usr/local/go/bin/go telemetry off \
    && test "$(XDG_CONFIG_HOME=/tmp/nac-lfs-config GOTOOLCHAIN=local /usr/local/go/bin/go env GOTELEMETRY)" = off \
    && test "$(XDG_CONFIG_HOME=/tmp/nac-lfs-config GOTOOLCHAIN=local GOPATH=/tmp/nac-lfs-build /usr/local/go/bin/go mod download -json \
        "github.com/git-lfs/git-lfs/v3@v${GIT_LFS_VERSION}" | jq -r .Sum)" = "$GIT_LFS_MODULE_SUM" \
    && XDG_CONFIG_HOME=/tmp/nac-lfs-config GOTOOLCHAIN=local CGO_ENABLED=0 GOPATH=/tmp/nac-lfs-build GOCACHE=/tmp/nac-lfs-cache \
        /usr/local/go/bin/go -C "/tmp/nac-lfs-build/pkg/mod/github.com/git-lfs/git-lfs/v3@v${GIT_LFS_VERSION}" \
        build -mod=readonly -modfile=/tmp/nac-lfs-dependencies/go.mod -trimpath \
        -ldflags "-X github.com/git-lfs/git-lfs/v3/config.GitCommit=${GIT_LFS_REVISION}" \
        -o /usr/local/bin/git-lfs . \
    && install -d /usr/local/share/licenses/git-lfs \
    && cp "/tmp/nac-lfs-build/pkg/mod/github.com/git-lfs/git-lfs/v3@v${GIT_LFS_VERSION}/LICENSE.md" \
        /usr/local/share/licenses/git-lfs/LICENSE.md \
    && XDG_CONFIG_HOME=/tmp/nac-lfs-config GOTOOLCHAIN=local GOPATH=/tmp/nac-lfs-build \
        /usr/local/go/bin/go -C "/tmp/nac-lfs-build/pkg/mod/github.com/git-lfs/git-lfs/v3@v${GIT_LFS_VERSION}" \
        list -mod=readonly -modfile=/tmp/nac-lfs-dependencies/go.mod -m -json all > /tmp/nac-lfs-modules.json \
    && jq -r 'select(.Dir != null) | [.Path, .Dir] | @tsv' /tmp/nac-lfs-modules.json > /tmp/nac-lfs-notices \
    && test -s /tmp/nac-lfs-notices \
    && while IFS="$(printf '\t')" read -r module module_dir; do \
        notice_dir="/usr/local/share/licenses/git-lfs/modules/$module"; \
        mkdir -p "$notice_dir"; \
        for notice in LICENSE LICENSE.md LICENSE.txt COPYING NOTICE PATENTS AUTHORS; do \
            if [ -f "$module_dir/$notice" ]; then cp "$module_dir/$notice" "$notice_dir/$notice"; fi; \
        done; \
    done < /tmp/nac-lfs-notices \
    && rm /tmp/nac-lfs-notices /tmp/nac-lfs-modules.json \
    && rm -rf /tmp/nac-lfs-build /tmp/nac-lfs-cache /tmp/nac-lfs-dependencies /tmp/nac-lfs-config \
    && git lfs install --system --skip-repo \
    && curl --proto '=https' --tlsv1.2 -fsSLo /tmp/uv.tar.gz \
        "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz" \
    && echo "${UV_SHA256}  /tmp/uv.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/uv.tar.gz -C /usr/local/bin --strip-components=1 \
    && rm /tmp/uv.tar.gz \
    && groupadd --gid 10001 nac \
    && useradd --uid 10001 --gid 10001 --create-home --home-dir /home/nac --shell /bin/bash nac \
    && install -d -o 10001 -g 10001 -m 0755 /home/nac \
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
COPY docker/managed/packages/collect-runtime-provenance.py /usr/local/libexec/nac/collect-runtime-provenance.py

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
    && XDG_CONFIG_HOME=/tmp/nac-go-check GOTOOLCHAIN=local go telemetry off \
    && test "$(XDG_CONFIG_HOME=/tmp/nac-go-check GOTOOLCHAIN=local go env GOTELEMETRY)" = off \
    && XDG_CONFIG_HOME=/tmp/nac-go-check GOTOOLCHAIN=local go version \
    && rm -rf /tmp/nac-go-check \
    && uv --version \
    && test "$(stat -c '%u:%g' /home/nac)" = 10001:10001 \
    && python3 /usr/local/libexec/nac/collect-runtime-provenance.py

# Keep LFS filters outside HOME, which is replaced by a persistent mount.
# The system installation above remains available after dropping privileges.
USER 10001:10001
WORKDIR /repositories
EXPOSE 3210 3211
VOLUME ["/var/lib/nac", "/repositories", "/home/nac", "/etc/nac", "/tmp", "/run/nac"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/nac-managed-entrypoint"]
