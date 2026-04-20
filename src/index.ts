import { loadConfig } from "./config.js";
import { loadHorizon } from "./horizon.js";
import { fetchForecast, ForecastError } from "./forecast.js";
import { createLogger } from "./logger.js";
import { createMetricsServer } from "./server.js";
import { startScheduler } from "./scheduler.js";
import {
  recordFetchError,
  recordFetchSuccess,
  setBuildInfo,
  updateFromForecast,
} from "./metrics.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  setBuildInfo(process.env.SF_VERSION ?? "dev", process.env.SF_COMMIT ?? "unknown");

  const horizon = await loadHorizon(config.horizonFile);
  logger.info(
    { horizonFile: config.horizonFile, values: horizon.split(",").length },
    "horizon loaded",
  );

  const server = createMetricsServer(logger);
  await new Promise<void>((resolve) => {
    server.listen(config.metricsPort, config.metricsBind, resolve);
  });
  logger.info(
    { bind: config.metricsBind, port: config.metricsPort },
    "metrics server listening",
  );

  const tick = async (): Promise<void> => {
    const start = process.hrtime.bigint();
    const durationSeconds = () => Number(process.hrtime.bigint() - start) / 1e9;
    try {
      const { response } = await fetchForecast(config, horizon);
      const duration = durationSeconds();
      updateFromForecast(response);
      recordFetchSuccess(duration);
      logger.info(
        {
          duration,
          ratelimit: response.message.ratelimit,
          power_points: Object.keys(response.result.watts).length,
          days: Object.keys(response.result.watt_hours_day).length,
        },
        "forecast updated",
      );
    } catch (err) {
      const duration = durationSeconds();
      if (err instanceof ForecastError) {
        recordFetchError(err.reason, duration);
        logger.warn(
          { reason: err.reason, status: err.status, err: err.message, duration },
          "forecast fetch failed",
        );
      } else {
        recordFetchError("network", duration);
        logger.error(
          { err: (err as Error).message, duration },
          "unexpected error during fetch",
        );
      }
    }
  };

  const scheduler = startScheduler(config.cron, tick, logger);
  logger.info({ cron: config.cron }, "scheduler started");

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      logger.warn({ signal }, "second signal received, forcing exit");
      process.exit(1);
    }
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    await scheduler.stop();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    logger.info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`fatal: ${message}\n`);
  process.exit(1);
});
