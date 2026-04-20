import { beforeEach, describe, expect, it } from "vitest";
import {
  forecastEnergyDayWattHours,
  forecastEnergyPeriodWattHours,
  forecastPowerWatts,
  apiRateLimit,
  apiRateLimitRemaining,
  fetchLastSuccessTimestampSeconds,
  recordFetchError,
  recordFetchSuccess,
  register,
  updateFromForecast,
} from "../metrics.js";
import type { ForecastResponse } from "../forecast.js";

function makeResponse(
  watts: Record<string, number>,
  wattHoursPeriod: Record<string, number> = {},
  wattHoursDay: Record<string, number> = {},
  ratelimit = { limit: 12, remaining: 9 },
): ForecastResponse {
  return {
    result: {
      watts,
      watt_hours_period: wattHoursPeriod,
      watt_hours: {},
      watt_hours_day: wattHoursDay,
    },
    message: {
      code: 0,
      type: "success",
      text: "",
      ratelimit,
    },
  };
}

describe("metrics.updateFromForecast", () => {
  beforeEach(() => {
    forecastPowerWatts.reset();
    forecastEnergyPeriodWattHours.reset();
    forecastEnergyDayWattHours.reset();
    apiRateLimit.reset();
    apiRateLimitRemaining.reset();
    fetchLastSuccessTimestampSeconds.reset();
  });

  it("populates power gauges with RFC3339 UTC labels", async () => {
    updateFromForecast(
      makeResponse({
        "2026-04-20T12:00:00+00:00": 2500,
        "2026-04-20T13:00:00+00:00": 3000,
      }),
    );
    const metric = await forecastPowerWatts.get();
    const labels = metric.values.map((v) => v.labels.forecast_for);
    expect(labels).toContain("2026-04-20T12:00:00.000Z");
    expect(labels).toContain("2026-04-20T13:00:00.000Z");
    const twelve = metric.values.find((v) => v.labels.forecast_for === "2026-04-20T12:00:00.000Z");
    expect(twelve?.value).toBe(2500);
  });

  it("populates daily totals with date labels", async () => {
    updateFromForecast(
      makeResponse({}, {}, { "2026-04-20": 18000, "2026-04-21": 22500 }),
    );
    const metric = await forecastEnergyDayWattHours.get();
    const byDate = Object.fromEntries(metric.values.map((v) => [v.labels.date, v.value]));
    expect(byDate).toEqual({ "2026-04-20": 18000, "2026-04-21": 22500 });
  });

  it("resets forecast gauges between calls so stale labels disappear", async () => {
    updateFromForecast(makeResponse({ "2026-04-20T12:00:00+00:00": 2500 }));
    let metric = await forecastPowerWatts.get();
    expect(metric.values).toHaveLength(1);

    updateFromForecast(makeResponse({ "2026-04-20T13:00:00+00:00": 3000 }));
    metric = await forecastPowerWatts.get();
    expect(metric.values).toHaveLength(1);
    expect(metric.values[0]?.labels.forecast_for).toBe("2026-04-20T13:00:00.000Z");
  });

  it("records rate limit and last-success timestamp", async () => {
    const before = Date.now() / 1000;
    updateFromForecast(makeResponse({}, {}, {}, { limit: 20, remaining: 14 }));
    const after = Date.now() / 1000;

    expect((await apiRateLimit.get()).values[0]?.value).toBe(20);
    expect((await apiRateLimitRemaining.get()).values[0]?.value).toBe(14);
    const ts = (await fetchLastSuccessTimestampSeconds.get()).values[0]?.value ?? 0;
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 0.001);
  });

  it("skips timestamps it cannot parse rather than throwing", async () => {
    updateFromForecast(
      makeResponse({ "not-a-date": 100, "2026-04-20T12:00:00+00:00": 2500 }),
    );
    const metric = await forecastPowerWatts.get();
    expect(metric.values).toHaveLength(1);
    expect(metric.values[0]?.labels.forecast_for).toBe("2026-04-20T12:00:00.000Z");
  });
});

describe("metrics.recordFetch", () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it("increments success counter and histogram", async () => {
    recordFetchSuccess(0.42);
    const total = await register.getSingleMetric("solar_fetch_total")?.get();
    const success = total?.values.find((v) => v.labels.outcome === "success");
    expect(success?.value).toBe(1);
  });

  it("records error counter with reason", async () => {
    recordFetchError("http_4xx", 0.12);
    const errors = await register.getSingleMetric("solar_fetch_errors_total")?.get();
    const v = errors?.values.find((v) => v.labels.reason === "http_4xx");
    expect(v?.value).toBe(1);
  });
});
