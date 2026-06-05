import { readFile } from "node:fs/promises";

export type Benchmarks = {
  targetCpaCents: number;
  minCtr: number;
  maxFrequency: number;
  ctrDropPctThreshold: number;
  minRoas: number;
};

export type Preferences = {
  defaultDateRange: string;
  currency: string;
  compactOutput: boolean;
  // IANA timezone (e.g. "America/New_York", "UTC"). Pacing calculations in
  // the daily briefing use this to compute day-fraction-elapsed against the
  // ad account's billing day, not the host's wall clock.
  accountTimezone: string;
};

const DEFAULT_BENCHMARKS: Benchmarks = {
  targetCpaCents: 3000,
  minCtr: 0.01,
  maxFrequency: 3.5,
  ctrDropPctThreshold: 0.20,
  minRoas: 2.0,
};

const DEFAULT_PREFERENCES: Preferences = {
  defaultDateRange: "last_7d",
  currency: "USD",
  compactOutput: false,
  accountTimezone: "UTC",
};

export async function loadBenchmarks(): Promise<Benchmarks> {
  try {
    const text = await readFile("config/benchmarks.json", "utf8");
    const parsed = JSON.parse(text) as Partial<Benchmarks>;
    return { ...DEFAULT_BENCHMARKS, ...parsed };
  } catch {
    return DEFAULT_BENCHMARKS;
  }
}

export async function loadPreferences(): Promise<Preferences> {
  try {
    const text = await readFile("config/preferences.json", "utf8");
    const parsed = JSON.parse(text) as Partial<Preferences>;
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}
