# Deploy The Agentic Office on AWS ECS

One Fargate task serves **both** the Phaser game (`dist/`) and the Node harness (`/ws`, `/health`, `/session`). That matches how the browser talks to the office: WebSocket on the same host as the page.

```
Internet → ALB (idle 4000s, WebSocket)
              → ECS Fargate × 1  (awsvpc, public IP)
                    Node HOST=0.0.0.0:8787
                    static /          game
                    /ws               office events
                    Secrets Manager   API keys
```

S3 is not used. The harness is a long-lived process with in-memory session state.

## What Terraform creates

| Resource | Purpose |
| --- | --- |
| VPC + 2 public subnets + IGW | Isolation without a NAT bill |
| ECR | Image registry |
| ALB + target group | HTTP (optional HTTPS), `/health` checks, sticky cookies |
| ECS cluster + Fargate service | **desired_count = 1** |
| Secrets Manager | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `CURSOR_API_KEY` |
| CloudWatch Logs | `/ecs/the-agentic-office` (14 days) |
| IAM | Task execution (ECR + logs + secrets). Task role is empty on purpose |

The task gets a **public IP** so it can pull from ECR and call OpenAI/Anthropic/Cursor. Inbound is still only from the ALB security group.

## Prerequisites

- Terraform >= 1.6
- AWS CLI credentials that can create VPC, ECS, IAM, ALB, ECR, Secrets Manager
- Docker (image is `linux/amd64`)
- `npm ci` works locally (the image runs `npm run build` inside Docker)

## Deploy

From the **repo root**:

```bash
cp devops/terraform/terraform.tfvars.example devops/terraform/terraform.tfvars
# edit region and optional API keys in terraform.tfvars
chmod +x devops/scripts/deploy.sh devops/scripts/destroy.sh
./devops/scripts/deploy.sh
```

The script:

1. `terraform apply -target=aws_ecr_repository.office` (chicken-and-egg: ECS needs an image)
2. `docker build` + push tagged with the git sha
3. Full `terraform apply` with that tag

When it finishes, open the printed `office_url`. `/health` should return `{"ok":true,"service":"agentic-office-harness","game":true}`.

Manual equivalent:

```bash
cd devops/terraform
terraform init
terraform apply -target=aws_ecr_repository.office
# then docker login / build / push, then:
terraform apply -var="image_tag=<tag>"
```

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `aws_region` | `us-east-1` | |
| `image_tag` | `latest` | Deploy script overrides with git sha |
| `cpu` / `memory` | `512` / `1024` | Fargate pair |
| `desired_count` | `1` | Do not scale out; one in-memory office |
| `acm_certificate_arn` | `""` | Set to enable HTTPS on 443 and redirect 80 |
| `openai_api_key` etc. | `""` | Empty = mock mode still works |

Keys can also be passed as `TF_VAR_openai_api_key`. `terraform.tfvars` is gitignored.

## HTTPS

Create an ACM certificate in the **same region** as the ALB, then:

```hcl
acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/…"
```

Point a Route 53 alias at `alb_dns_name` if you want a custom domain. Until then the office is `http://<alb_dns_name>/`.

## Cost (ballpark, us-east-1)

- Fargate 0.5 vCPU / 1 GB ≈ a few dollars per day if left running
- ALB ≈ $16/month + LCU
- NAT is **not** created (public IP on the task instead)

Destroy when idle:

```bash
./devops/scripts/destroy.sh
```

`force_delete` is on the ECR repo so destroy can remove images.

## App changes this deploy relies on

- `HOST=0.0.0.0` (local default remains `127.0.0.1`)
- Harness serves `dist/` when `index.html` exists (`npm start` after `npm run build`)
- Container `HEALTHCHECK` and ECS health check hit `GET /health`

Local production-shaped run (without AWS):

```bash
npm run build
HOST=0.0.0.0 PORT=8787 npm start
# open http://127.0.0.1:8787/
```

## Limits

- **One task.** Two tasks = two offices; WebSockets would split.
- **Cursor provider** in Fargate is best-effort (SDK sandbox, no desktop Cursor). OpenAI, Anthropic, and mock are the reliable cloud options.
- No autoscaling, no CodePipeline. Re-run `./devops/scripts/deploy.sh` to release.
