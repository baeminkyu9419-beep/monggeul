#!/usr/bin/env bash
# self-strengthen.sh — Universal self-improvement loop
set -uo pipefail
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RULES_FILE="$PROJECT_ROOT/data/learned-rules.json"
[ ! -f "$RULES_FILE" ] && exit 0

python3 << 'PYEOF'
import json, sys, os
from datetime import datetime

rf = os.path.join(os.environ.get("PROJECT_ROOT", "."), "data", "learned-rules.json")
try:
    with open(rf) as f: data = json.load(f)
except: sys.exit(0)

violations = data.get("violations", [])
rules = data.get("rules", [])
if len(violations) < 3:
    print(f"Only {len(violations)} violations. Need 3+ for analysis.")
    sys.exit(0)

total = sum(v.get("detected", 0) for v in violations)
unfixed = sum(v.get("unfixed", 0) for v in violations)
recs = []

if unfixed > total * 0.5:
    recs.append({"id": f"S-{len(rules)+1}", "type": "stricter-lint", "reason": f">{unfixed} unfixed", "action": "Tighten lint rules", "auto_generated": datetime.now().isoformat()})
if total > 10:
    recs.append({"id": f"S-{len(rules)+2}", "type": "pre-commit-enforce", "reason": f"{total} total violations", "action": "Ensure pre-commit installed", "auto_generated": datetime.now().isoformat()})

if recs:
    data["rules"].extend(recs)
    data["last_strengthened"] = datetime.now().isoformat()
    with open(rf, "w") as f: json.dump(data, f, indent=2, ensure_ascii=False)
    for r in recs: print(f"  [{r['id']}] {r['type']}: {r['reason']}")
else:
    print("System stable. No new rules.")
PYEOF
