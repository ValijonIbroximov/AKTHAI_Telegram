// Fayl: server/internal/config/config.go
// Maqsad: YAML konfiguratsiya fayli o'qilib, struktura sifatida qaytariladi.
package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

// Config — butun server uchun yagona konfiguratsiya konteyneri.
type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	Redis    RedisConfig    `yaml:"redis"`
	Auth     AuthConfig     `yaml:"auth"`
	Limits   LimitsConfig   `yaml:"limits"`
}

// ServerConfig — tinglash manzili va TLS sozlamalari.
type ServerConfig struct {
	BindAddress string    `yaml:"bind_address"`
	TLS         TLSConfig `yaml:"tls"`
}

// TLSConfig — shifrlangan kanal uchun sertifikat yo'llari.
type TLSConfig struct {
	Enabled  bool   `yaml:"enabled"`
	CertFile string `yaml:"cert_file"`
	KeyFile  string `yaml:"key_file"`
}

// DatabaseConfig — PostgreSQL ulanish satri va hovuz cheklovlari.
type DatabaseConfig struct {
	DSN          string `yaml:"dsn"`
	MaxOpenConns int    `yaml:"max_open_conns"`
	MaxIdleConns int    `yaml:"max_idle_conns"`
}

// RedisConfig — Redis ulanish parametrlari.
type RedisConfig struct {
	Addr     string `yaml:"addr"`
	Password string `yaml:"password"`
	DB       int    `yaml:"db"`
}

// AuthConfig — autentifikatsiya va parol xeshlash parametrlari.
type AuthConfig struct {
	JWTSecretFile    string       `yaml:"jwt_secret_file"`
	AccessTTLMinutes int          `yaml:"access_ttl_minutes"`
	Argon2           Argon2Params `yaml:"argon2"`
}

// Argon2Params — parol xeshlash kuchi sozlamalari.
// Bu tip yagona joyda (config paketida) e'lon qilinadi va auth paketi
// tomonidan import qilinadi (import sikli bo'lmasligi uchun).
type Argon2Params struct {
	Memory      uint32 `yaml:"memory_kb"`
	Iterations  uint32 `yaml:"iterations"`
	Parallelism uint8  `yaml:"parallelism"`
	SaltLength  uint32 `yaml:"salt_length"`
	KeyLength   uint32 `yaml:"key_length"`
}

// LimitsConfig — xabar va fayl hajmlari hamda tezlik cheklovlari.
type LimitsConfig struct {
	MaxMessageSizeBytes int64 `yaml:"max_message_size_bytes"`
	MaxFileSizeBytes    int64 `yaml:"max_file_size_bytes"`
	RateLoginPer5Min    int   `yaml:"rate_login_per_5min"`
}

// Load — konfiguratsiya fayli diskdan o'qilib, struktura sifatida qaytariladi.
func Load(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := yaml.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}
