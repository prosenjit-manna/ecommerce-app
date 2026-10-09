# Rover + the supergraph composition plugin, so nothing has to be installed on the host.
# Used by the `supergraph` compose service. Rebuild after a version bump:
#   podman compose --profile apps up -d --build supergraph
FROM docker.io/library/debian:13-slim

ARG ROVER_VERSION=v0.41.0
# Keep in sync with federation_version in ../supergraph.yaml.
ARG SUPERGRAPH_VERSION=v2.15.4

ENV APOLLO_ELV2_LICENSE=accept \
    APOLLO_TELEMETRY_DISABLED=true \
    PATH=/root/.rover/bin:$PATH

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Install the plugin at build time: composing needs no network at runtime and is reproducible.
RUN curl -sSL "https://rover.apollo.dev/nix/${ROVER_VERSION}" | sh \
 && rover install --plugin "supergraph@${SUPERGRAPH_VERSION}"

COPY --chmod=0755 watch-compose.sh /usr/local/bin/watch-compose.sh

ENTRYPOINT ["/usr/local/bin/watch-compose.sh"]
