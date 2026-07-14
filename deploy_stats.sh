#!/usr/bin/env bash
# deploy_stats.sh — estampa stats.json en las landings y las despliega.
# Uso: bash deploy_stats.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

echo "▸ 1/3  Estampando stats.json en las landings…"
python3 "$HERE/build_stats.py"

echo "▸ 2/3  Deploy radiografia.wearedomma.com…"
cd "$ROOT/radiografia-web"
npx wrangler pages deploy site --project-name=domma-radiografia --branch=main --commit-dirty=true

echo "▸ 3/3  Landing AEEM (repo CrisDOMMA/domma-pro-landing)"
echo "   Revisa cómo se despliega esa landing (Pages Git-connected o wrangler)."
echo "   Si es Git-connected:  git -C '$ROOT/DOMMA-PRO-LANDING' add -A && git commit -m 'stats 100k' && git push"

echo "✅ Hecho. stats.json (data.wearedomma.com/stats.json) se publica al desplegar el dashboard."
