"""Export only replay fields from the verified 0.0.1 release archives.

Usage: python scripts/export_release.py PATH_TO_RELEASE_ASSETS
Requires: pip install zstandard
"""
import hashlib
from bisect import bisect_right
import json
from pathlib import Path
import re
import sys
import tarfile

import zstandard

ROOT = Path(__file__).resolve().parents[1]
HASHES = {
    "mafia": "8df9c0fed9307c99fd05df41cad7e00f708b29f4d67ddb38bdf9ff86019e0b0c",
    "avalon": "73727cf894a6b819721016227e547c1ddad3d504b727fca504016c52cf2fad93",
}
EVENT_FIELDS = (
    "id", "type", "visibility", "recipient", "mission", "day", "phase", "round",
    "player", "text", "team", "target", "ballots", "votes", "success", "fails", "winner",
    "counts", "minimumVotes", "approved",
)


def pick(obj, fields):
    return {k: obj[k] for k in fields if k in obj}


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def time_key(value):
    """Compare UTC recording times without dropping their nanosecond precision."""
    whole, _, fraction = value.removesuffix("Z").partition(".")
    return whole + "." + fraction.ljust(9, "0")


def export_discussion(g, events):
    state = g.get("mafiaState", g)
    turns = state.get("speechTurns", state.get("avalonTurns", []))
    spoken = [turn for turn in turns if turn["spoke"]]
    speeches = [event for event in events if event["type"] == "speech"]
    assert len(spoken) == len(speeches), f"Speech/turn mismatch in {g['id']}"
    for event, turn in zip(speeches, spoken):
        assert event["player"] == turn["player"]
        event["yieldTo"] = turn.get("yieldTo")

    event_times = [time_key(event["time"]) for event in g["events"]]
    assert event_times == sorted(event_times)
    accepted = [c for c in g["calls"] if c["status"] == "ok" or c.get("fallback")]
    urgency_calls = {}
    speech_calls = sorted((c for c in accepted if c["action"]["type"] == "speech"), key=lambda c: time_key(c["started"]))
    for call in accepted:
        action = call["action"]
        if action["type"] == "urgency":
            key = (action["poll"], action["player"])
            previous = urgency_calls.get(key)
            if previous is None or time_key(call["started"]) > time_key(previous["started"]):
                urgency_calls[key] = call
    grouped = {}
    for response in state.get("polls", state.get("avalonPolls", [])):
        grouped.setdefault(response["poll"], []).append(response)
    polls = []
    for poll_id, responses in sorted(grouped.items()):
        calls = [urgency_calls[(poll_id, r["player"])] for r in responses]
        positions = {bisect_right(event_times, time_key(c["started"])) for c in calls}
        assert len(positions) == 1, f"Poll crosses event boundaries in {g['id']}, poll {poll_id}"
        position = positions.pop()
        assert 0 < position < len(events)
        polls.append({
            "id": f"poll-{poll_id}", "poll": poll_id, "afterEventCount": position,
            "day": responses[0].get("day"), "discussion": responses[0].get("discussion"),
            "mission": g["events"][position - 1].get("mission"),
            "responses": [pick(r, ("player", "urgency")) for r in responses],
            "started": min(time_key(c["started"]) for c in calls),
        })
    for i, poll in enumerate(polls):
        end = polls[i + 1]["started"] if i + 1 < len(polls) else "9999"
        next_speech = next((c for c in speech_calls if poll["started"] < time_key(c["started"]) < end), None)
        highest = max((r.get("urgency") or 0 for r in poll["responses"]), default=0)
        leaders = [r["player"] for r in poll["responses"] if r.get("urgency") == highest]
        if next_speech and highest > 0:
            selected = next_speech["action"]["player"]
            assert selected in leaders, f"Poll winner mismatch in {g['id']}, {poll['id']}"
            poll["selected"] = selected
        del poll["started"]
    return polls


def export_game(g):
    kind = g["game"]
    assert kind in HASHES and g["status"] == "completed"
    assert re.fullmatch(r"[0-9a-f-]{36}", g["id"])
    players = [{**pick(p, ("id", "name", "role")),
                "model": p["connection"]["model"]} for p in g["players"]]
    events = [pick(e, EVENT_FIELDS) for e in g["events"]]
    polls = export_discussion(g, events)
    positions = {e["id"]: i + 1 for i, e in enumerate(events)}
    assert len(positions) == len(events)
    by_name = {p["name"]: p["id"] for p in players}
    surveys = []
    source = g["mafiaState"]["reports"] if kind == "mafia" else g["surveys"]
    for s in source:
        checkpoint = s.get("triggerEvent") if kind == "mafia" else s.get("checkpoint")
        assert checkpoint in positions, f"Unknown survey checkpoint: {checkpoint}"
        answer = s["data"] if kind == "mafia" else s
        beliefs = answer.get("roleBeliefs", []) if kind == "mafia" else answer.get("beliefs", [])
        surveys.append({
            "player": s["player"] if kind == "mafia" else by_name[s["player"]],
            "checkpoint": checkpoint,
            "position": positions[checkpoint],
            "beliefs": [{"player": b["player"], "probabilities": b.get("probabilities", b.get("roleProbabilities", {}))} for b in beliefs],
            "perceivedRole": answer.get("perceivedRole", answer.get("perceivedRoleProbabilities")),
            "intendedVote": answer.get("intendedVote"),
        })
    summary = {
        "id": g["id"], "game": kind, "seed": g["config"]["seed"],
        "index": int(g["config"]["seed"].split("-")[-1]),
        "winner": g["winner"], "players": len(players),
        "events": len(events), "surveys": len(surveys), "calls": g["callCount"],
        "polls": len(polls), "yields": sum(bool(e.get("yieldTo")) for e in events),
        "models": sorted({p["model"] for p in players}),
    }
    replay = {**summary, "players": players, "events": events, "polls": polls,
              "promptVersion": g["participantPromptVersion"], "rules": g["rules"]}
    write_json(ROOT / "docs/data/games" / (g["id"] + ".json"), replay)
    write_json(ROOT / "docs/data/surveys" / (g["id"] + ".json"), surveys)
    return summary


def main():
    source = Path(sys.argv[1])
    games = []
    archives = []
    for kind, expected in HASHES.items():
        archive = source / f"social-sim-dataset-0.0.1-raw-{kind}.tar.zst"
        actual = hashlib.sha256(archive.read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError(f"Release checksum mismatch: {archive.name}")
        archives.append({"name": archive.name, "sha256": actual})
        with archive.open("rb") as f, zstandard.ZstdDecompressor().stream_reader(f) as stream:
            with tarfile.open(fileobj=stream, mode="r|") as tar:
                for member in tar:
                    if member.isfile() and re.fullmatch(
                        rf"social-sim-dataset-0\.0\.1/raw/{kind}/[0-9a-f-]+\.json", member.name
                    ):
                        games.append(export_game(json.load(tar.extractfile(member))))
    games.sort(key=lambda g: (g["game"] != "mafia", g["index"]))
    assert len({g["id"] for g in games}) == 200
    assert all(sum(g["game"] == kind for g in games) == 100 for kind in HASHES)
    manifest = {"release": "0.0.1", "sourceRepository": "unreleasedproducts/MafiaSim",
                "archives": archives, "games": games}
    write_json(ROOT / "docs/data/manifest.json", manifest)
    print(json.dumps({"games": len(games), "events": sum(g["events"] for g in games),
                      "surveys": sum(g["surveys"] for g in games),
                      "polls": sum(g["polls"] for g in games), "yields": sum(g["yields"] for g in games),
                      "bytes": sum(p.stat().st_size for p in (ROOT / "docs/data").rglob("*.json"))}))


if __name__ == "__main__":
    main()
