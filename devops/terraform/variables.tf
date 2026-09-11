variable "aws_region" {
  type        = string
  description = "AWS region for all resources."
  default     = "us-east-1"
}

variable "project_name" {
  type        = string
  description = "Name prefix for ECS, ALB, ECR, and logs."
  default     = "the-agentic-office"
}

variable "image_tag" {
  type        = string
  description = "ECR image tag the service should run. Deploy script sets this to a git sha."
  default     = "latest"
}

variable "cpu" {
  type        = number
  description = "Fargate CPU units (256, 512, 1024, …)."
  default     = 512
}

variable "memory" {
  type        = number
  description = "Fargate memory in MiB. Must be valid for the chosen CPU."
  default     = 1024
}

variable "desired_count" {
  type        = number
  description = "ECS tasks. Keep at 1: office session state is in-process."
  default     = 1
}

variable "assign_public_ip" {
  type        = bool
  description = "Give the task a public IP so it can pull ECR and call LLM APIs without a NAT gateway."
  default     = true
}

variable "acm_certificate_arn" {
  type        = string
  description = "Optional ACM cert in this region. When set, ALB listens on 443 and redirects 80 → HTTPS."
  default     = ""
}

variable "openai_api_key" {
  type        = string
  description = "Optional. Stored in Secrets Manager; empty string is valid (mock mode)."
  default     = ""
  sensitive   = true
}

variable "anthropic_api_key" {
  type        = string
  description = "Optional. Stored in Secrets Manager."
  default     = ""
  sensitive   = true
}

variable "cursor_api_key" {
  type        = string
  description = "Optional. Stored in Secrets Manager."
  default     = ""
  sensitive   = true
}

variable "office_provider" {
  type        = string
  description = "Lock Settings → Provider: mock, openai, anthropic, or cursor. Empty = player chooses."
  default     = ""
}

variable "office_model" {
  type        = string
  description = "Lock Settings → Model id. Empty = player chooses."
  default     = ""
}

variable "office_floor" {
  type        = string
  description = "Lock Settings → Floor intelligence: scripted or live. Empty = player chooses."
  default     = ""
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log retention."
  default     = 14
}

variable "force_new_deployment" {
  type        = bool
  description = "Force ECS to pull a new image even if the tag is unchanged (e.g. latest)."
  default     = false
}
