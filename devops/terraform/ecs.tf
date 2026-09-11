resource "aws_ecs_cluster" "office" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "office" {
  cluster_name       = aws_ecs_cluster.office.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_ecs_task_definition" "office" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  depends_on = [aws_secretsmanager_secret_version.keys]

  container_definitions = jsonencode([
    {
      name      = local.container
      image     = "${aws_ecr_repository.office.repository_url}:${var.image_tag}"
      essential = true
      portMappings = [
        {
          containerPort = local.port
          hostPort      = local.port
          protocol      = "tcp"
        }
      ]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "HOST", value = "0.0.0.0" },
        { name = "PORT", value = tostring(local.port) },
        { name = "PROVIDER", value = var.office_provider },
        { name = "MODEL", value = var.office_model },
        { name = "FLOOR", value = var.office_floor },
      ]
      secrets = [
        {
          name      = "OPENAI_API_KEY"
          valueFrom = "${local.secret_arn}:OPENAI_API_KEY::"
        },
        {
          name      = "ANTHROPIC_API_KEY"
          valueFrom = "${local.secret_arn}:ANTHROPIC_API_KEY::"
        },
        {
          name      = "CURSOR_API_KEY"
          valueFrom = "${local.secret_arn}:CURSOR_API_KEY::"
        },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.office.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "office"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:${local.port}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 90
      }
    }
  ])
}

resource "aws_ecs_service" "office" {
  name                              = local.name
  cluster                           = aws_ecs_cluster.office.id
  task_definition                   = aws_ecs_task_definition.office.arn
  desired_count                     = var.desired_count
  launch_type                       = "FARGATE"
  platform_version                  = "LATEST"
  health_check_grace_period_seconds = 90
  force_new_deployment              = var.force_new_deployment
  wait_for_steady_state             = true

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.office.arn
    container_name   = local.container
    container_port   = local.port
  }

  depends_on = [
    aws_lb_listener.http,
    aws_iam_role_policy.execution_secrets,
  ]
}
