# ------------------------------------------------------------------------------
# Production-Ready Rust Dockerfile
# ------------------------------------------------------------------------------
# 1. Multi-stage build for minimal runtime image
# 2. Non-root user for security
# 3. Debian Slim for stability and small size
# ------------------------------------------------------------------------------

# Stage 1: Builder
FROM rust:1.94-bookworm AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    perl \
    make \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the application source
# We copy the subdir directly to the workdir for a clean build
COPY apps/sidecar .

# Build the application in release mode
RUN cargo build --release --bin sidecar

# Stage 2: Runtime
FROM debian:bookworm-slim AS runtime

# Security: Create a non-root user
RUN groupadd -g 10001 sidecar && \
    useradd -u 10001 -g sidecar -s /bin/sh sidecar

WORKDIR /app

# Install runtime dependencies (OpenSSL is vendored but CA certs are needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy the compiled binary from the builder
COPY --from=builder /app/target/release/sidecar /app/sidecar

# Set ownership and permissions
RUN chown sidecar:sidecar /app/sidecar && \
    chmod 755 /app/sidecar

# Switch to non-root user
USER sidecar

# Expose the default sidecar port
EXPOSE 32359

ENTRYPOINT ["/app/sidecar"]
