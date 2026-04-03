#!/usr/bin/env bash
set -euo pipefail
echo "=== Nerf CI Validation ==="
scripts/ci/lint.sh
scripts/ci/test.sh
echo "=== Validation complete ==="
