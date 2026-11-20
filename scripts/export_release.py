"""Export only replay fields from the verified 0.0.1 release archives.

Usage: python scripts/export_release.py PATH_TO_RELEASE_ASSETS
Requires: pip install zstandard
"""
import hashlib
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
)


def pick(obj, fields):
    return {k: obj[k] for k in fields if k in obj}


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def export_game(g):
    kind = g["game"]
    assert kind in HASHES and g["status"] == "completed"
    assert re.fullmatch(r"[0-9a-f-]{36}", g["id"])
    players = [{**pick(p, ("id", "name", "role")),
                "model": p["connection"]["model"]} for p in g["players"]]
    events = [pick(e, EVENT_FIELDS) for e in g["events"]]
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
        "models": sorted({p["model"] for p in players}),
    }
    replay = {**summary, "players": players, "events": events,
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
                      "bytes": sum(p.stat().st_size for p in (ROOT / "docs/data").rglob("*.json"))}))


if __name__ == "__main__":
    main()
