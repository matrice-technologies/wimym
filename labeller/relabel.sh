#!/bin/sh
# A full relabel at the versions in definitions.json, built beside the live labels and moved in
# only when complete, so the app never shows a half-labelled version:
#   1. categories, every message (signals needs it: it skips what the first set finds you didn't type)
#   2. signals, every message you typed
#   3. promote: both files into the labels folder (~/.wimym/labels), the old categories kept as categories.v<old>.json
# Calls, tokens, cost and wall time are in each file's "calls" and "runs"; progress in run.log.
set -e
cd "$(dirname "$0")/.."
# the labels folder as the engine sees it (WIMYM_LABELS, and ~/.mirror moved to ~/.wimym first)
LABELS="$(python3 -c 'import sys; sys.path.insert(0, "engine"); from wimym.paths import LABELS_DIR; print(LABELS_DIR)')"
NEXT="${1:-$LABELS/next}"
LOG="$NEXT/run.log"
mkdir -p "$NEXT"
for f in categories signals; do
  [ -f "$NEXT/$f.json" ] || cp "$LABELS/$f.json" "$NEXT/$f.json" 2>/dev/null || true
done
echo "== relabel started $(date)" >> "$LOG"
# twice each: the second pass retries what failed three times and takes messages sent meanwhile
python3 labeller/label.py --all --dir "$NEXT" >> "$LOG" 2>&1
python3 labeller/label.py --all --dir "$NEXT" >> "$LOG" 2>&1
python3 labeller/label.py --all --set signals --dir "$NEXT" >> "$LOG" 2>&1
python3 labeller/label.py --all --set signals --dir "$NEXT" >> "$LOG" 2>&1
python3 labeller/label.py --promote --dir "$NEXT" >> "$LOG" 2>&1
echo "== relabel finished $(date)" >> "$LOG"
