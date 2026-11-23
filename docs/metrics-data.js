export function formatMetric(value, unit = "pct") {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "pct") return `${(value * 100).toFixed(1)}%`;
  if (unit === "points") return `${(value * 100).toFixed(1)} pp`;
  if (unit === "pp") return `${value.toFixed(2)} pp`;
  return value.toFixed(unit === "elo" ? 0 : 3);
}

export function metricRows(data, kind, key) {
  if (key === "elo") return data.models.map(model => {
    const cell = data[kind].elo[model];
    return { model, value: cell?.rating ?? null, ci: cell?.ci, games: cell?.ratedGames };
  });
  return [...data.models, "All models"].map(model => ({ model, ...data[kind].metrics[key]?.[model] }));
}

export function chartDomain(rows, unit) {
  const values = rows.flatMap(r => [r.value, ...(r.ci || [])]).filter(v => v != null && Number.isFinite(v));
  if (!values.length) return [0, 1];
  if (unit === "pct" || unit === "auc") return [Math.min(0, ...values), Math.max(1, ...values)];
  let lo = Math.min(...values), hi = Math.max(...values);
  if (unit !== "elo") { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  const padding = (hi - lo || 1) * 0.08;
  return [lo < 0 || unit === "elo" ? lo - padding : lo, hi + padding];
}

export function trendRows(data, kind, model, phase) {
  const prefix = kind === "mafia" ? "d" : "m";
  const label = kind === "mafia" ? "Day" : "Mission";
  return Array.from({ length: kind === "mafia" ? 4 : 5 }, (_, i) => {
    const key = `${phase}:${prefix}${i + 1}`;
    return { label: `${label} ${i + 1}${kind === "mafia" && i === 3 ? "+" : ""}`,
      ...data[kind].metrics[`faction:${key}`]?.[model],
      baseline: data[kind].metrics[`factionBaseline:${key}`]?.["All models"]?.value };
  });
}
