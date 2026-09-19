FROM rust:1-bookworm AS build
WORKDIR /src
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=build /src/target/release/relay /usr/local/bin/relay
EXPOSE 443
CMD ["relay"]
