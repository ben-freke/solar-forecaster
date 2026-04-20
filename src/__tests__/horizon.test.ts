import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HorizonError, loadHorizon, parseHorizon } from "../horizon.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

describe("parseHorizon", () => {
  it("accepts comma-separated values", () => {
    expect(parseHorizon("0,15,30,45")).toBe("0,15,30,45");
  });

  it("accepts newline-separated values", () => {
    expect(parseHorizon("0\n15\n30\n45")).toBe("0,15,30,45");
  });

  it("accepts \\r\\n line endings", () => {
    expect(parseHorizon("0\r\n15\r\n30\r\n45")).toBe("0,15,30,45");
  });

  it("accepts mixed separators and trims whitespace", () => {
    expect(parseHorizon("  0 , 15\n 30,\t45 ")).toBe("0,15,30,45");
  });

  it("skips empty parts", () => {
    expect(parseHorizon("0,,15\n\n30,45,")).toBe("0,15,30,45");
  });

  it("rejects non-numeric values", () => {
    expect(() => parseHorizon("0,abc,30,45")).toThrow(HorizonError);
  });

  it("rejects values below 0", () => {
    expect(() => parseHorizon("0,15,30,-5")).toThrow(/must be 0-90/);
  });

  it("rejects values above 90", () => {
    expect(() => parseHorizon("0,15,30,91")).toThrow(/must be 0-90/);
  });

  it("rejects fewer than 4 values", () => {
    expect(() => parseHorizon("0,15,30")).toThrow(/at least 4 values/);
  });

  it("preserves decimal values", () => {
    expect(parseHorizon("0,15.5,30,45.25")).toBe("0,15.5,30,45.25");
  });
});

describe("loadHorizon (golden)", () => {
  it("parses horizon.txt", async () => {
    const raw = await readFile(resolve(repoRoot, "horizon.txt"), "utf8");
    const parsed = parseHorizon(raw);
    const values = parsed.split(",");
    expect(values.length).toBeGreaterThanOrEqual(4);
    for (const v of values) {
      const n = Number(v);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(90);
    }
  });

  it("parses horizon.example.txt", async () => {
    const parsed = await loadHorizon(resolve(repoRoot, "horizon.example.txt"));
    expect(parsed).toBe("0,0,15,30,45,60,60,60,45,30,15,0");
  });
});
