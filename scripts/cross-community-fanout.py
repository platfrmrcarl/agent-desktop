#!/usr/bin/env python3
"""
Audit D: cross-community fan-out from graphify-out/graph.json.

For each node, count how many distinct communities its neighbors belong to.
Nodes with high fan-out are "boundary spanners" — used by many parts of the
codebase. They are candidates for:

  - Promotion to a shared utility module
  - Refactor away from being a god node
  - Identification as cross-cutting concerns (logging, validation, db access)

Outputs the top N nodes by:
  1. distinct_communities  (the fan-out)
  2. degree  (raw connection count)
  3. own_community_dominance  (ratio of intra/inter — low = lots of crossing)
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

GRAPH = Path('graphify-out/graph.json')
TOP_N = 30

if not GRAPH.exists():
    print('ERROR: graphify-out/graph.json missing — run /graphify first', file=sys.stderr)
    sys.exit(1)

data = json.loads(GRAPH.read_text())
nodes = data['nodes']
links = data.get('links', data.get('edges', []))

# Map node id -> data
node_by_id = {n['id']: n for n in nodes}

# Map node id -> community (from graphify's own clustering, stored as 'community' attr or in separate dict)
node_to_comm = {}
for n in nodes:
    cid = n.get('community')
    if cid is not None:
        node_to_comm[n['id']] = cid

# If communities not on nodes, fall back to running our own
if not node_to_comm:
    print('WARN: no community info on nodes — falling back to greedy clustering', file=sys.stderr)
    try:
        import networkx as nx
        from networkx.readwrite import json_graph
        G_nx = json_graph.node_link_graph(data, edges='links')
        comms = nx.community.louvain_communities(G_nx, seed=42)
        for cid, members in enumerate(comms):
            for m in members:
                node_to_comm[m] = cid
    except Exception as e:
        print(f'ERROR: cannot cluster: {e}', file=sys.stderr)
        sys.exit(1)

# Build adjacency
adj = defaultdict(set)
for link in links:
    src = link.get('source')
    tgt = link.get('target')
    if isinstance(src, dict): src = src.get('id')
    if isinstance(tgt, dict): tgt = tgt.get('id')
    if src is None or tgt is None:
        continue
    adj[src].add(tgt)
    adj[tgt].add(src)

# Compute fan-out per node
results = []
for nid, ndata in node_by_id.items():
    own_comm = node_to_comm.get(nid)
    if own_comm is None:
        continue
    neighbor_comms = set()
    intra = 0
    inter = 0
    for nb in adj.get(nid, ()):
        nb_comm = node_to_comm.get(nb)
        if nb_comm is None:
            continue
        neighbor_comms.add(nb_comm)
        if nb_comm == own_comm:
            intra += 1
        else:
            inter += 1
    fanout = len(neighbor_comms - {own_comm})
    degree = intra + inter
    intra_ratio = intra / degree if degree > 0 else 0
    results.append({
        'id': nid,
        'label': ndata.get('label', nid),
        'source_file': ndata.get('source_file', ''),
        'degree': degree,
        'fanout': fanout,
        'intra': intra,
        'inter': inter,
        'intra_ratio': intra_ratio,
        'own_community': own_comm,
    })

# Filter out generic noise (very common method names extracted by AST as nodes)
NOISE_LABELS = {
    '.get()', '.set()', '.run()', '.all()', '.has()', '.add()', '.delete()',
    '.push()', '.pop()', '.shift()', '.unshift()', '.parse()', '.stringify()',
    '.toString()', '.valueOf()', '.then()', '.catch()', '.finally()',
    '.forEach()', '.map()', '.filter()', '.reduce()', '.find()', '.includes()',
    '.handle()', '.invoke()', '.send()', '.emit()', '.on()', '.off()', '.once()',
    '.prepare()', '.exec()', '.bind()', '.call()', '.apply()',
    'log()', 'warn()', 'error()', 'info()', 'debug()',
}

BUILD_PATH_FRAGMENTS = (
    'dist-headless/', 'dist-electron/', 'dist/', 'release/', 'out/',
    'node_modules/', '/release/', '/build/', '.min.', '.bundle.',
)

def is_noise(r):
    lbl = r['label']
    src = r.get('source_file', '')
    # Reject bundled/minified artifact paths
    if any(frag in src for frag in BUILD_PATH_FRAGMENTS):
        return True
    # Reject absolute paths under our project root that point to build artifacts
    if src.startswith('/') and 'ClawdDesktopLinux' in src:
        return True
    # Reject hashed/bundled filenames that look like webpack output
    if '-' in lbl and lbl.endswith('.js') and any(c.isupper() for c in lbl):
        return True
    if lbl in NOISE_LABELS:
        return True
    # Method calls without explicit source — generic JS builtins
    if (lbl.startswith('.') and lbl.endswith('()')) or lbl.endswith('.js'):
        return True
    # Filter "external_*" aggregated nodes from semantic extraction
    if r['id'].startswith('external_'):
        return True
    if r['source_file'] == '':
        return True
    return False

filtered = [r for r in results if not is_noise(r)]

# Sort by fanout (desc), then degree (desc), then low intra_ratio (more spread)
filtered.sort(key=lambda r: (-r['fanout'], -r['degree'], r['intra_ratio']))

# Stats
print('# Audit D — Cross-community fan-out')
print()
print(f'Graph: {len(nodes)} nodes, {len(links)} edges, {len(set(node_to_comm.values()))} communities')
print(f'Filtered out {len(results) - len(filtered)} noise nodes (generic method names, external_*, no source_file).')
print()
print('## Top boundary spanners — nodes used across many communities')
print()
print(f'{"FANOUT":>6}  {"DEG":>4}  {"intra%":>6}  LABEL')
print('-' * 80)
for r in filtered[:TOP_N]:
    pct = int(r['intra_ratio'] * 100)
    label = r['label'][:50]
    src = r['source_file'][:50] if r['source_file'] else ''
    print(f'{r["fanout"]:>6}  {r["degree"]:>4}  {pct:>5}%  {label}')
    if src:
        print(f'  {" "*22}{src}')

# Also: most-duplicated-call patterns. These are nodes that get called from many
# OTHER files (not just communities). Useful for spotting "everyone calls this but it lives in a weird place".
print()
print('## Top utility candidates — many distinct files reach these nodes')
print()
file_reach = []
for r in filtered:
    nb_files = set()
    for nb in adj.get(r['id'], ()):
        f = node_by_id.get(nb, {}).get('source_file', '')
        if f:
            nb_files.add(f)
    file_reach.append({
        **r,
        'reaching_files': len(nb_files),
        'sample_files': list(nb_files)[:5],
    })
file_reach.sort(key=lambda r: (-r['reaching_files'], -r['fanout']))
print(f'{"FILES":>5}  {"FANOUT":>6}  LABEL')
print('-' * 80)
for r in file_reach[:25]:
    label = r['label'][:50]
    src = r['source_file'][:60] if r['source_file'] else ''
    print(f'{r["reaching_files"]:>5}  {r["fanout"]:>6}  {label}')
    if src:
        print(f'  {" "*15}{src}')
