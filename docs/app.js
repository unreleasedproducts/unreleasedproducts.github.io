import {
  title,
  modelName,
  roleName,
  visibleEvents,
  nextPosition,
  latestSurvey,
  knownPlayers,
  transcriptEntries,
  pollResponses,
  voteTally,
  checkpointSurveys,
  perceivedRoleComparison,
} from "./replay.js?v=checkpoint-1";

const $ = (selector) => document.querySelector(selector);
const esc = (value = "") =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const number = (value) => Number(value).toLocaleString("en-US");
let manifest,
  game,
  surveys,
  kind = "mafia",
  position = 0,
  perspective = "spectator",
  respondent;
let timer,
  request = 0,
  surveyRequest = 0;
const gameCache = new Map();
const surveyCache = new Map();
let detailEventPosition = null;
const name = (id) =>
  game?.players.find((p) => p.id === id || p.name === id)?.name ||
  id ||
  "Abstain";
const player = (id) => game?.players.find((p) => p.id === id);

async function fetchJSON(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok)
    throw new Error(
      `Could not load the recording (${response.status}). Please try again.`,
    );
  return response.json();
}
function cache(map, id, value) {
  map.set(id, value);
  if (map.size > 3) map.delete(map.keys().next().value);
}
function showError(error, retry) {
  const node = $("#error");
  node.textContent = error.message;
  node.hidden = false;
  if (retry) {
    const button = document.createElement("button");
    button.textContent = "Try again";
    button.onclick = () => {
      node.hidden = true;
      retry();
    };
    node.append(button);
  }
}
function stop() {
  clearInterval(timer);
  timer = null;
  $("#play").textContent = "Play replay";
}
function updateHash() {
  if (!game) return;
  const params = new URLSearchParams({
    game: game.id,
    at: String(position),
    view: perspective,
  });
  history.replaceState(null, "", `#${params}`);
}
function updateKind(next) {
  kind = next;
  for (const tab of document.querySelectorAll("[data-game]"))
    tab.setAttribute("aria-pressed", String(tab.dataset.game === kind));
  const outcomes = kind === "mafia" ? ["town", "mafia"] : ["good", "evil"];
  $("#outcome").innerHTML =
    '<option value="all">Any outcome</option>' +
    outcomes
      .map((o) => `<option value="${o}">${title(o)} wins</option>`)
      .join("");
  renderList();
}
function renderList() {
  if (!manifest) return;
  const query = $("#search").value.trim().toLowerCase();
  const outcome = $("#outcome").value;
  const rows = manifest.games.filter(
    (g) =>
      g.game === kind &&
      (outcome === "all" || g.winner === outcome) &&
      `${g.seed} ${g.index} ${g.models.map(modelName).join(" ")}`
        .toLowerCase()
        .includes(query),
  );
  $("#game-count").textContent = rows.length;
  $("#game-list").innerHTML =
    rows
      .map(
        (
          g,
        ) => `<button class="game-card" data-id="${g.id}" aria-current="${g.id === game?.id}">
    <span class="game-card-title">${title(g.game)} ${String(g.index).padStart(3, "0")}<span class="card-icon" aria-hidden="true">▷</span></span>
    <small>${g.players} players · ${number(g.events)} events<br>${number(g.surveys)} surveys${outcome !== "all" || perspective === "researcher" ? ` · ${title(g.winner)} wins` : ""}</small></button>`,
      )
      .join("") || '<p class="muted">No recordings match your search.</p>';
}
async function loadGame(
  id,
  initialPosition = 0,
  initialPerspective = "spectator",
) {
  const summary = manifest.games.find((g) => g.id === id);
  if (!summary) {
    showError(
      new Error("That game is not in this release. Select another recording."),
    );
    return;
  }
  const version = ++request;
  $("#message-detail").close();
  detailEventPosition = null;
  ++surveyRequest;
  stop();
  $("#replay").setAttribute("aria-busy", "true");
  $("#chapter-jumps").hidden = true;
  $("#error").hidden = true;
  // Disable the previous recording while the new one is loading.
  for (const id of [
    "restart",
    "previous",
    "play",
    "next",
    "finish",
    "timeline",
    "perspective",
  ])
    $(`#${id}`).disabled = true;
  try {
    const loaded =
      gameCache.get(id) || (await fetchJSON(`./data/games/${id}.json`));
    if (version !== request) return;
    cache(gameCache, id, loaded);
    game = loaded;
    surveys = surveyCache.get(id) || null;
    perspective = [
      "spectator",
      "researcher",
      ...game.players.map((p) => p.id),
    ].includes(initialPerspective)
      ? initialPerspective
      : "spectator";
    respondent = game.players[0].id;
    position = Math.max(
      0,
      Math.min(game.events.length, Math.floor(Number(initialPosition) || 0)),
    );
    if (kind !== game.game) updateKind(game.game);
    $("#game-subtitle").textContent =
      `${game.game.toUpperCase()} · RELEASE ${manifest.release}`;
    $("#game-title").textContent =
      `${title(game.game)} ${String(game.index).padStart(3, "0")}`;
    $("#game-meta").innerHTML =
      `<span>${game.players.length} players</span><span>${number(game.calls)} model calls</span><span>${number(game.surveys)} belief surveys</span>`;
    $("#perspective").innerHTML =
      '<option value="spectator">Spectator · hidden roles</option><option value="researcher">Researcher · all roles</option>' +
      game.players
        .map(
          (p) =>
            `<option value="${esc(p.id)}">${esc(p.name)}’s perspective</option>`,
        )
        .join("");
    $("#perspective").value = perspective;
    $("#respondent").innerHTML = game.players
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
      .join("");
    const download = $("#download");
    download.href = `./data/games/${id}.json`;
    download.download = `${game.seed}-replay.json`;
    download.hidden = false;
    $("#perspective").disabled = false;
    $("#timeline").max = game.events.length;
    $("#timeline").disabled = false;
    const chapterField = game.game === "mafia" ? "day" : "mission";
    const chapterLabel = game.game === "mafia" ? "Day" : "Mission";
    const chapters = new Map();
    game.events.forEach((event, index) => {
      const chapter = Number(event[chapterField]);
      if (chapter > 0 && !chapters.has(chapter))
        chapters.set(chapter, index + 1);
    });
    $("#chapter-jumps").innerHTML =
      "<span>Jump to</span>" +
      [...chapters]
        .map(
          ([chapter, start]) =>
            `<button type="button" data-chapter="${chapter}" data-position="${start}" title="Jump to the start of ${chapterLabel.toLowerCase()} ${chapter}">${chapterLabel} ${chapter}</button>`,
        )
        .join("");
    $("#chapter-jumps").hidden = chapters.size === 0;
    $("#replay").setAttribute("aria-busy", "false");
    renderList();
    render();
    if (perspective !== "spectator") void loadSurveys();
  } catch (error) {
    if (version !== request) return;
    $("#replay").setAttribute("aria-busy", "false");
    showError(error, () => loadGame(id, initialPosition, initialPerspective));
  }
}
async function loadSurveys() {
  if (!game || surveys) return;
  const id = game.id;
  const version = ++surveyRequest;
  $("#survey-status").textContent = "Loading recorded beliefs…";
  try {
    const loaded = await fetchJSON(`./data/surveys/${id}.json`);
    if (version !== surveyRequest || game.id !== id) return;
    surveys = loaded;
    cache(surveyCache, id, loaded);
    renderInspector();
    renderMessageDetail();
  } catch (error) {
    if (version !== surveyRequest || game.id !== id) return;
    $("#survey-status").textContent = "Beliefs could not be loaded.";
    if ($("#message-detail").open) {
      $("#detail-status").textContent = "Beliefs could not be loaded. ";
      const retry = document.createElement("button");
      retry.textContent = "Try again";
      retry.onclick = () => { $("#detail-status").textContent = "Loading recorded surveys…"; void loadSurveys(); };
      $("#detail-status").append(retry);
    }
    showError(error, () => loadSurveys());
  }
}
function renderRoster() {
  const deaths = new Set(
    game.events
      .slice(0, position)
      .filter((e) => ["elimination", "night-elimination"].includes(e.type))
      .map((e) => e.target),
  );
  const speaker = visibleEvents(game, perspective, position).at(-1)?.player;
  $("#roster").innerHTML = game.players
    .map(
      (
        p,
      ) => `<button class="player ${deaths.has(p.id) ? "eliminated" : ""} ${p.id === perspective || p.id === speaker ? "selected" : ""}" data-player="${esc(p.id)}" aria-label="View ${esc(p.name)}’s perspective">
    <span class="avatar">${esc(p.name.slice(0, 2).toUpperCase())}</span><span><strong>${esc(p.name)}</strong><small>${esc(modelName(p.model))}</small>
    ${perspective === "researcher" || perspective === p.id ? `<small class="role">${esc(roleName(p.role))}</small>` : ""}${deaths.has(p.id) ? "<small>Eliminated</small>" : ""}</span></button>`,
    )
    .join("");
}
function renderPoll(poll) {
  const responses = pollResponses(poll, perspective);
  const highest = Math.max(0, ...poll.responses.map((r) => r.urgency || 0));
  const tied = poll.responses.filter((r) => r.urgency === highest).length > 1;
  return `<article class="poll-entry" aria-label="Urgency poll ${poll.poll}">
    <div class="poll-heading"><strong>Urgency poll ${poll.poll}</strong><span>${poll.selected ? `Floor to ${esc(name(poll.selected))}` : "No speaker selected"}${perspective === "researcher" && poll.selected && tied ? " · random tiebreak" : ""}</span></div>
    ${responses.length ? `<div class="poll-responses">${responses.map((r) => `<span class="poll-score ${r.player === poll.selected ? "chosen" : ""}">${esc(name(r.player))} <strong>${r.urgency == null ? "Pass" : `${r.urgency}/10`}</strong></span>`).join("")}</div>` : ""}
    ${perspective !== "researcher" ? `<small>${perspective === "spectator" ? "Scores are private · choose Researcher to inspect" : "Only your own urgency is visible"}</small>` : ""}
  </article>`;
}
function renderTally(event) {
  const tally = voteTally(event);
  return `<div class="vote-summary"><div><strong>Final tally</strong><span>${tally.total} ballots${tally.threshold ? ` · ${tally.threshold} needed ${event.type === "team-vote" ? "to approve" : "to eliminate"}` : ""}</span></div>
    <div class="tally-counts">${tally.rows.map((row) => `<span><strong>${esc(event.type === "team-vote" ? row.target : name(row.target))}</strong><b>${row.count}</b></span>`).join("")}</div></div>`;
}
function renderTranscript() {
  const events = transcriptEntries(game, perspective, position);
  const positions = new Map(game.events.map((event, index) => [event.id, index + 1]));
  const rendered = events.map((e, i) => {
    if (e.type === "urgency-poll") return renderPoll(e);
    const phase =
      game.game === "mafia" ? `Day ${e.day || 1}` : `Mission ${e.mission || 1}`;
    const votes = e.ballots || e.votes || [];
    return `<article data-event-position="${positions.get(e.id)}" class="event inspectable ${e.type === "speech" ? "" : "system"} ${e.visibility !== "public" ? "private" : ""} ${i === events.length - 1 ? "latest" : ""}">
      <div class="event-head"><strong>${esc(e.player ? name(e.player) : "Game moderator")}</strong><small>${phase} · ${esc(title(e.type))}</small>
      ${e.visibility !== "public" ? '<span class="tag">Private</span>' : ""}<small class="event-index">${esc(e.id)}</small></div>
      <p>${esc(e.text)}</p>${Array.isArray(votes) && votes.length ? `<div class="ballots">${votes.map((v) => `<span>${esc(name(v.player))}: ${v.approve === undefined ? esc(name(v.target)) : v.approve ? "Approve" : "Reject"}</span>`).join("")}</div>` : ""}
      ${["votes", "team-vote"].includes(e.type) ? renderTally(e) : ""}
      ${e.type === "speech" && Object.hasOwn(e, "yieldTo") ? `<div class="yield-note">${e.yieldTo ? `Yields to <strong>${esc(name(e.yieldTo))}</strong>` : "No yield"}</div>` : ""}
      <button type="button" class="inspect-message" aria-label="Inspect surveys at event ${esc(e.id)}" aria-haspopup="dialog">Inspect checkpoint</button></article>`;
  });
  let transcript = rendered.join("");
  if (game.game === "avalon") {
    const missions = [];
    events.forEach((event, index) => {
      const mission = Number(event.mission) || 1;
      if (missions.at(-1)?.number !== mission) {
        missions.push({ number: mission, entries: [] });
      }
      missions.at(-1).entries.push(rendered[index]);
    });
    transcript = missions
      .map(
        (
          mission,
        ) => `<section class="mission-cell mission-${mission.number}" aria-label="Mission ${mission.number}">
      <h3 class="mission-heading">Mission ${mission.number}</h3>
      <div class="mission-content">${mission.entries.join("")}</div>
    </section>`,
      )
      .join("");
  }
  $("#transcript").innerHTML =
    transcript ||
    `<div class="empty"><span aria-hidden="true">◈</span><h3>The table is set.</h3><p>Press Play replay or Next to reveal the first event.<br>Use Full game to read the complete transcript.</p></div>`;
  const last = events.at(-1);
  $("#phase").textContent = last
    ? `${game.game === "mafia" ? `Day ${last.day || 1}` : `Mission ${last.mission || 1}`} · ${title(last.type)}`
    : "Beginning of recording";
  if ($("#follow").checked)
    $("#transcript").scrollTop = $("#transcript").scrollHeight;
}
function distributionRows(probabilities) {
  const entries = Object.entries(probabilities || {});
  if (!entries.length) return '<p class="muted">Not recorded.</p>';
  return entries.map(([role, probability]) => {
    const valid = Number.isFinite(probability);
    const percent = valid ? Math.max(0, Math.min(100, probability * 100)) : 0;
    return `<div class="belief-row"><span>${esc(roleName(role))}</span><span class="bar" aria-hidden="true"><i style="width:${percent}%"></i></span><span>${valid ? (probability * 100).toFixed(1) + "%" : "—"}</span></div>`;
  }).join("");
}

function renderMessageDetail() {
  if (!$("#message-detail").open || detailEventPosition == null) return;
  const event = game.events[detailEventPosition - 1];
  const checkpointPosition = detailEventPosition - ($("#detail-timing").value === "before" ? 1 : 0);
  const checkpoint = game.events[checkpointPosition - 1]?.id || "before the first event";
  const subject = $("#detail-player").value;
  $("#detail-title").textContent = `${event.id} · ${event.player ? name(event.player) : "Game moderator"} · ${game.game === "mafia" ? `Day ${event.day || 1}` : `Mission ${event.mission || 1}`}`;
  $("#detail-message").textContent = event.text || title(event.type);
  $("#detail-content").hidden = !surveys;
  if (!surveys) {
    $("#detail-status").textContent = "Loading recorded surveys…";
    return;
  }
  const snapshot = checkpointSurveys(game, surveys, checkpointPosition);
  const available = snapshot.filter(row => row.survey).length;
  const exact = snapshot.filter(row => row.survey?.position === checkpointPosition).length;
  $("#detail-status").textContent = `Checkpoint ${checkpoint} · ${available}/${snapshot.length} players have a report · ${exact} at this event, ${available - exact} carried forward.`;
  const comparison = perceivedRoleComparison(snapshot, subject);
  $("#role-comparison-title").textContent = `${name(subject)}: perceived role vs. others’ reports`;
  $("#detail-comparison-note").textContent = `${comparison.own?.perceivedRole ? `Self-perception reported at ${comparison.own.checkpoint}${comparison.own.position < checkpointPosition ? " (carried forward)" : ""}.` : "No self-perception report at or before this checkpoint."} This is how the player thinks others see them, not their belief about their actual role.`;
  const cell = (value, className) => `<td><div class="comparison-probability ${className}"><span class="bar" aria-hidden="true"><i style="width:${value == null ? 0 : Math.max(0, Math.min(100, value * 100))}%"></i></span><strong>${value == null ? "—" : (value * 100).toFixed(1) + "%"}</strong></div></td>`;
  $("#detail-comparison").innerHTML = comparison.rows.length
    ? comparison.rows.map(row => `<tr><th scope="row">${esc(roleName(row.role))}</th>${cell(row.perceived, "perceived")}${cell(row.average, "reported")}</tr>`).join("")
    : '<tr><td colspan="3">No role distributions available at this checkpoint.</td></tr>';
  $("#detail-contributors").textContent = comparison.contributors.length
    ? `Equal-weight average of ${comparison.contributors.length} other players; excludes ${name(subject)}’s own report. Includes all factions and any eliminated players with a prior report. Contributors: ${comparison.contributors.map(row => `${row.player.name} (${row.survey.checkpoint}${row.survey.position < checkpointPosition ? ", earlier" : ""})`).join(", ")}.`
    : "No other player has reported a role distribution about this player at or before this checkpoint.";
  $("#detail-surveys").innerHTML = snapshot.map(({ player: person, survey }) => {
    if (!survey) return `<div class="checkpoint-missing"><strong>${esc(person.name)}</strong><span>No report at or before this checkpoint.</span></div>`;
    return `<details class="checkpoint-survey" ${person.id === subject ? "open" : ""}><summary><strong>${esc(person.name)}</strong><span>${esc(modelName(person.model))}</span><span class="survey-checkpoint">${esc(survey.checkpoint)} · ${survey.position === checkpointPosition ? "At this event" : "Earlier report"}</span></summary><div class="checkpoint-survey-body">
      <p class="muted">Intended vote: <strong>${esc(survey.intendedVote == null ? "Not recorded" : name(survey.intendedVote))}</strong></p>
      <div class="belief-person self-perception"><strong>How ${esc(person.name)} thinks others see them</strong>${distributionRows(survey.perceivedRole)}</div>
      <h4>Reported role beliefs about each player</h4><div class="survey-belief-grid">${survey.beliefs.map(belief => `<div class="belief-person"><strong>${esc(name(belief.player))}${belief.player === person.id ? " (self)" : ""}</strong>${distributionRows(belief.probabilities)}</div>`).join("") || '<p class="muted">No role beliefs recorded.</p>'}</div>
    </div></details>`;
  }).join("");
  $("#detail-expand").textContent = "Expand all";
}

function openMessageDetail(eventPosition) {
  if (!game || $("#replay").getAttribute("aria-busy") === "true") return;
  const event = game.events[eventPosition - 1];
  if (!event) return;
  stop();
  detailEventPosition = eventPosition;
  $("#detail-timing").value = "after";
  $("#detail-player").innerHTML = game.players.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  $("#detail-player").value = player(event.player)?.id || game.players[0].id;
  for (const node of document.querySelectorAll("[data-event-position]"))
    node.classList.toggle("inspecting", Number(node.dataset.eventPosition) === eventPosition);
  $("#message-detail").showModal();
  renderMessageDetail();
  $("#message-detail").scrollTop = 0;
  if (!surveys) void loadSurveys();
}

function renderInspector() {
  const research = perspective === "researcher";
  const spectator = perspective === "spectator";
  const selected = player(perspective);
  $("#perspective-note").textContent = spectator
    ? "Public events only. Roles stay hidden. Select a player or the researcher view to explore private information."
    : research
      ? "All roles and private events are visible. Beliefs follow the replay position."
      : `${selected.name}’s view includes public events and information available to their role. Other players’ roles stay hidden.`;
  $("#survey-controls").hidden = spectator;
  const known = knownPlayers(game, selected);
  $("#knowledge").innerHTML = selected
    ? `<div class="knowledge-card"><strong>${esc(selected.name)} · ${esc(roleName(selected.role))}</strong><p>${esc(modelName(selected.model))}</p>
    ${known.length ? `<p>${selected.role === "Percival" ? "Merlin is one of" : selected.role === "Merlin" ? "Known evil players" : "Known teammates"}: ${esc(known.map((p) => p.name).join(", "))}.</p>` : "<p>No other players are identified by this role at the start.</p>"}</div>`
    : research
      ? '<div class="knowledge-card"><strong>Researcher view</strong><p>Includes hidden information and reveals the recorded outcome in the game list.</p></div>'
      : "";
  if (spectator) return;
  if (!research) respondent = perspective;
  $("#respondent").value = respondent;
  $("#respondent").disabled = !research;
  $("#beliefs").innerHTML = "";
  if (!surveys) {
    $("#survey-status").textContent = "Loading recorded beliefs…";
    return;
  }
  const survey = latestSurvey(surveys, respondent, position);
  if (!survey) {
    $("#survey-status").textContent =
      "No survey recorded for this player at or before this point.";
    return;
  }
  $("#survey-status").textContent =
    `Latest survey: ${survey.checkpoint} · ${name(respondent)}`;
  const rows = (probabilities) =>
    Object.entries(probabilities || {})
      .sort((a, b) => b[1] - a[1])
      .map(([role, probability]) => {
        const percent = Math.max(0, Math.min(100, Number(probability) * 100));
        return `<div class="belief-row"><span>${esc(roleName(role))}</span><span class="bar" aria-hidden="true"><i style="width:${Number.isFinite(percent) ? percent : 0}%"></i></span><span>${Number.isFinite(percent) ? Math.round(percent) + "%" : "—"}</span></div>`;
      })
      .join("");
  $("#beliefs").innerHTML =
    (survey.intendedVote
      ? `<p class="muted">Intended vote: <strong>${esc(name(survey.intendedVote))}</strong></p>`
      : "") +
    survey.beliefs
      .map(
        (b) =>
          `<div class="belief-person"><strong>${esc(name(b.player))}</strong>${rows(b.probabilities)}</div>`,
      )
      .join("");
}
function render() {
  if (!game) return;
  const currentChapter =
    game.events[position - 1]?.[game.game === "mafia" ? "day" : "mission"];
  for (const button of $("#chapter-jumps").querySelectorAll("button")) {
    if (Number(button.dataset.chapter) === currentChapter)
      button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
  $("#timeline").value = position;
  $("#position").textContent = `${position} / ${game.events.length}`;
  $("#timeline").setAttribute(
    "aria-valuetext",
    `Event ${position} of ${game.events.length}`,
  );
  $("#restart").disabled = $("#previous").disabled = position === 0;
  $("#next").disabled = $("#finish").disabled = position === game.events.length;
  $("#play").disabled = false;
  renderRoster();
  renderTranscript();
  renderInspector();
  updateHash();
}
function seek(value) {
  position = Math.max(0, Math.min(game.events.length, Number(value)));
  if (position === game.events.length) stop();
  render();
}
function setPerspective(value) {
  stop();
  perspective = value;
  $("#perspective").value = value;
  render();
  renderList();
  if (perspective !== "spectator") void loadSurveys();
}
function start() {
  if (!game) return;
  if (position === game.events.length) seek(0);
  timer = setInterval(
    () => seek(nextPosition(game, perspective, position, 1)),
    Number($("#speed").value),
  );
  $("#play").textContent = "Pause replay";
}

$("#game-list").onclick = (event) => {
  const card = event.target.closest("[data-id]");
  if (card) void loadGame(card.dataset.id);
};
for (const tab of document.querySelectorAll("[data-game]"))
  tab.onclick = () => {
    if (!manifest) return;
    $("#search").value = "";
    updateKind(tab.dataset.game);
    void loadGame(manifest.games.find((g) => g.game === kind).id);
  };
$("#search").oninput = renderList;
$("#outcome").onchange = renderList;
$("#perspective").onchange = () => setPerspective($("#perspective").value);
$("#roster").onclick = (event) => {
  const card = event.target.closest("[data-player]");
  if (card && $("#replay").getAttribute("aria-busy") !== "true")
    setPerspective(card.dataset.player);
};
$("#respondent").onchange = () => {
  respondent = $("#respondent").value;
  renderInspector();
};
$("#restart").onclick = () => {
  stop();
  seek(0);
};
$("#previous").onclick = () => {
  stop();
  seek(nextPosition(game, perspective, position, -1));
};
$("#next").onclick = () => {
  stop();
  seek(nextPosition(game, perspective, position, 1));
};
$("#finish").onclick = () => {
  stop();
  seek(game.events.length);
};
$("#timeline").oninput = () => {
  stop();
  seek($("#timeline").value);
};
$("#chapter-jumps").onclick = (event) => {
  const button = event.target.closest("button[data-position]");
  if (!button || !game || $("#replay").getAttribute("aria-busy") === "true")
    return;
  stop();
  seek(Number(button.dataset.position));
  // A deliberate jump should reveal the destination even with follow disabled.
  $("#transcript").scrollTo({
    top: $("#transcript").scrollHeight,
    behavior: "instant",
  });
  const entries = $("#transcript").querySelectorAll(".event");
  entries[entries.length - 1]?.scrollIntoView({
    block: "nearest",
    behavior: "instant",
  });
};
$("#play").onclick = () => (timer ? stop() : start());
$("#speed").onchange = () => {
  if (timer) {
    stop();
    start();
  }
};
$("#about-button").onclick = () => $("#about").showModal();
$("#transcript").onclick = (event) => {
  const entry = event.target.closest("[data-event-position]");
  if (!entry || (window.getSelection()?.isCollapsed === false && !event.target.closest("button"))) return;
  openMessageDetail(Number(entry.dataset.eventPosition));
};
$("#detail-close").onclick = () => $("#message-detail").close();
$("#message-detail").onclose = () => {
  detailEventPosition = null;
  for (const node of document.querySelectorAll(".event.inspecting")) node.classList.remove("inspecting");
};
$("#detail-timing").onchange = renderMessageDetail;
$("#detail-player").onchange = renderMessageDetail;
$("#detail-expand").onclick = () => {
  const rows = [...document.querySelectorAll("#detail-surveys details")];
  const expand = rows.some(row => !row.open);
  for (const row of rows) row.open = expand;
  $("#detail-expand").textContent = expand ? "Collapse all" : "Expand all";
};
$(".skip").onclick = (event) => {
  event.preventDefault();
  $("#replay").focus();
  $("#replay").scrollIntoView({ block: "start" });
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});
async function openHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  await loadGame(
    params.get("game") || manifest.games[0].id,
    params.get("at"),
    params.get("view") || "spectator",
  );
}
window.addEventListener("hashchange", () => {
  if (manifest) void openHash();
});
async function initialize() {
  try {
    manifest = await fetchJSON("./data/manifest.json");
    updateKind(kind);
    await openHash();
  } catch (error) {
    showError(error, initialize);
  }
}
void initialize();
