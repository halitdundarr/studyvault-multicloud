terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.14"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  backend "gcs" {
    bucket = "studyvault-tfstate-700696007423"
    prefix = "gcp"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
