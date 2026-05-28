#!/bin/bash
set -e

echo "Fetching camoufox browser..."
python -m camoufox fetch 2>/dev/null || camoufox fetch 2>/dev/null || echo "Camoufox fetch skipped"

echo "Starting server on port ${PORT:-8000}..."
python3 server.py --host 0.0.0.0 --port ${PORT:-8000}
