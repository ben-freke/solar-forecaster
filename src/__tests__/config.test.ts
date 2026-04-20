import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

const baseEnv = {
  SF_LAT: "51.5",
  SF_LON: "-0.1",
  SF_DECLINATION: "35",
  SF_AZIMUTH: "0",
  SF_KWP: "5.0",
};

describe("loadConfig", () => {
  it("parses required values and applies defaults", () => {
    const config = loadConfig(baseEnv);
    expect(config.lat).toBe(51.5);
    expect(config.lon).toBe(-0.1);
    expect(config.declination).toBe(35);
    expect(config.azimuth).toBe(0);
    expect(config.kwp).toBe(5);
    expect(config.inverterKw).toBe(0);
    expect(config.limit).toBe(2);
    expect(config.resolution).toBe(60);
    expect(config.horizonFile).toBe("/etc/solar-forecaster/horizon.txt");
    expect(config.cron).toBe("0 */15 * * * *");
    expect(config.metricsPort).toBe(9090);
    expect(config.metricsBind).toBe("0.0.0.0");
    expect(config.logLevel).toBe("info");
    expect(config.apiKey).toBeUndefined();
    expect(config.damping).toBeUndefined();
  });

  it("throws when required vars are missing", () => {
    expect(() => loadConfig({})).toThrow();
    expect(() => loadConfig({ ...baseEnv, SF_LAT: "" })).toThrow();
  });

  it("rejects non-numeric required values", () => {
    expect(() => loadConfig({ ...baseEnv, SF_LAT: "abc" })).toThrow();
  });

  it("rejects out-of-range latitude", () => {
    expect(() => loadConfig({ ...baseEnv, SF_LAT: "95" })).toThrow();
  });

  it("rejects declination outside 0-90", () => {
    expect(() => loadConfig({ ...baseEnv, SF_DECLINATION: "95" })).toThrow();
    expect(() => loadConfig({ ...baseEnv, SF_DECLINATION: "-5" })).toThrow();
  });

  it("rejects kwp <= 0", () => {
    expect(() => loadConfig({ ...baseEnv, SF_KWP: "0" })).toThrow();
    expect(() => loadConfig({ ...baseEnv, SF_KWP: "-1" })).toThrow();
  });

  it("rejects resolution that is not 15/30/60", () => {
    expect(() => loadConfig({ ...baseEnv, SF_RESOLUTION: "45" })).toThrow();
  });

  it("rejects limit outside 1-8", () => {
    expect(() => loadConfig({ ...baseEnv, SF_LIMIT: "0" })).toThrow();
    expect(() => loadConfig({ ...baseEnv, SF_LIMIT: "9" })).toThrow();
  });

  it("rejects damping outside 0-1", () => {
    expect(() => loadConfig({ ...baseEnv, SF_DAMPING: "1.5" })).toThrow();
  });

  it("rejects invalid cron", () => {
    expect(() => loadConfig({ ...baseEnv, SF_CRON: "not a cron" })).toThrow();
  });

  it("rejects invalid log level", () => {
    expect(() => loadConfig({ ...baseEnv, SF_LOG_LEVEL: "verbose" })).toThrow();
  });

  it("accepts optional fields when provided", () => {
    const config = loadConfig({
      ...baseEnv,
      SF_API_KEY: "abc123",
      SF_INVERTER_KW: "3.5",
      SF_LIMIT: "4",
      SF_RESOLUTION: "30",
      SF_DAMPING_MORNING: "0.25",
      SF_DAMPING_EVENING: "0.75",
      SF_CRON: "*/30 * * * * *",
      SF_METRICS_PORT: "9100",
      SF_METRICS_BIND: "127.0.0.1",
      SF_LOG_LEVEL: "debug",
      SF_HORIZON_FILE: "/tmp/horizon.txt",
    });
    expect(config.apiKey).toBe("abc123");
    expect(config.inverterKw).toBe(3.5);
    expect(config.limit).toBe(4);
    expect(config.resolution).toBe(30);
    expect(config.dampingMorning).toBe(0.25);
    expect(config.dampingEvening).toBe(0.75);
    expect(config.metricsPort).toBe(9100);
    expect(config.metricsBind).toBe("127.0.0.1");
    expect(config.logLevel).toBe("debug");
    expect(config.horizonFile).toBe("/tmp/horizon.txt");
  });
});
