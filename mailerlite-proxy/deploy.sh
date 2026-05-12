#!/usr/bin/env bash
# ─── Deploy mailerlite-proxy to Cloud Run ──────────────────
# Usage: bash deploy.sh
# Prerequisites: gcloud CLI authenticated, Docker installed

set -euo pipefail

PROJECT="gen-lang-client-0237860564"
REGION="us-east1"
SERVICE_NAME="mailerlite-proxy"

echo "============================================================"
echo " Building & Deploying MailerLite Proxy to Cloud Run"
echo " Project: $PROJECT  |  Region: $REGION  |  Service: $SERVICE_NAME"
echo "============================================================"

# ── Check for API key ──────────────────────────────────────
if [ -z "${MAILERLITE_API_KEY:-}" ]; then
    echo ""
    echo "❌ ERROR: MAILERLITE_API_KEY environment variable is not set."
    echo ""
    echo "   You must generate a NEW MailerLite API key first:"
    echo "   1. Go to https://dashboard.mailerlite.com/integrations/api"
    echo "   2. Click 'Generate new token'"
    echo "   3. Copy the token"
    echo ""
    echo "   Then run:"
    echo "     export MAILERLITE_API_KEY='your-new-token'"
    echo "     bash deploy.sh"
    echo ""
    exit 1
fi

# ── Build & push container ─────────────────────────────────
echo ""
echo "▶ Building container..."
gcloud builds submit \
    --project "$PROJECT" \
    --region "$REGION" \
    --tag "${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/${SERVICE_NAME}" \
    .

# ── Deploy to Cloud Run ────────────────────────────────────
echo ""
echo "▶ Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
    --project "$PROJECT" \
    --region "$REGION" \
    --image "${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy/${SERVICE_NAME}" \
    --platform managed \
    --allow-unauthenticated \
    --set-env-vars "MAILERLITE_API_KEY=${MAILERLITE_API_KEY}" \
    --memory 256Mi \
    --cpu 1 \
    --min-instances 0 \
    --max-instances 3 \
    --timeout 30

# ── Show service URL ───────────────────────────────────────
echo ""
echo "▶ Getting service URL..."
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
    --project "$PROJECT" \
    --region "$REGION" \
    --format "value(status.url)")

echo ""
echo "============================================================"
echo " ✅ Deployment complete!"
echo "============================================================"
echo ""
echo "   Service URL: $SERVICE_URL"
echo "   Test with:"
echo "     curl -X POST ${SERVICE_URL}/api/subscribe \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"email\":\"test@example.com\",\"name\":\"Test\",\"group\":\"playbook\",\"redirect\":\"ty-01.html\"}'"
echo ""
echo "   Health check:"
echo "     curl ${SERVICE_URL}/health"
echo ""
echo "   ⚠  IMPORTANT: Do NOT commit the API key anywhere."
echo "      It is stored securely as a Cloud Run env variable."
echo ""
