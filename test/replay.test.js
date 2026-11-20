import test from "node:test";
import assert from "node:assert/strict";
import {
  visibleEvents,
  nextPosition,
  latestSurvey,
  knownPlayers,
} from "../docs/replay.js";

const game = {
  players: [
    { id: "p1", role: "mafia" },
    { id: "p2", role: "detective" },
    { id: "p3", role: "villager" },
  ],
  events: [
    { id: "e1", visibility: "public" },
    { id: "e2", visibility: "mafia" },
    { id: "e3", visibility: "private", recipient: "p2" },
    { id: "e4", visibility: "public" },
  ],
};
test("perspectives expose only the events available to that role", () => {
  for (const [view, ids] of [
    ["spectator", ["e1", "e4"]],
    ["p1", ["e1", "e2", "e4"]],
    ["p2", ["e1", "e3", "e4"]],
    ["p3", ["e1", "e4"]],
    ["researcher", ["e1", "e2", "e3", "e4"]],
  ]) {
    assert.deepEqual(
      visibleEvents(game, view).map((e) => e.id),
      ids,
    );
  }
  assert.deepEqual(
    visibleEvents(game, "researcher", 2).map((e) => e.id),
    ["e1", "e2"],
  );
});
test("playback skips invisible events and handles both ends", () => {
  assert.equal(nextPosition(game, "spectator", 1, 1), 4);
  assert.equal(nextPosition(game, "spectator", 4, -1), 1);
  assert.equal(nextPosition(game, "spectator", 1, -1), 0);
  assert.equal(nextPosition(game, "researcher", 4, 1), 4);
});
test("late-arriving surveys follow checkpoints without leaking future beliefs", () => {
  const surveys = [
    { player: "p1", position: 8 },
    { player: "p2", position: 4 },
    { player: "p1", position: 2 },
    { player: "p1", position: 5 },
  ];
  assert.equal(latestSurvey(surveys, "p1", 1), null);
  assert.equal(latestSurvey(surveys, "p1", 4).position, 2);
  assert.equal(latestSurvey(surveys, "p1", 8).position, 8);
});
test("Avalon private knowledge respects Mordred and Oberon rules", () => {
  const avalon = {
    players: [
      "Merlin",
      "Mordred",
      "Oberon",
      "Assassin",
      "Morgana",
      "Percival",
    ].map((role) => ({ id: role, role })),
  };
  assert.deepEqual(
    knownPlayers(avalon, avalon.players[0]).map((p) => p.role),
    ["Oberon", "Assassin", "Morgana"],
  );
  assert.deepEqual(
    knownPlayers(avalon, avalon.players[1]).map((p) => p.role),
    ["Assassin", "Morgana"],
  );
  assert.deepEqual(knownPlayers(avalon, avalon.players[2]), []);
  assert.deepEqual(
    knownPlayers(avalon, avalon.players[5]).map((p) => p.role),
    ["Merlin", "Morgana"],
  );
});
