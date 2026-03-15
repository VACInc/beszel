package alerts

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const (
	defaultStatusDelayMinutes       uint8   = 1
	defaultStatusOnlineDelayMinutes float64 = 0
)

func getPairedStatusAlertName(name string) string {
	switch name {
	case statusDownAlertName:
		return statusOnlineAlertName
	case statusOnlineAlertName:
		return statusDownAlertName
	default:
		return ""
	}
}

func getDefaultAlertSettings(name string) (uint8, float64) {
	switch name {
	case statusDownAlertName:
		return defaultStatusDelayMinutes, 0
	case statusOnlineAlertName:
		return 0, defaultStatusOnlineDelayMinutes
	default:
		return 0, 0
	}
}

func normalizeAlertSettings(name string, min uint8, value float64) (uint8, float64) {
	switch name {
	case statusDownAlertName:
		return max(uint8(1), min), 0
	case statusOnlineAlertName:
		return 0, max(0.0, value)
	default:
		return min, value
	}
}

func findUserAlert(app core.App, alertsCollection *core.Collection, userID string, systemID string, name string) (*core.Record, error) {
	alertRecord, err := app.FindFirstRecordByFilter(
		alertsCollection,
		"system={:system} && name={:name} && user={:user}",
		dbx.Params{"system": systemID, "name": name, "user": userID},
	)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	return alertRecord, nil
}

func ensurePairedStatusAlert(app core.App, alertsCollection *core.Collection, userID string, systemID string, name string) error {
	pairedName := getPairedStatusAlertName(name)
	if pairedName == "" {
		return nil
	}

	pairedAlert, err := findUserAlert(app, alertsCollection, userID, systemID, pairedName)
	if err != nil {
		return err
	}
	if pairedAlert != nil {
		return nil
	}

	defaultMin, defaultValue := getDefaultAlertSettings(pairedName)
	pairedAlert = core.NewRecord(alertsCollection)
	pairedAlert.Set("user", userID)
	pairedAlert.Set("system", systemID)
	pairedAlert.Set("name", pairedName)
	pairedAlert.Set("min", defaultMin)
	pairedAlert.Set("value", defaultValue)

	return app.SaveNoValidate(pairedAlert)
}

// UpsertUserAlerts handles API request to create or update alerts for a user
// across multiple systems (POST /api/beszel/user-alerts)
func UpsertUserAlerts(e *core.RequestEvent) error {
	userID := e.Auth.Id

	reqData := struct {
		Min       uint8    `json:"min"`
		Value     float64  `json:"value"`
		Name      string   `json:"name"`
		Systems   []string `json:"systems"`
		Overwrite bool     `json:"overwrite"`
	}{}
	err := e.BindBody(&reqData)
	if err != nil || userID == "" || reqData.Name == "" || len(reqData.Systems) == 0 {
		return e.BadRequestError("Bad data", err)
	}

	alertsCollection, err := e.App.FindCachedCollectionByNameOrId("alerts")
	if err != nil {
		return err
	}

	err = e.App.RunInTransaction(func(txApp core.App) error {
		for _, systemId := range reqData.Systems {
			min, value := normalizeAlertSettings(reqData.Name, reqData.Min, reqData.Value)
			alertRecord, err := findUserAlert(txApp, alertsCollection, userID, systemId, reqData.Name)
			if err != nil {
				return err
			}

			if reqData.Overwrite || alertRecord == nil {
				if alertRecord == nil {
					alertRecord = core.NewRecord(alertsCollection)
					alertRecord.Set("user", userID)
					alertRecord.Set("system", systemId)
					alertRecord.Set("name", reqData.Name)
				}

				alertRecord.Set("value", value)
				alertRecord.Set("min", min)

				if err := txApp.SaveNoValidate(alertRecord); err != nil {
					return err
				}
			}

			if err := ensurePairedStatusAlert(txApp, alertsCollection, userID, systemId, reqData.Name); err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		return err
	}

	return e.JSON(http.StatusOK, map[string]any{"success": true})
}

// DeleteUserAlerts handles API request to delete alerts for a user across multiple systems
// (DELETE /api/beszel/user-alerts)
func DeleteUserAlerts(e *core.RequestEvent) error {
	userID := e.Auth.Id

	reqData := struct {
		AlertName string   `json:"name"`
		Systems   []string `json:"systems"`
	}{}
	err := e.BindBody(&reqData)
	if err != nil || userID == "" || reqData.AlertName == "" || len(reqData.Systems) == 0 {
		return e.BadRequestError("Bad data", err)
	}

	var numDeleted uint16

	err = e.App.RunInTransaction(func(txApp core.App) error {
		for _, systemId := range reqData.Systems {
			// Find existing alert to delete
			alertRecord, err := txApp.FindFirstRecordByFilter("alerts",
				"system={:system} && name={:name} && user={:user}",
				dbx.Params{"system": systemId, "name": reqData.AlertName, "user": userID})

			if err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					// alert doesn't exist, continue to next system
					continue
				}
				return err
			}

			if err := txApp.Delete(alertRecord); err != nil {
				return err
			}
			numDeleted++
		}
		return nil
	})

	if err != nil {
		return err
	}

	return e.JSON(http.StatusOK, map[string]any{"success": true, "count": numDeleted})
}
