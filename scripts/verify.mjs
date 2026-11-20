import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
const root = new URL("../docs/", import.meta.url);
const read = async (path) =>
  JSON.parse(await readFile(new URL(path, root), "utf8"));
const manifest = await read("data/manifest.json");
assert.equal(manifest.games.length, 200);
assert.equal(new Set(manifest.games.map((g) => g.id)).size, 200);
const counts = { mafia: 0, avalon: 0 };
const wins = {};
let events = 0,
  surveys = 0,
  calls = 0;
for (const row of manifest.games) {
  counts[row.game]++;
  wins[row.winner] = (wins[row.winner] || 0) + 1;
  const game = await read(`data/games/${row.id}.json`);
  const beliefs = await read(`data/surveys/${row.id}.json`);
  assert.equal(game.id, row.id);
  assert.equal(game.events.length, row.events);
  assert.equal(game.players.length, row.players);
  assert.equal(beliefs.length, row.surveys);
  assert.equal(new Set(game.events.map((e) => e.id)).size, row.events);
  for (const survey of beliefs) {
    assert.equal(game.events[survey.position - 1]?.id, survey.checkpoint);
    assert(game.players.some((p) => p.id === survey.player));
    for (const belief of survey.beliefs) {
      assert(
        game.players.some(
          (p) => p.id === belief.player || p.name === belief.player,
        ),
      );
      for (const probability of Object.values(belief.probabilities))
        assert(
          Number.isFinite(probability) && probability >= 0 && probability <= 1,
        );
    }
  }
  for (const object of [game, beliefs]) {
    const text = JSON.stringify(object);
    assert(
      !/"(?:apiKey|authorization|baseUrl|headers|prompt|rawOutput)"\s*:/i.test(
        text,
      ),
      `Unexpected operational field in ${row.id}`,
    );
    assert(
      !/sk-(?:or-v1-)?[a-zA-Z0-9]{32,}/.test(text),
      `Possible credential in ${row.id}`,
    );
  }
  events += row.events;
  surveys += row.surveys;
  calls += row.calls;
}
assert.deepEqual(counts, { mafia: 100, avalon: 100 });
assert.deepEqual(wins, { town: 66, mafia: 34, evil: 79, good: 21 });
assert.equal(surveys, 107920);
assert.equal(calls, 163980);
for (const file of [
  "index.html",
  "styles.css",
  "app.js",
  "replay.js",
  ".nojekyll",
])
  await stat(new URL(file, root));
console.log(
  JSON.stringify({
    games: manifest.games.length,
    events,
    surveys,
    calls,
    wins,
  }),
);
