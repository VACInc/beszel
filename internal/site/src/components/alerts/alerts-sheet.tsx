import { t } from "@lingui/core/macro"
import { Plural, Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import { GlobeIcon, ServerIcon } from "lucide-react"
import { lazy, memo, Suspense, useEffect, useMemo, useState } from "react"
import { $router, Link } from "@/components/router"
import { Checkbox } from "@/components/ui/checkbox"
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "@/components/ui/use-toast"
import { alertInfo } from "@/lib/alerts"
import { pb } from "@/lib/api"
import { $alerts, $systems } from "@/lib/stores"
import { cn, debounce } from "@/lib/utils"
import type { AlertInfo, AlertRecord, SystemRecord } from "@/types"

const Slider = lazy(() => import("@/components/ui/slider"))

const endpoint = "/api/beszel/user-alerts"

const alertDebounce = 400

const alertKeys = Object.keys(alertInfo) as (keyof typeof alertInfo)[]
const nonStatusAlertKeys = alertKeys.filter((key) => key !== "Status" && key !== "StatusOnline")
const statusOnlineDelayMaxDays = 7
const defaultStatusDelayMinutes = 1
const defaultStatusOnlineDelayMinutes = 0

const statusOnlineDelaySteps = [
	...Array.from({ length: 61 }, (_, index) => index),
	...Array.from({ length: 22 }, (_, index) => (index + 2) * 60),
	...Array.from({ length: statusOnlineDelayMaxDays }, (_, index) => (index + 1) * 24 * 60),
]

function clampStatusDownDelay(delay: number) {
	const roundedDelay = Number.isFinite(delay) ? Math.round(delay) : defaultStatusDelayMinutes
	return Math.min(60, Math.max(defaultStatusDelayMinutes, roundedDelay))
}

function clampStatusOnlineDelay(delay: number) {
	if (delay <= 0) {
		return 0
	}
	if (delay <= 60) {
		return Math.round(delay)
	}
	if (delay < 24 * 60) {
		return Math.min(23 * 60, Math.max(120, Math.round(delay / 60) * 60))
	}
	return Math.min(statusOnlineDelayMaxDays * 24 * 60, Math.max(24 * 60, Math.round(delay / (24 * 60)) * 24 * 60))
}

function getStatusOnlineDelayIndex(delay: number) {
	const clampedDelay = clampStatusOnlineDelay(delay)
	const index = statusOnlineDelaySteps.indexOf(clampedDelay)
	return index === -1 ? 0 : index
}

function getStatusOnlineDelayUnit(delay: number) {
	if (delay < 60) {
		return { amount: delay, unit: "minute" as const }
	}
	if (delay < 24 * 60) {
		return { amount: delay / 60, unit: "hour" as const }
	}
	return { amount: delay / (24 * 60), unit: "day" as const }
}

const failedUpdateToast = (error: unknown) => {
	console.error(error)
	toast({
		title: t`Failed to update alert`,
		description: t`Please check logs for more details.`,
		variant: "destructive",
	})
}

/** Create or update alerts for a given name and systems */
const upsertAlerts = debounce(
	async ({ name, value, min, systems }: { name: string; value: number; min: number; systems: string[] }) => {
		try {
			await pb.send<{ success: boolean }>(endpoint, {
				method: "POST",
				// overwrite is always true because we've done filtering client side
				body: { name, value, min, systems, overwrite: true },
			})
		} catch (error) {
			failedUpdateToast(error)
		}
	},
	alertDebounce
)

/** Delete alerts for a given name and systems */
const deleteAlerts = debounce(async ({ name, systems }: { name: string; systems: string[] }) => {
	try {
		await pb.send<{ success: boolean }>(endpoint, {
			method: "DELETE",
			body: { name, systems },
		})
	} catch (error) {
		failedUpdateToast(error)
	}
}, alertDebounce)

export const AlertDialogContent = memo(function AlertDialogContent({ system }: { system: SystemRecord }) {
	const alerts = useStore($alerts)
	const [overwriteExisting, setOverwriteExisting] = useState<boolean | "indeterminate">(false)
	const [currentTab, setCurrentTab] = useState("system")

	const systemAlerts = alerts[system.id] ?? new Map()

	// We need to keep a copy of alerts when we switch to global tab. If we always compare to
	// current alerts, it will only be updated when first checked, then won't be updated because
	// after that it exists.
	const alertsWhenGlobalSelected = useMemo(() => {
		return currentTab === "global" ? structuredClone(alerts) : alerts
	}, [currentTab])

	return (
		<>
			<DialogHeader>
				<DialogTitle className="text-xl">
					<Trans>Alerts</Trans>
				</DialogTitle>
				<DialogDescription>
					<Trans>
						See{" "}
						<Link href={getPagePath($router, "settings", { name: "notifications" })} className="link">
							notification settings
						</Link>{" "}
						to configure how you receive alerts.
					</Trans>
				</DialogDescription>
			</DialogHeader>
			<Tabs defaultValue="system" onValueChange={setCurrentTab}>
				<TabsList className="mb-1 -mt-0.5">
					<TabsTrigger value="system">
						<ServerIcon className="me-2 h-3.5 w-3.5" />
						<span className="truncate max-w-60">{system.name}</span>
					</TabsTrigger>
					<TabsTrigger value="global">
						<GlobeIcon className="me-1.5 h-3.5 w-3.5" />
						<Trans>All Systems</Trans>
					</TabsTrigger>
				</TabsList>
				<TabsContent value="system">
					<div className="grid gap-3">
						<AlertItems system={system} systemAlerts={systemAlerts} />
					</div>
				</TabsContent>
				<TabsContent value="global">
					<label
						htmlFor="ovw"
						className="mb-3 flex gap-2 items-center justify-center cursor-pointer border rounded-sm py-3 px-4 border-destructive text-destructive font-semibold text-sm"
					>
						<Checkbox
							id="ovw"
							className="text-destructive border-destructive data-[state=checked]:bg-destructive"
							checked={overwriteExisting}
							onCheckedChange={setOverwriteExisting}
						/>
						<Trans>Overwrite existing alerts</Trans>
					</label>
					<div className="grid gap-3">
						<AlertItems
							system={system}
							systemAlerts={systemAlerts}
							global={true}
							overwriteExisting={!!overwriteExisting}
							initialAlertsState={alertsWhenGlobalSelected}
						/>
					</div>
				</TabsContent>
			</Tabs>
		</>
	)
})

function AlertItems({
	system,
	systemAlerts,
	global = false,
	overwriteExisting = false,
	initialAlertsState = {},
}: {
	system: SystemRecord
	systemAlerts: Map<string, AlertRecord>
	global?: boolean
	overwriteExisting?: boolean
	initialAlertsState?: Record<string, Map<string, AlertRecord>>
}) {
	const statusDownAlert = systemAlerts.get("Status")
	const statusOnlineAlert = systemAlerts.get("StatusOnline")

	return (
		<>
			<AlertContent
				alertKey="Status"
				data={alertInfo.Status}
				alert={statusDownAlert}
				system={system}
				global={global}
				overwriteExisting={overwriteExisting}
				initialAlertsState={initialAlertsState}
			/>
			<StatusOnlineContent
				system={system}
				alert={statusOnlineAlert}
				global={global}
				overwriteExisting={overwriteExisting}
				initialAlertsState={initialAlertsState}
			/>
			{nonStatusAlertKeys.map((name) => (
				<AlertContent
					key={name}
					alertKey={name}
					data={alertInfo[name]}
					alert={systemAlerts.get(name)}
					system={system}
					global={global}
					overwriteExisting={overwriteExisting}
					initialAlertsState={initialAlertsState}
				/>
			))}
		</>
	)
}

export function AlertContent({
	alertKey,
	data: alertData,
	system,
	alert,
	global = false,
	overwriteExisting = false,
	initialAlertsState = {},
}: {
	alertKey: string
	data: AlertInfo
	system: SystemRecord
	alert?: AlertRecord
	global?: boolean
	overwriteExisting?: boolean
	initialAlertsState?: Record<string, Map<string, AlertRecord>>
}) {
	const { name } = alertData
	const isStatusDownAlert = alertKey === "Status"

	const singleDescription = alertData.singleDesc?.()

	const [checked, setChecked] = useState(global ? false : !!alert)
	const [min, setMin] = useState(
		isStatusDownAlert ? clampStatusDownDelay(alert?.min ?? defaultStatusDelayMinutes) : (alert?.min ?? 10)
	)
	const [value, setValue] = useState(alert?.value ?? (singleDescription ? 0 : (alertData.start ?? 80)))

	const Icon = alertData.icon

	/** Get system ids to update */
	function getSystemIds(): string[] {
		// if not global, update only the current system
		if (!global) {
			return [system.id]
		}
		// if global, update all systems when overwriteExisting is true
		// update only systems without an existing alert when overwriteExisting is false
		const allSystems = $systems.get()
		const systemIds: string[] = []
		for (const system of allSystems) {
			if (overwriteExisting || !initialAlertsState[system.id]?.has(alertKey)) {
				systemIds.push(system.id)
			}
		}
		return systemIds
	}

	function sendUpsert(min: number, value: number) {
		const systems = getSystemIds()
		systems.length &&
			upsertAlerts({
				name: alertKey,
				value,
				min,
				systems,
			})
	}

	return (
		<div className="rounded-lg border border-muted-foreground/15 hover:border-muted-foreground/20 transition-colors duration-100 group">
			<label
				htmlFor={`s${name}`}
				className={cn("flex flex-row items-center justify-between gap-4 cursor-pointer p-4", {
					"pb-0": checked,
				})}
			>
				<div className="grid gap-1 select-none">
					<p className="font-semibold flex gap-3 items-center">
						<Icon className="h-4 w-4 opacity-85" /> {alertData.name()}
					</p>
					{!checked && <span className="block text-sm text-muted-foreground">{alertData.desc()}</span>}
				</div>
				<Switch
					id={`s${name}`}
					checked={checked}
					onCheckedChange={(newChecked) => {
						setChecked(newChecked)
						if (newChecked) {
							// if alert checked, create or update alert
							sendUpsert(min, value)
						} else {
							// if unchecked, delete alert (unless global and overwriteExisting is false)
							deleteAlerts({ name: alertKey, systems: getSystemIds() })
							// when force deleting all alerts of a type, also remove them from initialAlertsState
							if (overwriteExisting) {
								for (const curAlerts of Object.values(initialAlertsState)) {
									curAlerts.delete(alertKey)
								}
							}
						}
					}}
				/>
			</label>
			{checked && (
				<div className="grid sm:grid-cols-2 mt-1.5 gap-5 px-4 pb-5 tabular-nums text-muted-foreground">
					<Suspense fallback={<div className="h-10" />}>
						{!singleDescription && (
							<div>
								<p id={`v${name}`} className="text-sm block h-6">
									{alertData.invert ? (
										<Trans>
											Average drops below{" "}
											<strong className="text-foreground">
												{value}
												{alertData.unit}
											</strong>
										</Trans>
									) : (
										<Trans>
											Average exceeds{" "}
											<strong className="text-foreground">
												{value}
												{alertData.unit}
											</strong>
										</Trans>
									)}
								</p>
								<div className="flex gap-3 items-center">
									<Slider
										aria-labelledby={`v${name}`}
										value={[value]}
										onValueCommit={(val) => sendUpsert(min, val[0])}
										onValueChange={(val) => setValue(val[0])}
										step={alertData.step ?? 1}
										min={alertData.min ?? 1}
										max={alertData.max ?? 99}
									/>
									<Input
										type="number"
										value={value}
										onChange={(e) => {
											let val = parseFloat(e.target.value)
											if (!Number.isNaN(val)) {
												if (alertData.max != null) val = Math.min(val, alertData.max)
												if (alertData.min != null) val = Math.max(val, alertData.min)
												setValue(val)
												sendUpsert(min, val)
											}
										}}
										step={alertData.step ?? 1}
										min={alertData.min ?? 1}
										max={alertData.max ?? 99}
										className="w-16 h-8 text-center px-1"
									/>
								</div>
							</div>
						)}
						<div className={cn(singleDescription && "col-span-full lowercase")}>
							<p id={`t${name}`} className="text-sm block h-6 first-letter:uppercase">
								{singleDescription && (
									<>
										{singleDescription}
										{` `}
									</>
								)}
								<Trans>
									For <strong className="text-foreground">{min}</strong>{" "}
									<Plural value={min} one="minute" other="minutes" />
								</Trans>
							</p>
							<div className="flex gap-3 items-center">
								<Slider
									aria-labelledby={`t${name}`}
									value={[min]}
									onValueCommit={(val) => sendUpsert(val[0], value)}
									onValueChange={(val) => setMin(val[0])}
									min={1}
									max={60}
								/>
								<Input
									type="number"
									value={min}
									onChange={(e) => {
										let val = parseInt(e.target.value, 10)
										if (!Number.isNaN(val)) {
											val = Math.max(1, Math.min(val, 60))
											setMin(val)
											sendUpsert(val, value)
										}
									}}
									min={1}
									max={60}
									className="w-16 h-8 text-center px-1"
								/>
							</div>
						</div>
					</Suspense>
				</div>
			)}
		</div>
	)
}

function StatusOnlineContent({
	system,
	alert,
	global = false,
	overwriteExisting = false,
	initialAlertsState = {},
}: {
	system: SystemRecord
	alert?: AlertRecord
	global?: boolean
	overwriteExisting?: boolean
	initialAlertsState?: Record<string, Map<string, AlertRecord>>
}) {
	const [checked, setChecked] = useState(global ? false : !!alert)
	const [value, setValue] = useState(
		clampStatusOnlineDelay(typeof alert?.value === "number" ? alert.value : defaultStatusOnlineDelayMinutes)
	)
	const delay = getStatusOnlineDelayUnit(value)

	useEffect(() => {
		setChecked(global ? false : !!alert)
		setValue(clampStatusOnlineDelay(typeof alert?.value === "number" ? alert.value : defaultStatusOnlineDelayMinutes))
	}, [alert?.id, alert?.value, global])

	function getSystemIds(): string[] {
		if (!global) {
			return [system.id]
		}

		const allSystems = $systems.get()
		const systemIds: string[] = []
		for (const curSystem of allSystems) {
			if (overwriteExisting || !initialAlertsState[curSystem.id]?.has("StatusOnline")) {
				systemIds.push(curSystem.id)
			}
		}
		return systemIds
	}

	function sendStatusOnlineUpsert(nextValue: number) {
		const systems = getSystemIds()
		systems.length &&
			upsertAlerts({
				name: "StatusOnline",
				value: nextValue,
				min: 0,
				systems,
			})
	}

	return (
		<div className="rounded-lg border border-muted-foreground/15 hover:border-muted-foreground/20 transition-colors duration-100 group">
			<label
				htmlFor={`status-online-${system.id}-${global ? "global" : "system"}`}
				className={cn("flex flex-row items-center justify-between gap-4 cursor-pointer p-4", { "pb-0": checked })}
			>
				<div className="grid gap-1 select-none">
					<p className="font-semibold flex gap-3 items-center">
						<ServerIcon className="h-4 w-4 opacity-85" /> <Trans>System Online</Trans>
					</p>
					{!checked && (
						<span className="block text-sm text-muted-foreground">
							<Trans>Triggers when a system comes online</Trans>
						</span>
					)}
				</div>
				<Switch
					id={`status-online-${system.id}-${global ? "global" : "system"}`}
					checked={checked}
					onCheckedChange={(newChecked) => {
						setChecked(newChecked)
						if (newChecked) {
							sendStatusOnlineUpsert(value)
						} else {
							deleteAlerts({ name: "StatusOnline", systems: getSystemIds() })
							if (overwriteExisting) {
								for (const curAlerts of Object.values(initialAlertsState)) {
									curAlerts.delete("StatusOnline")
								}
							}
						}
					}}
				/>
			</label>
			{checked && (
				<div className="mt-1.5 px-4 pb-5 tabular-nums text-muted-foreground">
					<Suspense fallback={<div className="h-10" />}>
						<p id={`status-online-delay-${system.id}-${global ? "global" : "system"}`} className="text-sm block h-6">
							{delay.unit === "minute" ? (
								<Trans>
									Alert after <strong className="text-foreground">{value}</strong>{" "}
									<Plural value={value} one="minute" other="minutes" />
								</Trans>
							) : delay.unit === "hour" ? (
								<Trans>
									Alert after <strong className="text-foreground">{delay.amount}</strong>{" "}
									<Plural value={delay.amount} one="hour" other="hours" />
								</Trans>
							) : (
								<Trans>
									Alert after <strong className="text-foreground">{delay.amount}</strong>{" "}
									<Plural value={delay.amount} one="day" other="days" />
								</Trans>
							)}
						</p>
						<div className="flex gap-3 items-center">
							<Slider
								aria-labelledby={`status-online-delay-${system.id}-${global ? "global" : "system"}`}
								value={[getStatusOnlineDelayIndex(value)]}
								onValueCommit={(val) => sendStatusOnlineUpsert(statusOnlineDelaySteps[val[0]])}
								onValueChange={(val) => setValue(statusOnlineDelaySteps[val[0]])}
								min={0}
								max={statusOnlineDelaySteps.length - 1}
							/>
							<div className="flex h-8 min-w-24 items-center justify-center rounded-md border border-input bg-background px-2 text-center text-xs text-foreground">
								{delay.unit === "minute" ? (
									<>
										{value} <Trans>min</Trans>
									</>
								) : delay.unit === "hour" ? (
									<>
										{delay.amount} <Trans>hr</Trans>
									</>
								) : (
									<>
										{delay.amount} <Trans>day</Trans>
										{delay.amount > 1 ? "s" : ""}
									</>
								)}
							</div>
						</div>
					</Suspense>
				</div>
			)}
		</div>
	)
}
