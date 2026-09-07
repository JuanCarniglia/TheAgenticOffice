terraform {
  required_version = ">= 1.6.0"

  # Uncomment to store state in S3 instead of local terraform.tfstate:
  # backend "s3" {
  #   bucket = "your-tf-state-bucket"
  #   key    = "the-agentic-office/terraform.tfstate"
  #   region = "us-east-1"
  # }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

locals {
  name       = var.project_name
  container  = "office"
  port       = 8787
  azs        = slice(data.aws_availability_zones.available.names, 0, 2)
  secret_arn = aws_secretsmanager_secret.keys.arn
}
