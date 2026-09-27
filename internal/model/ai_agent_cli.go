package model

import "time"

// Prompt delivery modes for a user-registered custom Agent CLI.
const (
	AIAgentPromptStdin = "stdin"
	AIAgentPromptArg   = "arg"
)

// AICustomCLI describes a user-registered local Agent CLI. A custom CLI is only
// a launcher: it must be configured (outside MSSH) with the MSSH MCP server it
// talks to. Args and Env support the {workdir} and {prompt} placeholders, and ID
// is how a task selects this entry ("custom:<id>").
type AICustomCLI struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Command    string   `json:"command"`
	Args       []string `json:"args"`
	Env        []string `json:"env"`
	PromptMode string   `json:"prompt_mode"`
	VersionArg string   `json:"version_arg"`
}

type AIAgentCLIStatus struct {
	Name       string    `json:"name"`
	Command    string    `json:"command"`
	Installed  bool      `json:"installed"`
	Path       string    `json:"path"`
	Version    string    `json:"version"`
	Error      string    `json:"error"`
	DetectedAt time.Time `json:"detected_at"`
}
