import { Cron } from "croner";
import type { Logger } from "./logger.js";

export interface Scheduler {
  stop(): Promise<void>;
}

export function startScheduler(
  expression: string,
  task: () => Promise<void>,
  logger: Logger,
): Scheduler {
  let current: Promise<void> | null = null;

  const runTick = async () => {
    if (current) {
      logger.warn("skipping tick: previous still in flight");
      return;
    }
    current = task().catch((err: Error) => {
      logger.error({ err: err.message }, "unhandled error in scheduled task");
    });
    try {
      await current;
    } finally {
      current = null;
    }
  };

  const job = new Cron(expression, () => {
    void runTick();
  });

  void runTick();

  return {
    stop: async () => {
      job.stop();
      if (current) await current;
    },
  };
}
