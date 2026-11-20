export const evilRoles = new Set([
  "mafia",
  "Assassin",
  "Morgana",
  "Mordred",
  "Oberon",
  "Minion",
]);
export const modelNames = {
  "openai/gpt-6.1-terra": "GPT-6.1 Terra",
  "anthropic/claude-haiku-5.5": "Claude Haiku 5.5",
  "google/gemini-3.8-flash": "Gemini 3.8 Flash",
  deepseek: "DeepSeek V4.1 Flash",
  glm: "GLM 5.3 Flash",
  mimo: "MiMo V2.6 Flash",
  minimax: "MiniMax M3.1 Flash",
};
export const title = (text = "") =>
  String(text)
    .replaceAll("-", " ")
    .replace(/^./, (c) => c.toUpperCase());
export const modelName = (value) => modelNames[value] || value;
export const roleName = (value) =>
  ({
    villager: "Town",
    detective: "Detective",
    doctor: "Doctor",
    mafia: "Mafia",
  })[value] || value;
export function visibleEvent(event, perspective, players) {
  if (perspective === "researcher" || event.visibility === "public")
    return true;
  const player = players.find((p) => p.id === perspective);
  if (!player) return false;
  return (
    (event.visibility === "private" && event.recipient === player.id) ||
    (event.visibility === "mafia" && player.role === "mafia")
  );
}
export function visibleEvents(
  game,
  perspective,
  position = game.events.length,
) {
  return game.events
    .slice(0, position)
    .filter((e) => visibleEvent(e, perspective, game.players));
}
export function nextPosition(game, perspective, position, direction) {
  if (direction > 0) {
    for (let i = position; i < game.events.length; i++) {
      if (visibleEvent(game.events[i], perspective, game.players)) return i + 1;
    }
    return game.events.length;
  }
  for (let i = position - 2; i >= 0; i--) {
    if (visibleEvent(game.events[i], perspective, game.players)) return i + 1;
  }
  return 0;
}
export function latestSurvey(surveys, player, position) {
  // Answers can arrive out of order; their frozen event position defines the replay.
  return surveys
    .filter((s) => s.player === player && s.position <= position)
    .reduce(
      (latest, survey) =>
        !latest || survey.position >= latest.position ? survey : latest,
      null,
    );
}
export function knownPlayers(game, player) {
  if (!player) return [];
  if (player.role === "Percival")
    return game.players.filter((p) => ["Merlin", "Morgana"].includes(p.role));
  if (player.role === "Merlin")
    return game.players.filter(
      (p) => evilRoles.has(p.role) && p.role !== "Mordred",
    );
  if (evilRoles.has(player.role) && player.role !== "Oberon") {
    return game.players.filter(
      (p) => p.id !== player.id && evilRoles.has(p.role) && p.role !== "Oberon",
    );
  }
  return [];
}

// Polls are attached to the next logged event so event IDs and survey checkpoints
// stay unchanged. Multiple polls can precede one message when turns are declined.
export function transcriptEntries(game, perspective, position) {
  const entries = [];
  for (let i = 0; i < Math.min(position, game.events.length); i++) {
    for (const poll of game.polls || []) {
      if (poll.afterEventCount === i)
        entries.push({ type: "urgency-poll", ...poll });
    }
    const event = game.events[i];
    if (visibleEvent(event, perspective, game.players)) entries.push(event);
  }
  return entries;
}

export function pollResponses(poll, perspective) {
  if (perspective === "researcher") return poll.responses;
  return poll.responses.filter((response) => response.player === perspective);
}

export function voteTally(event) {
  if (event.type === "team-vote") {
    const votes = event.votes || [];
    return {
      total: votes.length,
      threshold: Math.floor(votes.length / 2) + 1,
      rows: [
        {
          target: "Approve",
          count: votes.filter((v) => v.approve === true).length,
        },
        {
          target: "Reject",
          count: votes.filter((v) => v.approve === false).length,
        },
      ],
    };
  }
  const votes = event.ballots || [];
  const counts = new Map();
  for (const vote of votes) {
    const target = vote.target || null;
    counts.set(target, (counts.get(target) || 0) + 1);
  }
  return {
    total: votes.length,
    threshold: event.minimumVotes,
    rows: [...counts]
      .map(([target, count]) => ({ target, count }))
      .sort((a, b) => b.count - a.count),
  };
}
