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
