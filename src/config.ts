import { Cron } from "croner";
import { z } from "zod";

const numeric = (schema: z.ZodNumber) =>
  z
    .string()
    .trim()
    .min(1, "required")
    .transform((v, ctx) => {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a number" });
        return z.NEVER;
      }
      return n;
    })
    .pipe(schema);

const optionalNumeric = <T extends z.ZodType<number>>(schema: T) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return undefined;
      const n = Number(v);
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a number" });
        return z.NEVER;
      }
      return n;
    })
    .pipe(schema.optional());

const cronString = z
  .string()
  .trim()
  .min(1)
  .superRefine((v, ctx) => {
    try {
      new Cron(v, { paused: true });
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `invalid cron expression: ${(err as Error).message}`,
      });
    }
  });

const logLevel = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

const envSchema = z.object({
  SF_LAT: numeric(z.number().min(-90).max(90)),
  SF_LON: numeric(z.number().min(-180).max(180)),
  SF_DECLINATION: numeric(z.number().min(0).max(90)),
  SF_AZIMUTH: numeric(z.number().min(-180).max(180)),
  SF_KWP: numeric(z.number().positive()),
  SF_API_KEY: z.string().trim().min(1).optional(),
  SF_INVERTER_KW: optionalNumeric(z.number().min(0)).default("0"),
  SF_LIMIT: optionalNumeric(z.number().int().min(1).max(8)).default("2"),
  SF_RESOLUTION: optionalNumeric(z.union([z.literal(15), z.literal(30), z.literal(60)])).default(
    "60",
  ),
  SF_DAMPING: optionalNumeric(z.number().min(0).max(1)),
  SF_DAMPING_MORNING: optionalNumeric(z.number().min(0).max(1)),
  SF_DAMPING_EVENING: optionalNumeric(z.number().min(0).max(1)),
  SF_HORIZON_FILE: z.string().trim().min(1).default("/etc/solar-forecaster/horizon.txt"),
  SF_CRON: cronString.default("0 */15 * * * *"),
  SF_METRICS_PORT: optionalNumeric(z.number().int().min(1).max(65535)).default("9090"),
  SF_METRICS_BIND: z.string().trim().min(1).default("0.0.0.0"),
  SF_LOG_LEVEL: logLevel.default("info"),
});

export type RawEnv = z.infer<typeof envSchema>;

export interface Config {
  lat: number;
  lon: number;
  declination: number;
  azimuth: number;
  kwp: number;
  apiKey?: string;
  inverterKw: number;
  limit: number;
  resolution: 15 | 30 | 60;
  damping?: number;
  dampingMorning?: number;
  dampingEvening?: number;
  horizonFile: string;
  cron: string;
  metricsPort: number;
  metricsBind: string;
  logLevel: z.infer<typeof logLevel>;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  const config: Config = {
    lat: parsed.SF_LAT,
    lon: parsed.SF_LON,
    declination: parsed.SF_DECLINATION,
    azimuth: parsed.SF_AZIMUTH,
    kwp: parsed.SF_KWP,
    inverterKw: parsed.SF_INVERTER_KW ?? 0,
    limit: parsed.SF_LIMIT ?? 2,
    resolution: (parsed.SF_RESOLUTION ?? 60) as 15 | 30 | 60,
    horizonFile: parsed.SF_HORIZON_FILE,
    cron: parsed.SF_CRON,
    metricsPort: parsed.SF_METRICS_PORT ?? 9090,
    metricsBind: parsed.SF_METRICS_BIND,
    logLevel: parsed.SF_LOG_LEVEL,
  };
  if (parsed.SF_API_KEY !== undefined) config.apiKey = parsed.SF_API_KEY;
  if (parsed.SF_DAMPING !== undefined) config.damping = parsed.SF_DAMPING;
  if (parsed.SF_DAMPING_MORNING !== undefined) config.dampingMorning = parsed.SF_DAMPING_MORNING;
  if (parsed.SF_DAMPING_EVENING !== undefined) config.dampingEvening = parsed.SF_DAMPING_EVENING;
  return config;
}
