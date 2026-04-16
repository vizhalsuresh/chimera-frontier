#!/usr/bin/env bash
set -euo pipefail

# Root convenience launcher so users can run:
#   MIRAIE_API_TOKEN='...' ./launch.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${ROOT_DIR}/miraie/launch.sh"
