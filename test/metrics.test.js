import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatMetric, metricRows, chartDomain, trendRows } from "../docs/metrics-data.js";

const data = JSON.parse(await readFile(new URL("../docs/data/metrics.json", import.meta.url), "utf8"));
const manifest = JSON.parse(await readFile(new URL("../docs/data/manifest.json", import.meta.url), "utf8"));

test("metric units distinguish ratios, signed role adjustments and already-scaled effects", () => {
  assert.equal(formatMetric(0.527), "52.7%");
  assert.equal(formatMetric(-0.082, "points"), "-8.2 pp");
  assert.equal(formatMetric(1.84356, "pp"), "1.84 pp");
  assert.equal(formatMetric(0, "num"), "0.000");
  assert.equal(formatMetric(null), "—");
  assert.equal(formatMetric(undefined), "—");
});

test("all published selector entries retain valid pooled observations and intervals", () => {
  for (const kind of ["mafia", "avalon"]) {
    assert.equal(new Set(data.catalog[kind].map(item => item.key)).size, data.catalog[kind].length);
    for (const item of data.catalog[kind]) {
      const rows = metricRows(data, kind, item.key);
      assert.equal(rows.length, item.key === "elo" ? 7 : 8);
      const [lo, hi] = chartDomain(rows, item.unit);
      assert(hi > lo);
      for (const row of rows) {
        if (row.value == null) continue;
        assert(Number.isFinite(row.value));
        assert(row.games > 0 && row.games <= 100);
        assert(row.ci.every(Number.isFinite));
        assert(row.ci[0] <= row.ci[1]);
        assert(lo <= Math.min(row.value, ...row.ci) && hi >= Math.max(row.value, ...row.ci));
        if (item.key !== "elo") {
          assert(row.denominator > 0);
          assert(Math.abs(row.value - row.numerator / row.denominator) < 1e-10);
        }
      }
    }
  }
  const pooled = metricRows(data, "mafia", "mafiaDetectionAuc").at(-1);
  assert.equal(pooled.numerator, 16227.5);
  assert.equal(pooled.denominator, 23148);
});

test("trend preserves source sample sizes, grouped day 4+, missing cells and pooled baseline", () => {
  const rows = trendRows(data, "mafia", "All models", "post");
  assert.equal(rows[0].value, 2775 / 3720);
  assert.equal(rows[0].denominator, 3720);
  assert.equal(rows[3].label, "Day 4+");
  const avalon = trendRows(data, "avalon", data.models[0], "pre");
  assert.equal(avalon.length, 5);
  assert(avalon.every(row => row.baseline === 0.5));
  assert.equal(trendRows(data, "avalon", "missing", "post")[0].value, undefined);
});

test("overview counts agree with exported replays, not report call counters", () => {
  for (const kind of ["mafia", "avalon"]) {
    const games = manifest.games.filter(game => game.game === kind);
    assert.equal(data[kind].overview.games, games.length);
    for (const key of ["surveys", "calls", "polls", "yields"])
      assert.equal(data[kind].overview[key], games.reduce((n, game) => n + game[key], 0));
    assert.equal(Object.values(data[kind].overview.wins).reduce((a, b) => a + b), games.length);
  }
});
