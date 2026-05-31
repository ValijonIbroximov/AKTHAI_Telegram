# Fayl: server/Dockerfile
# Maqsad: Go server ikki bosqichli (multi-stage) tarzda qurib, kichik tasvirga joylanadi.

# 1-bosqich: manba kod kompilyatsiya qilinadi
FROM golang:1.22-alpine AS builder
WORKDIR /src

# Qaramliklar avval keshlanadi (qatlam keshidan foydalanish uchun)
COPY go.mod go.sum* ./
RUN go mod download

# Manba kod nusxalanadi va statik binar quriladi
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/lokal-server ./cmd/server

# 2-bosqich: minimal ishga tushirish tasviri tayyorlanadi
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 appuser
WORKDIR /app

# Binar va migratsiyalar nusxalanadi
COPY --from=builder /out/lokal-server /app/lokal-server
COPY db/migrations /app/db/migrations

USER appuser
EXPOSE 8443
ENTRYPOINT ["/app/lokal-server", "/app/config.yaml"]
