package model

import "time"

type Setting struct {
	Key       string    `json:"key"`
	Namespace string    `json:"namespace"`
	Value     string    `json:"value"`
	ValueType string    `json:"value_type"`
	Version   int       `json:"version"`
	UpdatedAt time.Time `json:"updated_at"`
}
