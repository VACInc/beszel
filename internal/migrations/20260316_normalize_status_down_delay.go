package migrations

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		statusAlerts, err := app.FindRecordsByFilter(
			"alerts",
			"name = {:name} && min < {:min}",
			"",
			-1,
			0,
			dbx.Params{"name": statusDownMigrationName, "min": defaultStatusMigrationMin},
		)
		if err != nil {
			return err
		}

		for _, statusAlert := range statusAlerts {
			statusAlert.Set("min", defaultStatusMigrationMin)
			if err := app.Save(statusAlert); err != nil {
				return err
			}
		}

		return nil
	}, nil)
}
