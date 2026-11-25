output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "frontend_url" {
  value = "https://${azurerm_static_web_app.frontend.default_host_name}"
}

output "api_url" {
  value = "https://${azurerm_container_app.api.ingress[0].fqdn}"
}

output "key_vault_uri" {
  value = azurerm_key_vault.main.vault_uri
}

output "static_web_app_deployment_token" {
  value     = azurerm_static_web_app.frontend.api_key
  sensitive = true
}
