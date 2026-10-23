#!/bin/sh
# Wimym in the status line: today's active time and days in a row (hooks/limits.py --status).
exec python3 "$(dirname "$0")/limits.py" --status
