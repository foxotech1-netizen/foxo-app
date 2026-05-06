#!/usr/bin/env bash
# Force un nouveau déploiement Vercel depuis le HEAD courant de main,
# en passant par l'API REST. Utile quand le webhook GitHub → Vercel
# est cassé.
#
# Requiert un token Vercel avec scope "full" :
#   https://vercel.com/account/tokens → Create Token → Scope: Full Account
#
# Usage :
#   export VERCEL_TOKEN="vercel_xxx..."
#   bash deploy-force.sh
set -euo pipefail

if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "❌ VERCEL_TOKEN non défini." >&2
  echo "   1) https://vercel.com/account/tokens → Create Token (scope: Full Account)" >&2
  echo "   2) export VERCEL_TOKEN=\"vercel_xxx...\"" >&2
  echo "   3) bash deploy-force.sh" >&2
  exit 1
fi

REPO="foxotech1-netizen/foxo-app"
PROJECT="foxo-app"
REF="main"

echo "→ POST /v13/deployments  ($REPO@$REF)"

response=$(curl -sS -w "\n__HTTP_CODE__%{http_code}" \
  -X POST "https://api.vercel.com/v13/deployments" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"$PROJECT\",
    \"gitSource\": {
      \"type\": \"github\",
      \"repo\": \"$REPO\",
      \"ref\": \"$REF\"
    }
  }")

http_code=$(echo "$response" | sed -n 's/.*__HTTP_CODE__//p')
body=$(echo "$response" | sed 's/__HTTP_CODE__.*$//')

echo "HTTP $http_code"
echo "$body"

if [ "$http_code" -ge 400 ]; then
  echo ""
  echo "⚠ Si l'erreur mentionne 'gitSource' ou 'not authorized', l'intégration"
  echo "  Git Vercel ↔ GitHub est cassée au niveau projet (pas seulement"
  echo "  webhook). À régler dans Vercel → Settings → Git → Disconnect &"
  echo "  Reconnect. Ou utiliser le CLI :  npx vercel --token \$VERCEL_TOKEN --prod"
  exit 1
fi

echo ""
echo "✓ Déploiement déclenché. Suivi : https://vercel.com/foxotech/foxo-app/deployments"
