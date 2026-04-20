import { readFile } from "node:fs/promises";

export class HorizonError extends Error {}

export function parseHorizon(raw: string): string {
  const normalized = raw.replace(/\r\n|\r|\n/g, ",");
  const values: string[] = [];
  for (const rawPart of normalized.split(",")) {
    const part = rawPart.trim();
    if (part === "") continue;
    const n = Number(part);
    if (!Number.isFinite(n)) {
      throw new HorizonError(`invalid value ${JSON.stringify(part)}: not a number`);
    }
    if (n < 0 || n > 90) {
      throw new HorizonError(`invalid horizon value ${n}: must be 0-90 degrees`);
    }
    values.push(part);
  }
  if (values.length < 4) {
    throw new HorizonError(`need at least 4 values, got ${values.length}`);
  }
  return values.join(",");
}

export async function loadHorizon(path: string): Promise<string> {
  const raw = await readFile(path, "utf8");
  return parseHorizon(raw);
}
