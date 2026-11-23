"""Export the published paper metrics from the verified 0.0.1 release archive."""
import hashlib
import json
from pathlib import Path
import re
import sys
import tarfile
import zstandard

ARCHIVE = 'social-sim-dataset-0.0.1-derived-code-run.tar.zst'
SHA256 = 'dbeedcb1ca1038609b2cb30747feef178aac89ca799138ba80500197919a1690'
root = Path(__file__).resolve().parents[1]
archive = Path(sys.argv[1]) / ARCHIVE
assert hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest() == SHA256, 'Release checksum mismatch'
files = {}
with archive.open('rb') as stream, zstandard.ZstdDecompressor().stream_reader(stream) as reader, tarfile.open(fileobj=reader, mode='r|') as tar:
    for member in tar:
        if '/paper-metrics/' in member.name and Path(member.name).name in ['results.json', 'render-report.mjs']:
            files[Path(member.name).name] = tar.extractfile(member).read()
results = json.loads(files['results.json'])
manifest = json.loads((root / 'docs/data/manifest.json').read_text())
catalog = {'mafia': [], 'avalon': []}
for match in re.finditer(r"row\('(mafia|avalon)', '([^']+)', '([^']+)'(?:, '(pct|num|pp)')?", files['render-report.mjs'].decode()):
    game, key, label, unit = match.groups()
    if key == 'perceivedRoleError':
        continue  # superseded all-observer version, retained in the JSON only
    if label.startswith('…'):
        label = ('Role ID top-1: ' if key.startswith('roleIdTop1:') else 'Accusation honesty: ' if key.startswith('goodAccusationHonesty:') else 'Faction recall: ') + label[1:]
    if key.startswith(('win',)):
        group = 'Outcomes'
    elif any(s in key.lower() for s in ['brier', 'roleid', 'auc', 'faction', 'recall', 'belief', 'perceived']):
        group = 'Beliefs & deduction'
    else:
        group = 'Votes & social behavior'
    catalog[game].append(dict(key=key, label=label, unit='points' if key == 'winAboveRole' else 'auc' if key.endswith('Auc') else unit or 'pct', group=group))
    assert key in results[game]['metrics'], key
for game in catalog:
    catalog[game].append(dict(key='elo', label='Solo Elo (recentered to 1500)', unit='elo', group='Outcomes'))
    assert {g['id'] for g in results[game]['games']} == {g['id'] for g in manifest['games'] if g['game'] == game}
output = {
    'release': '0.0.1', 'generated': results['generated'], 'bootstrap': results['bootstrap'],
    'models': results['models'], 'catalog': catalog,
    'source': {'archive': ARCHIVE, 'sha256': SHA256, 'resultsSha256': hashlib.sha256(files['results.json']).hexdigest(),
               'path': 'code/experiment/serving/run-2026-11-18-mi355x/paper-metrics/results.json'},
}
for game in catalog:
    output[game] = {key: results[game][key] for key in ['metrics', 'elo']}
    # Display replay counts from the manifest, not metric-run call counters.
    rows = [g for g in manifest['games'] if g['game'] == game]
    output[game]['overview'] = {key: sum(g[key] for g in rows) for key in ['surveys', 'calls', 'polls', 'yields']}
    output[game]['overview']['games'] = len(rows)
    output[game]['overview']['wins'] = {winner: sum(g['winner'] == winner for g in rows) for winner in sorted({g['winner'] for g in rows})}
    if game == 'mafia':
        output[game]['roleIdByDay'] = results[game]['roleIdByDay']
target = root / 'docs/data/metrics.json'
target.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
print(f'Exported {sum(map(len, catalog.values()))} metrics; {target.stat().st_size:,} bytes. Release game IDs match the replay archive.')
