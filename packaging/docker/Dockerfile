FROM node:22-bookworm-slim

ARG AUROWORK_ORCHESTRATOR_VERSION=0.11.22

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    tar \
    unzip \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g "aurowork-orchestrator@${AUROWORK_ORCHESTRATOR_VERSION}"

# Persistent directories (mount volumes here on PaaS/SSH).
ENV AUROWORK_DATA_DIR=/data/aurowork-orchestrator
ENV AUROWORK_SIDECAR_DIR=/data/sidecars

# The workspace is mounted from the host/volume.
ENV AUROWORK_WORKSPACE=/workspace

# AuroWork host contract surface.
EXPOSE 8787

# Optional: opencode-router health (only relevant if you enable the router).
EXPOSE 3005

VOLUME ["/workspace", "/data"]

# Defaults:
# - AuroWork server is published intentionally via --remote-access
# - OpenCode stays internal (127.0.0.1:4096)
# - AuroWork server proxies OpenCode via localhost
# - OpenCode Router disabled by default
CMD [
  "aurowork",
  "serve",
  "--workspace", "/workspace",
  "--remote-access",
  "--aurowork-port", "8787",
  "--opencode-host", "127.0.0.1",
  "--opencode-port", "4096",
  "--connect-host", "127.0.0.1",
  "--cors", "*",
  "--approval", "manual",
  "--no-opencode-router"
]
