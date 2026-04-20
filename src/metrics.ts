import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";
import type { FetchErrorReason, ForecastResponse } from "./forecast.js";

export const register = new Registry();
register.setDefaultLabels({ app: "solar-forecaster" });
collectDefaultMetrics({ register });

export const forecastPowerWatts = new Gauge({
  name: "solar_forecast_power_watts",
  help: "Forecasted PV power output in watts at the given timestamp.",
  labelNames: ["forecast_for"],
  registers: [register],
});

export const forecastEnergyPeriodWattHours = new Gauge({
  name: "solar_forecast_energy_period_watt_hours",
  help: "Forecasted energy produced in the period ending at the given timestamp, in watt-hours.",
  labelNames: ["forecast_for"],
  registers: [register],
});

export const forecastEnergyDayWattHours = new Gauge({
  name: "solar_forecast_energy_day_watt_hours",
  help: "Forecasted total energy for the given day, in watt-hours.",
  labelNames: ["date"],
  registers: [register],
});

export const apiRateLimit = new Gauge({
  name: "solar_api_rate_limit",
  help: "forecast.solar rolling 60-minute rate limit quota.",
  registers: [register],
});

export const apiRateLimitRemaining = new Gauge({
  name: "solar_api_rate_limit_remaining",
  help: "forecast.solar remaining rate limit quota for the current 60-minute window.",
  registers: [register],
});

export const fetchLastSuccessTimestampSeconds = new Gauge({
  name: "solar_fetch_last_success_timestamp_seconds",
  help: "Unix timestamp (seconds) of the last successful forecast fetch.",
  registers: [register],
});

export const fetchDurationSeconds = new Histogram({
  name: "solar_fetch_duration_seconds",
  help: "Duration of forecast.solar fetch requests, in seconds.",
  labelNames: ["outcome"],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

export const fetchTotal = new Counter({
  name: "solar_fetch_total",
  help: "Total forecast fetch attempts.",
  labelNames: ["outcome"],
  registers: [register],
});

export const fetchErrorsTotal = new Counter({
  name: "solar_fetch_errors_total",
  help: "Total forecast fetch errors by reason.",
  labelNames: ["reason"],
  registers: [register],
});

export const buildInfo = new Gauge({
  name: "solar_build_info",
  help: "Build information for the solar-forecaster service.",
  labelNames: ["version", "node_version", "commit"],
  registers: [register],
});

export function setBuildInfo(version: string, commit: string): void {
  buildInfo.set({ version, node_version: process.version, commit }, 1);
}

function toRfc3339Utc(apiTimestamp: string): string | null {
  // forecast.solar returns "YYYY-MM-DD HH:MM:SS" (with time=iso8601 it's usually with offset).
  // Date() tolerates both once we normalise the space to 'T'.
  const candidate = apiTimestamp.includes("T") ? apiTimestamp : apiTimestamp.replace(" ", "T");
  const ms = Date.parse(candidate);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function updateFromForecast(response: ForecastResponse): void {
  forecastPowerWatts.reset();
  forecastEnergyPeriodWattHours.reset();
  forecastEnergyDayWattHours.reset();

  for (const [ts, watts] of Object.entries(response.result.watts)) {
    const forecast_for = toRfc3339Utc(ts);
    if (forecast_for === null) continue;
    forecastPowerWatts.set({ forecast_for }, watts);
  }

  for (const [ts, wh] of Object.entries(response.result.watt_hours_period)) {
    const forecast_for = toRfc3339Utc(ts);
    if (forecast_for === null) continue;
    forecastEnergyPeriodWattHours.set({ forecast_for }, wh);
  }

  for (const [date, wh] of Object.entries(response.result.watt_hours_day)) {
    forecastEnergyDayWattHours.set({ date }, wh);
  }

  const rl = response.message.ratelimit;
  if (rl) {
    apiRateLimit.set(rl.limit);
    apiRateLimitRemaining.set(rl.remaining);
  }

  fetchLastSuccessTimestampSeconds.set(Date.now() / 1000);
}

export function recordFetchSuccess(durationSeconds: number): void {
  fetchTotal.inc({ outcome: "success" });
  fetchDurationSeconds.observe({ outcome: "success" }, durationSeconds);
}

export function recordFetchError(reason: FetchErrorReason, durationSeconds: number): void {
  fetchTotal.inc({ outcome: "error" });
  fetchErrorsTotal.inc({ reason });
  fetchDurationSeconds.observe({ outcome: "error" }, durationSeconds);
}
