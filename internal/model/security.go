package model

// SecurityStatus describes the application password / vault state for the UI.
type SecurityStatus struct {
	Configured              bool   `json:"configured"`
	Unlocked                bool   `json:"unlocked"`
	RequirePasswordOnLaunch bool   `json:"require_password_on_launch"`
	RememberUnlock          bool   `json:"remember_unlock"`
	UpdatedAt               string `json:"updated_at"`
}

type SecuritySetupInput struct {
	Password                string `json:"password"`
	RequirePasswordOnLaunch bool   `json:"require_password_on_launch"`
	RememberUnlock          bool   `json:"remember_unlock"`
}

type SecurityUnlockInput struct {
	Password       string `json:"password"`
	RememberUnlock bool   `json:"remember_unlock"`
}

type SecurityRotateInput struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

type SecurityPreferenceInput struct {
	RequirePasswordOnLaunch bool `json:"require_password_on_launch"`
	RememberUnlock          bool `json:"remember_unlock"`
}
