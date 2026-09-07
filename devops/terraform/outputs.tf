output "aws_region" {
  value = var.aws_region
}

output "alb_dns_name" {
  description = "Open this in a browser (http:// unless you set acm_certificate_arn)."
  value       = aws_lb.office.dns_name
}

output "office_url" {
  value = var.acm_certificate_arn == "" ? "http://${aws_lb.office.dns_name}" : "https://${aws_lb.office.dns_name}"
}

output "ecr_repository_url" {
  description = "docker tag / push target."
  value       = aws_ecr_repository.office.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.office.name
}

output "ecs_service_name" {
  value = aws_ecs_service.office.name
}

output "secrets_arn" {
  value = aws_secretsmanager_secret.keys.arn
}

output "health_url" {
  value = "${var.acm_certificate_arn == "" ? "http" : "https"}://${aws_lb.office.dns_name}/health"
}
