FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=build /src/target/release/signal /usr/local/bin/signal
EXPOSE 8081
CMD ["signal"]
