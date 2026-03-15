package migrations

import (
	"database/sql"
	"errors"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

const (
	statusDownMigrationName         = "Status"
	statusOnlineMigrationName       = "StatusOnline"
	defaultStatusMigrationMin       = 1
	defaultStatusOnlineMigrationMin = 0
)

func init() {
	m.Register(func(app core.App) error {
		alertsCollection, err := app.FindCollectionByNameOrId("alerts")
		if err != nil {
			return err
		}

		nameField, ok := alertsCollection.Fields.GetByName("name").(*core.SelectField)
		if !ok {
			return errors.New("alerts.name is not a select field")
		}

		hasStatusOnline := false
		for _, value := range nameField.Values {
			if value == statusOnlineMigrationName {
				hasStatusOnline = true
				break
			}
		}
		if !hasStatusOnline {
			nameField.Values = append(nameField.Values, statusOnlineMigrationName)
			if err := app.Save(alertsCollection); err != nil {
				return err
			}
		}

		statusAlerts, err := app.FindRecordsByFilter(
			"alerts",
			"name = {:name}",
			"",
			-1,
			0,
			dbx.Params{"name": statusDownMigrationName},
		)
		if err != nil {
			return err
		}

		for _, statusAlert := range statusAlerts {
			onlineAlert, err := app.FindFirstRecordByFilter(
				"alerts",
				"user = {:user} && system = {:system} && name = {:name}",
				dbx.Params{
					"user":   statusAlert.GetString("user"),
					"system": statusAlert.GetString("system"),
					"name":   statusOnlineMigrationName,
				},
			)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}

			if onlineAlert == nil {
				onlineAlert = core.NewRecord(alertsCollection)
				onlineAlert.Set("user", statusAlert.GetString("user"))
				onlineAlert.Set("system", statusAlert.GetString("system"))
				onlineAlert.Set("name", statusOnlineMigrationName)
				onlineAlert.Set("value", 0)
				onlineAlert.Set("min", defaultStatusOnlineMigrationMin)
				if err := app.Save(onlineAlert); err != nil {
					return err
				}
			}

			statusAlert.Set("min", max(defaultStatusMigrationMin, statusAlert.GetInt("min")))
			statusAlert.Set("value", 0)
			if err := app.Save(statusAlert); err != nil {
				return err
			}
		}

		statusOnlineAlerts, err := app.FindRecordsByFilter(
			"alerts",
			"name = {:name}",
			"",
			-1,
			0,
			dbx.Params{"name": statusOnlineMigrationName},
		)
		if err != nil {
			return err
		}

		for _, onlineAlert := range statusOnlineAlerts {
			statusAlert, err := app.FindFirstRecordByFilter(
				"alerts",
				"user = {:user} && system = {:system} && name = {:name}",
				dbx.Params{
					"user":   onlineAlert.GetString("user"),
					"system": onlineAlert.GetString("system"),
					"name":   statusDownMigrationName,
				},
			)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if statusAlert != nil {
				continue
			}

			statusAlert = core.NewRecord(alertsCollection)
			statusAlert.Set("user", onlineAlert.GetString("user"))
			statusAlert.Set("system", onlineAlert.GetString("system"))
			statusAlert.Set("name", statusDownMigrationName)
			statusAlert.Set("min", defaultStatusMigrationMin)
			statusAlert.Set("value", 0)
			if err := app.Save(statusAlert); err != nil {
				return err
			}
		}

		return nil
	}, nil)
}
