import test from "node:test";
import assert from "node:assert/strict";
import {
  visibleEvents,
  nextPosition,
  latestSurvey,
  knownPlayers,
  transcriptEntries,
  pollResponses,
  voteTally,
  checkpointSurveys,
  perceivedRoleComparison,
} from "../docs/replay.js";

test("checkpoint comparison uses one latest report per other player, excludes self and future reports", () => {
  const recording = { players: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] };
  const report = (player, position, mafia) => ({ player, position, checkpoint: `e${position}`, beliefs: [{ player: "a", probabilities: { mafia, villager: 1 - mafia } }] });
  const surveys = [
    report("b", 7, 1), // future response deliberately comes first
    report("a", 4, 1), // a's own true-role belief must not enter the average
    report("b", 2, .9),
    report("c", 3, .6), // still the latest report for this respondent
    report("b", 4, .2),
    report("b", 1, 0), // arrival order is not checkpoint order
  ];
  surveys[1].perceivedRole = { mafia: .1, villager: .9 };
  const snapshot = checkpointSurveys(recording, surveys, 4);
  assert.equal(snapshot[1].survey.position, 4);
  assert.equal(snapshot[2].survey.position, 3);
  assert.equal(snapshot[3].survey, null);
  const comparison = perceivedRoleComparison(snapshot, "a");
  assert.deepEqual(comparison.contributors.map(row => row.player.id), ["b", "c"]);
  assert.equal(comparison.rows.find(row => row.role === "mafia").average, .4);
  assert.equal(comparison.rows.find(row => row.role === "mafia").perceived, .1);
  assert.equal(perceivedRoleComparison(checkpointSurveys(recording, surveys, 0), "a").rows.length, 0);
  const before = perceivedRoleComparison(checkpointSurveys(recording, surveys, 3), "a");
  assert.equal(before.rows.find(row => row.role === "mafia").average, .75);
  assert.equal(before.rows.find(row => row.role === "mafia").perceived, null);
});

test("missing target beliefs do not dilute the average and missing perceived roles remain unknown", () => {
  const snapshot = [
    { player: { id: "a" }, survey: { perceivedRole: { mafia: .3 }, beliefs: [] } },
    { player: { id: "b" }, survey: { beliefs: [{ player: "a", probabilities: { mafia: .2, villager: .8 } }] } },
    { player: { id: "c" }, survey: { beliefs: [{ player: "b", probabilities: { mafia: 1 } }] } },
    { player: { id: "d" }, survey: null },
  ];
  const comparison = perceivedRoleComparison(snapshot, "a");
  assert.equal(comparison.contributors.length, 1);
  assert.deepEqual(comparison.rows, [
    { role: "mafia", perceived: .3, average: .2 },
    { role: "villager", perceived: null, average: .8 },
  ]);
});

test("polls stay between their original events, including repeated polls after a declined turn", () => {
  const recording = {
    players: [],
    events: [
      { id: "e1", visibility: "public" },
      { id: "e2", visibility: "public" },
    ],
    polls: [
      { id: "poll-1", afterEventCount: 1 },
      { id: "poll-2", afterEventCount: 1 },
    ],
  };
  assert.deepEqual(
    transcriptEntries(recording, "spectator", 1).map((e) => e.id),
    ["e1"],
  );
  assert.deepEqual(
    transcriptEntries(recording, "spectator", 2).map((e) => e.id),
    ["e1", "poll-1", "poll-2", "e2"],
  );
});
test("urgency scores respect the selected perspective", () => {
  const poll = {
    responses: [
      { player: "p1", urgency: 8 },
      { player: "p2", urgency: null },
    ],
  };
  assert.deepEqual(pollResponses(poll, "spectator"), []);
  assert.deepEqual(pollResponses(poll, "p2"), [
    { player: "p2", urgency: null },
  ]);
  assert.equal(pollResponses(poll, "researcher").length, 2);
});
test("final vote counts include ties, abstentions, and the recorded threshold", () => {
  const tally = voteTally({
    type: "votes",
    minimumVotes: 3,
    ballots: [
      { target: "p1" },
      { target: "p2" },
      { target: null },
      { target: "p1" },
      { target: "p2" },
    ],
  });
  assert.deepEqual(tally, {
    total: 5,
    threshold: 3,
    rows: [
      { target: "p1", count: 2 },
      { target: "p2", count: 2 },
      { target: null, count: 1 },
    ],
  });
  assert.deepEqual(
    voteTally({
      type: "team-vote",
      votes: [{ approve: true }, { approve: false }, { approve: false }],
    }),
    {
      total: 3,
      threshold: 2,
      rows: [
        { target: "Approve", count: 1 },
        { target: "Reject", count: 2 },
      ],
    },
  );
});

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
