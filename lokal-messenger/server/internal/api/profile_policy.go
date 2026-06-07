// Profil maydonlarini tahrirlash ruxsatlari (admin boshqaradi).
package api

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
)

const profilePolicyKey = "profile_edit_policy"

// Barcha profil maydonlari — admin panelda toggle qilinadi.
var profileFieldKeys = []string{
	"display_name", "display_short", "rank_title",
	"unit_code", "unit_name", "okrug_name", "okrug_code",
	"division_name", "division_code", "avatar",
}

func defaultProfilePolicy() map[string]bool {
	return map[string]bool{
		"display_name":  true,
		"display_short": false,
		"rank_title":    false,
		"unit_code":     false,
		"unit_name":     false,
		"okrug_name":    false,
		"okrug_code":    false,
		"division_name": false,
		"division_code": false,
		"avatar":        true,
	}
}

func getProfileEditPolicy(ctx context.Context, db *pgxpool.Pool) (map[string]bool, error) {
	out := defaultProfilePolicy()
	var raw []byte
	err := db.QueryRow(ctx, `SELECT value FROM app_config WHERE key = $1`, profilePolicyKey).Scan(&raw)
	if err != nil {
		return out, nil
	}
	var parsed map[string]bool
	if json.Unmarshal(raw, &parsed) == nil {
		for _, k := range profileFieldKeys {
			if v, ok := parsed[k]; ok {
				out[k] = v
			}
		}
	}
	return out, nil
}

func setProfileEditPolicy(ctx context.Context, db *pgxpool.Pool, policy map[string]bool) error {
	merged := defaultProfilePolicy()
	for _, k := range profileFieldKeys {
		if v, ok := policy[k]; ok {
			merged[k] = v
		}
	}
	raw, err := json.Marshal(merged)
	if err != nil {
		return err
	}
	_, err = db.Exec(ctx, `
		INSERT INTO app_config (key, value, updated_at)
		VALUES ($1, $2::jsonb, NOW())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
	`, profilePolicyKey, raw)
	return err
}
