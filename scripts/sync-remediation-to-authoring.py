"""
Merges an applied remediation delta back into its source content/authoring/<set>/<file>.json,
so the authoring file stays an accurate record of what's actually approved (the delta file records
what changed and why; the authoring file should always reflect current state, same as production).

Usage: python scripts/sync-remediation-to-authoring.py <authoring_file> <delta_file>
"""
import json
import sys

authoring_path, delta_path = sys.argv[1], sys.argv[2]

doc = json.load(open(authoring_path, encoding='utf-8'))
delta = json.load(open(delta_path, encoding='utf-8'))

concepts_by_code = {c['code']: c for c in doc['concepts']}
applied = 0
errors = []

for swap in delta['swaps']:
    concept = concepts_by_code.get(swap['concept_code'])
    if not concept:
        errors.append(f"concept {swap['concept_code']} not found in authoring file")
        continue
    idx = None
    for i, q in enumerate(concept['questions']):
        if q['q'] == swap['retire_text']:
            idx = i
            break
    if idx is None:
        errors.append(f"{swap['concept_code']}: retire_text not found -- \"{swap['retire_text'][:60]}...\"")
        continue
    old = concept['questions'][idx]
    add = swap['add']
    if old['b'] != add['b'] or old['d'] != add['d']:
        errors.append(f"{swap['concept_code']}: cell mismatch, old={old['b']}|{old['d']} new={add['b']}|{add['d']}")
        continue
    # Replace in place, same schema as an authored question object.
    new_q = {k: v for k, v in add.items() if k in ('b', 'd', 't', 'm', 'q', 'a', 'o', 's', 'rev')}
    concept['questions'][idx] = new_q
    applied += 1

if errors:
    print('\n'.join(errors))
    sys.exit(1)

json.dump(doc, open(authoring_path, 'w', encoding='utf-8', newline='\n'), indent=2, ensure_ascii=False)
print(f'{authoring_path}: {applied} questions replaced in place, file rewritten')
