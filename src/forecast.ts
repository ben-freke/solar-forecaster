import { z } from "zod";
import type { Config } from "./config.js";

export type FetchErrorReason = "timeout" | "http_4xx" | "http_5xx" | "parse" | "network";

export class ForecastError extends Error {
  readonly reason: FetchErrorReason;
  readonly status?: number;

  constructor(reason: FetchErrorReason, message: string, status?: number) {
    super(message);
    this.name = "ForecastError";
    this.reason = reason;
    if (status !== undefined) this.status = status;
  }
}

const WattMap = z.record(z.string(), z.number());

const responseSchema = z.object({
  result: z.object({
    watts: WattMap,
    watt_hours_period: WattMap,
    watt_hours: WattMap,
    watt_hours_day: WattMap,
  }),
  message: z.object({
    code: z.number(),
    type: z.string().optional().default(""),
    text: z.string().optional().default(""),
    ratelimit: z
      .object({
        limit: z.number(),
        remaining: z.number(),
      })
      .optional(),
  }),
});

export type ForecastResponse = z.infer<typeof responseSchema>;

export interface FetchForecastResult {
  response: ForecastResponse;
  sanitizedUrl: string;
}

const REQUEST_TIMEOUT_MS = 30_000;

export function buildForecastUrl(
  config: Config,
  horizon: string | undefined,
): { url: string; sanitizedUrl: string } {
  const num = (n: number) => String(n);
  const path = `estimate/${num(config.lat)}/${num(config.lon)}/${num(config.declination)}/${num(
    config.azimuth,
  )}/${num(config.kwp)}`;

  const base = `https://api.forecast.solar`;
  const authedPath = config.apiKey ? `${config.apiKey}/${path}` : path;

  const params = new URLSearchParams();
  params.set("time", "iso8601");
  if (config.limit !== 2) params.set("limit", String(config.limit));
  if (config.resolution !== 60) params.set("resolution", String(config.resolution));

  const morning = config.dampingMorning;
  const evening = config.dampingEvening;
  if (morning !== undefined || evening !== undefined) {
    if (morning !== undefined) params.set("damping_morning", String(morning));
    if (evening !== undefined) params.set("damping_evening", String(evening));
  } else if (config.damping !== undefined) {
    params.set("damping", String(config.damping));
  }

  if (config.inverterKw > 0) params.set("inverter", String(config.inverterKw));
  if (horizon) params.set("horizon", horizon);

  const qs = params.toString();
  return {
    url: `${base}/${authedPath}?${qs}`,
    sanitizedUrl: `${base}/${path}?${qs}`,
  };
}

export async function fetchForecast(
  config: Config,
  horizon: string | undefined,
): Promise<FetchForecastResult> {
  const { url, sanitizedUrl } = buildForecastUrl(config, horizon);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === "TimeoutError" || e.name === "AbortError") {
      throw new ForecastError("timeout", `request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw new ForecastError("network", e.message);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new ForecastError("parse", (err as Error).message, res.status);
  }

  if (!res.ok) {
    const reason: FetchErrorReason = res.status >= 500 ? "http_5xx" : "http_4xx";
    const text =
      (body as { message?: { text?: string } } | null)?.message?.text ?? `HTTP ${res.status}`;
    throw new ForecastError(reason, text, res.status);
  }

  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ForecastError("parse", parsed.error.message, res.status);
  }

  return { response: parsed.data, sanitizedUrl };
}
