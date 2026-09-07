#!/usr/bin/env bash
# Build the office image, push to ECR, apply Terraform.
# Usage (from repo root):
#   ./devops/scripts/deploy.sh
#   ./devops/scripts/deploy.sh -var='aws_region=us-west-2'
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TF="$ROOT/devops/terraform"
TAG="${IMAGE_TAG:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"

if ! command -v terraform >/dev/null || ! command -v aws >/dev/null || ! command -v docker >/dev/null; then
  echo "Need terraform, aws, and docker on PATH." >&2
  exit 1
fi

cd "$TF"
terraform init -input=false
terraform apply -input=false -auto-approve \
  -target=aws_ecr_repository.office \
  "$@"

REGION="$(terraform output -raw aws_region)"
REPO="$(terraform output -raw ecr_repository_url)"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${REPO%%/*}"

docker build \
  --platform linux/amd64 \
  -f "$ROOT/devops/docker/Dockerfile" \
  -t "$REPO:$TAG" \
  -t "$REPO:latest" \
  "$ROOT"

docker push "$REPO:$TAG"
docker push "$REPO:latest"

terraform apply -input=false -auto-approve \
  -var="image_tag=$TAG" \
  -var="force_new_deployment=true" \
  "$@"

echo
echo "Office URL:  $(terraform output -raw office_url)"
echo "Health:      $(terraform output -raw health_url)"
echo "Image:       $REPO:$TAG"
