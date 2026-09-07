resource "aws_secretsmanager_secret" "keys" {
  name                    = "${local.name}/api-keys"
  description             = "LLM provider keys for The Agentic Office harness"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "keys" {
  secret_id = aws_secretsmanager_secret.keys.id
  secret_string = jsonencode({
    OPENAI_API_KEY    = var.openai_api_key
    ANTHROPIC_API_KEY = var.anthropic_api_key
    CURSOR_API_KEY    = var.cursor_api_key
  })
}

resource "aws_cloudwatch_log_group" "office" {
  name              = "/ecs/${local.name}"
  retention_in_days = var.log_retention_days
}
