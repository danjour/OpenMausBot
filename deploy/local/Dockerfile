ARG BASE_IMAGE=ghcr.io/milind-soni/openmausbot:latest
FROM ${BASE_IMAGE}
USER root
# Hub spokes: the VPS computer runs `docker -H ssh://<alias>` from the omb
# container, but the base image ships neither binary. Static docker client
# (no daemon/repo) + openssh-client, versions pinned to match the host.
ARG DOCKER_STATIC_VERSION=29.8.2
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssh-client \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_STATIC_VERSION}.tgz -o /tmp/docker.tgz \
 && tar -xzf /tmp/docker.tgz -C /tmp \
 && install -m 0755 /tmp/docker/docker /usr/local/bin/docker \
 && rm -rf /tmp/docker /tmp/docker.tgz \
 && docker --version | grep -qF "${DOCKER_STATIC_VERSION}" \
 && ssh -V
# GitHub on the brain: agents shells out to git over SSH (`id_ed25519_git`)
# and to `gh` for PRs/issues. Static gh binary, version pinned.
ARG GH_VERSION=v2.102.0
RUN curl -fsSL https://github.com/cli/cli/releases/download/${GH_VERSION}/gh_${GH_VERSION#v}_linux_amd64.tar.gz -o /tmp/gh.tgz \
 && tar -xzf /tmp/gh.tgz -C /tmp \
 && install -m 0755 /tmp/gh_${GH_VERSION#v}_linux_amd64/bin/gh /usr/local/bin/gh \
 && rm -rf /tmp/gh /tmp/gh.tgz \
 && gh --version | grep -qF "${GH_VERSION#v}"
RUN if [ -n "$ENGINES" ]; then npm install -g $ENGINES; fi
# Grok Build from xAI's own installer, pinned and installed the same way as
# the Cloud image (the Dockerfile's cloud-home target); it signs in from the
# app with a device code into ~/.grok on the data volume. GROK_VERSION= leaves
# it out.
ARG GROK_VERSION=1.0.41
RUN if [ -n "$GROK_VERSION" ]; then \
      mkdir -p /tmp/grok-install \
      && curl -fsSL https://x.ai/cli/install.sh -o /tmp/grok-install/install.sh \
      && HOME=/tmp/grok-install PATH="/tmp/grok-install/.grok/bin:$PATH" bash /tmp/grok-install/install.sh "$GROK_VERSION" \
      && install -m 0755 "$(readlink -f /tmp/grok-install/.grok/bin/grok)" /usr/local/bin/grok \
      && HOME=/tmp/grok-install grok --version | grep -qF "grok $GROK_VERSION " \
      && rm -rf /tmp/grok-install; \
    fi
USER maus
