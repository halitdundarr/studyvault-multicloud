output "project_id" {
  value = var.project_id
}

output "notes_bucket_name" {
  value = google_storage_bucket.notes.name
}

output "function_name" {
  value = google_cloudfunctions2_function.process_note.name
}

output "webhook_secret" {
  value     = random_password.webhook_secret.result
  sensitive = true
}

output "azure_backend_sa_key_json" {
  value     = base64decode(google_service_account_key.azure_backend_key.private_key)
  sensitive = true
}

output "github_wif_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "github_deployer_sa_email" {
  value = google_service_account.github_actions.email
}
