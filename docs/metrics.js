import { formatMetric, metricRows, chartDomain, trendRows } from "./metrics-data.js?v=metrics-1";

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const count = value => value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const interval = (row, unit) => row.ci?.every(Number.isFinite) ? row.ci.map(v => formatMetric(v, unit)).join(" to ") : "—";
let data, kind = "mafia", metric, model = "All models", phase = "post";

function description(key) {
  if (key === "elo") return "Relative performance within this game type. Ratings are recentered to a mean of 1500; there is no pooled rating or observation denominator.";
  if (key === "winAboveRole") return "Each seat’s outcome minus the pooled win rate for its assigned role, averaged across seats. Zero matches the role baseline; units are percentage points.";
  if (key.startsWith("winRate")) return "Winning seats divided by eligible seats. Models can occupy multiple seats in a Mafia game. Role-specific rates have different sample sizes.";
  if (key === "mafiaDetectionAuc") return "How well town observers rank mafia above town: 0.5 is chance, 1 is perfect. Uses each observer’s last pre-vote survey per day, all other targets, and half credit for ties.";
  if (key === "servantEvilAuc") return "How well Loyal Servants rank evil above good: 0.5 is chance, 1 is perfect. Excludes Merlin and evil observers who have privileged role knowledge.";
  if (key.startsWith("faction") || key.includes("Recall")) return "Faction predictions use P(good) ≥ 0.5. Mafia checkpoint metrics use villagers; Avalon uses Loyal Servants. Accuracy must be read alongside the majority-class baseline in the trend below; recall measures only actual evil targets.";
  if (/brier/i.test(key)) return "Squared error of reported role probabilities against true roles. Lower is better. Binary and full-role Brier scores use different outcome spaces and should not be compared directly.";
  if (/perceivedRole/i.test(key)) return "Distance between a player’s reported perception of how others view them and the group’s reported beliefs. Uses living town/good observers at the same checkpoint; lower is better.";
  if (/belief.*update/i.test(key)) return "Average total-variation distance between successive reported role beliefs. A larger update is not inherently better; it measures change, not accuracy.";
  if (/FalseAccusation/.test(key)) return "Fraction of all evil-side speeches that accuse a truly good player. This covers tagged accusations only, not all deceptive statements.";
  if (/AccusationHonesty/.test(key)) return "Among tagged accusations, the fraction naming the speaker’s highest private suspicion among living players immediately before speaking. Ties count as honest.";
  if (/convincing/i.test(key)) return "Average rise in listeners’ suspicion of the accused after an accusation, in percentage points. This is an observed belief change, not a causal estimate.";
  if (/defensive/i.test(key)) return "Average fall in listeners’ suspicion of a speaker after a defense, in percentage points. Negative values mean suspicion increased.";
  if (/roleId|roleIdentification|servantRole/i.test(key)) return "Accuracy of the highest-probability role guess. Tied top guesses count as wrong. The all-observer Avalon measure includes players with privileged role knowledge.";
  return "Pooled over eligible observations in the published report. Read the metric label for the observer and outcome being measured, and the table for sample sizes. Larger values are not always better.";
}

function saveHash() {
  history.replaceState(null, "", `#${new URLSearchParams({ game: kind, metric, model, phase })}`);
}

function renderComparison() {
  const item = data.catalog[kind].find(item => item.key === metric);
  const rows = metricRows(data, kind, metric);
  $("#metric-title").textContent = item.label;
  $("#metric-description").textContent = description(metric);
  const pooled = rows.find(row => row.model === "All models");
  $("#metric-pooled").innerHTML = pooled ? `<strong>${formatMetric(pooled.value, item.unit)}</strong><span>All models · pooled</span>` : "";
  const [lo, hi] = chartDomain(rows, item.unit);
  const x = value => 12 + 576 * (value - lo) / (hi - lo);
  $("#comparison-chart").innerHTML = rows.map(row => {
    const hasValue = row.value != null && Number.isFinite(row.value);
    const zero = lo < 0 && hi > 0 ? `<line x1="${x(0)}" x2="${x(0)}" y1="0" y2="30" class="chart-zero"/>` : "";
    const ci = row.ci?.every(Number.isFinite) ? `<line x1="${x(row.ci[0])}" x2="${x(row.ci[1])}" y1="15" y2="15" class="chart-interval"/>` : "";
    return `<div class="comparison-row ${row.model === "All models" ? "pooled-row" : ""}"><span>${esc(row.model)}</span><svg viewBox="0 0 600 30" preserveAspectRatio="none" aria-hidden="true"><line x1="12" x2="588" y1="15" y2="15" class="chart-track"/>${zero}${hasValue ? `${ci}<circle cx="${x(row.value)}" cy="15" r="5" class="chart-dot"/>` : ""}</svg><strong>${formatMetric(row.value, item.unit)}</strong></div>`;
  }).join("") + `<div class="comparison-axis" aria-hidden="true"><span>${formatMetric(lo, item.unit)}</span><span>${formatMetric(hi, item.unit)}</span></div>`;
  $("#comparison-values").innerHTML = rows.map(row => `<tr class="${row.model === "All models" ? "pooled-row" : ""}"><th scope="row">${esc(row.model)}</th><td>${formatMetric(row.value, item.unit)}</td><td>${interval(row, item.unit)}</td><td>${row.denominator == null ? "—" : `${count(row.numerator)} / ${count(row.denominator)}`}</td><td>${count(row.games)}</td></tr>`).join("");
}

function renderTrend() {
  const rows = trendRows(data, kind, model, phase);
  $("#trend-title").textContent = `Faction deduction by ${kind === "mafia" ? "day" : "mission"}`;
  $("#trend-description").textContent = `${model} · ${kind === "mafia" ? "Villagers" : "Loyal Servants"} · ${phase === "pre" ? "Before the first discussion" : kind === "mafia" ? "After the vote" : "At the mission result"}. Solid teal: accuracy. Dashed gray: always predict good. Vertical lines: 95% intervals.`;
  const x = index => 65 + index * 640 / (rows.length - 1);
  const y = value => 210 - value * 180;
  const lines = [0, 0.5, 1].map(value => `<line x1="50" x2="725" y1="${y(value)}" y2="${y(value)}" class="chart-track"/><text x="40" y="${y(value) + 5}" text-anchor="end">${value * 100}%</text>`).join("");
  const segments = field => rows.slice(1).map((row, i) => row[field] != null && rows[i][field] != null ? `<line x1="${x(i)}" x2="${x(i + 1)}" y1="${y(rows[i][field])}" y2="${y(row[field])}" class="${field === "baseline" ? "trend-baseline" : "trend-line"}"/>` : "").join("");
  $("#trend-chart").innerHTML = `<svg viewBox="0 0 770 255" role="img" aria-label="Faction deduction trend. Exact values and sample sizes are in the table below.">${lines}${segments("baseline")}${segments("value")}${rows.map((row, i) => `${row.value != null ? `${row.ci?.every(Number.isFinite) ? `<line x1="${x(i)}" x2="${x(i)}" y1="${y(row.ci[0])}" y2="${y(row.ci[1])}" class="chart-interval"/>` : ""}<circle cx="${x(i)}" cy="${y(row.value)}" r="5" class="chart-dot"/>` : ""}<text x="${x(i)}" y="240" text-anchor="middle">${row.label}</text>`).join("")}</svg>`;
  $("#trend-values").innerHTML = rows.map(row => `<tr><th scope="row">${row.label}</th><td>${formatMetric(row.value)}</td><td>${interval(row, "pct")}</td><td>${formatMetric(row.baseline)}</td><td>${count(row.denominator)}</td><td>${count(row.games)}</td></tr>`).join("");
}

function render() {
  for (const button of document.querySelectorAll("[data-kind]")) button.setAttribute("aria-pressed", String(button.dataset.kind === kind));
  const overview = data[kind].overview;
  const cards = [[overview.games, "recorded games"], ...Object.entries(overview.wins).map(([winner, n]) => [n, `${winner[0].toUpperCase() + winner.slice(1)} wins`]), [overview.surveys, "accepted belief surveys"]];
  $("#metrics-overview").innerHTML = cards.map(([value, label]) => `<div class="panel"><strong>${count(value)}</strong><span>${esc(label)}</span></div>`).join("");
  $("#metric-select").innerHTML = ["Outcomes", "Beliefs & deduction", "Votes & social behavior"].map(group => `<optgroup label="${esc(group)}">${data.catalog[kind].filter(item => item.group === group).map(item => `<option value="${esc(item.key)}">${esc(item.label)}</option>`).join("")}</optgroup>`).join("");
  $("#metric-select").value = metric;
  $("#trend-model").value = model;
  $("#trend-phase").value = phase;
  renderComparison();
  renderTrend();
  saveHash();
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  kind = params.get("game") === "avalon" ? "avalon" : "mafia";
  metric = data.catalog[kind].some(item => item.key === params.get("metric")) ? params.get("metric") : kind === "mafia" ? "mafiaDetectionAuc" : "servantEvilAuc";
  model = data.models.includes(params.get("model")) ? params.get("model") : "All models";
  phase = params.get("phase") === "pre" ? "pre" : "post";
  render();
}

for (const button of document.querySelectorAll("[data-kind]")) button.onclick = () => {
  if (!data) return;
  kind = button.dataset.kind;
  if (!data.catalog[kind].some(item => item.key === metric)) metric = kind === "mafia" ? "mafiaDetectionAuc" : "servantEvilAuc";
  render();
};
$("#metric-select").onchange = event => { metric = event.target.value; renderComparison(); saveHash(); };
$("#trend-model").onchange = event => { model = event.target.value; renderTrend(); saveHash(); };
$("#trend-phase").onchange = event => { phase = event.target.value; renderTrend(); saveHash(); };
window.addEventListener("hashchange", () => { if (data && location.hash !== "#methodology" && location.hash !== "#metrics") readHash(); });

async function initialize() {
  $("#metrics-error").hidden = true;
  try {
    const response = await fetch(new URL("./data/metrics.json", import.meta.url));
    if (!response.ok) throw new Error(`Metrics request failed (${response.status}).`);
    data = await response.json();
    $("#trend-model").innerHTML = ["All models", ...data.models].map(name => `<option>${esc(name)}</option>`).join("");
    readHash();
    for (const id of ["metric-select", "trend-model", "trend-phase"]) $(`#${id}`).disabled = false;
    $("#metrics-provenance").textContent = `Computed ${new Date(data.generated).toISOString().slice(0, 10)} · Source: ${data.source.archive} · The download includes the archive and original results SHA-256 checksums.`;
  } catch (error) {
    const node = $("#metrics-error");
    node.textContent = `Could not load metrics. ${error.message} `;
    const retry = document.createElement("button");
    retry.textContent = "Try again";
    retry.onclick = initialize;
    node.append(retry);
    node.hidden = false;
  } finally {
    $("#metrics").setAttribute("aria-busy", "false");
  }
}
void initialize();
