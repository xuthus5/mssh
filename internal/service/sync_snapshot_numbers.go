package service

import (
	"encoding/json"
	"fmt"
)

func normalizeSnapshotNumbers(data *ExportData) error {
	for table, rows := range data.Tables {
		for rowIndex, row := range rows {
			for column, value := range row {
				normalized, err := normalizeSnapshotNumber(value)
				if err != nil {
					return fmt.Errorf(
						"decode snapshot: table %s row %d column %s: %w",
						table, rowIndex, column, err,
					)
				}
				row[column] = normalized
			}
		}
	}
	return nil
}

func normalizeSnapshotNumber(value any) (any, error) {
	number, ok := value.(json.Number)
	if !ok {
		return value, nil
	}
	integer, err := number.Int64()
	if err != nil {
		return nil, fmt.Errorf("database number must be a signed 64-bit integer")
	}
	return integer, nil
}
