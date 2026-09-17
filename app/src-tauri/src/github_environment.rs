use std::{
    env,
    sync::{OnceLock, RwLock},
};

use serde::{Deserialize, Serialize};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::storage::{read_active_environment_id, store_active_environment_id};

const ENVIRONMENTS_CONFIG_KEY: &str = "GITHUB_ENVIRONMENTS";
const DEFAULT_ENVIRONMENT_ID: &str = "github.com";
const DEFAULT_ENVIRONMENT_NAME: &str = "GitHub.com";
const DEFAULT_WEB_BASE_URL: &str = "https://github.com";
const DEFAULT_API_BASE_URL: &str = "https://api.github.com";

#[derive(Debug, Clone, Serialize)]
pub struct GitHubEnvironment {
    pub id: String,
    pub name: String,
    pub web_base_url: String,
    pub api_base_url: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubEnvironmentConfig {
    id: String,
    name: String,
    web_base_url: String,
    #[serde(default)]
    api_base_url: Option<String>,
    client_id: String,
    client_secret: String,
}

#[derive(Debug, Clone)]
pub struct ConfiguredGitHubEnvironment {
    pub environment: GitHubEnvironment,
    pub client_id: String,
    pub client_secret: String,
    pub authorize_url: String,
    pub token_url: String,
}

fn runtime_environment() -> &'static RwLock<GitHubEnvironment> {
    static ACTIVE_ENVIRONMENT: OnceLock<RwLock<GitHubEnvironment>> = OnceLock::new();
    ACTIVE_ENVIRONMENT.get_or_init(|| RwLock::new(default_public_environment()))
}

fn default_public_environment() -> GitHubEnvironment {
    GitHubEnvironment {
        id: DEFAULT_ENVIRONMENT_ID.to_string(),
        name: DEFAULT_ENVIRONMENT_NAME.to_string(),
        web_base_url: DEFAULT_WEB_BASE_URL.to_string(),
        api_base_url: DEFAULT_API_BASE_URL.to_string(),
    }
}

fn normalize_base_url(value: &str, field_name: &'static str) -> AppResult<String> {
    let value = value.trim().trim_end_matches('/');
    let url = Url::parse(value)?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err(AppError::MissingConfig(field_name));
    }
    Ok(value.to_string())
}

fn default_api_base_url(web_base_url: &str) -> AppResult<String> {
    let url = Url::parse(web_base_url)?;
    let host = url
        .host_str()
        .ok_or(AppError::MissingConfig(ENVIRONMENTS_CONFIG_KEY))?;

    if host == "github.com" {
        Ok(DEFAULT_API_BASE_URL.to_string())
    } else if host.ends_with(".ghe.com") {
        Ok(format!("https://api.{host}"))
    } else {
        Ok(format!("{web_base_url}/api/v3"))
    }
}

fn configure_environment(
    config: GitHubEnvironmentConfig,
) -> AppResult<ConfiguredGitHubEnvironment> {
    let id = config.id.trim();
    let name = config.name.trim();
    let client_id = config.client_id.trim();
    let client_secret = config.client_secret.trim();
    if id.is_empty() || name.is_empty() || client_id.is_empty() || client_secret.is_empty() {
        return Err(AppError::MissingConfig(ENVIRONMENTS_CONFIG_KEY));
    }
    if !id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_'))
    {
        return Err(AppError::MissingConfig(ENVIRONMENTS_CONFIG_KEY));
    }

    let web_base_url = normalize_base_url(&config.web_base_url, ENVIRONMENTS_CONFIG_KEY)?;
    let api_base_url = match config.api_base_url {
        Some(value) => normalize_base_url(&value, ENVIRONMENTS_CONFIG_KEY)?,
        None => default_api_base_url(&web_base_url)?,
    };

    Ok(ConfiguredGitHubEnvironment {
        environment: GitHubEnvironment {
            id: id.to_string(),
            name: name.to_string(),
            web_base_url: web_base_url.clone(),
            api_base_url,
        },
        client_id: client_id.to_string(),
        client_secret: client_secret.to_string(),
        authorize_url: format!("{web_base_url}/login/oauth/authorize"),
        token_url: format!("{web_base_url}/login/oauth/access_token"),
    })
}

fn parse_environments(value: &str) -> AppResult<Vec<ConfiguredGitHubEnvironment>> {
    let configs: Vec<GitHubEnvironmentConfig> = serde_json::from_str(value)
        .map_err(|_| AppError::MissingConfig(ENVIRONMENTS_CONFIG_KEY))?;
    if configs.is_empty() {
        return Err(AppError::MissingConfig(ENVIRONMENTS_CONFIG_KEY));
    }

    let environments = configs
        .into_iter()
        .map(configure_environment)
        .collect::<AppResult<Vec<_>>>()?;

    let mut ids = std::collections::HashSet::new();
    if environments
        .iter()
        .any(|environment| !ids.insert(environment.environment.id.clone()))
    {
        return Err(AppError::MissingConfig(ENVIRONMENTS_CONFIG_KEY));
    }

    Ok(environments)
}

pub fn configured_environments() -> AppResult<Vec<ConfiguredGitHubEnvironment>> {
    dotenvy::dotenv().ok();
    match env::var(ENVIRONMENTS_CONFIG_KEY) {
        Ok(value) if !value.trim().is_empty() => parse_environments(&value),
        _ => {
            let client_id = env::var("GITHUB_CLIENT_ID")
                .map_err(|_| AppError::MissingConfig(ENVIRONMENTS_CONFIG_KEY))?;
            let client_secret = env::var("GITHUB_CLIENT_SECRET")
                .map_err(|_| AppError::MissingConfig(ENVIRONMENTS_CONFIG_KEY))?;
            Ok(vec![configure_environment(GitHubEnvironmentConfig {
                id: DEFAULT_ENVIRONMENT_ID.to_string(),
                name: DEFAULT_ENVIRONMENT_NAME.to_string(),
                web_base_url: DEFAULT_WEB_BASE_URL.to_string(),
                api_base_url: Some(DEFAULT_API_BASE_URL.to_string()),
                client_id,
                client_secret,
            })?])
        }
    }
}

pub fn list_environments() -> AppResult<Vec<GitHubEnvironment>> {
    Ok(configured_environments()?
        .into_iter()
        .map(|configured| configured.environment)
        .collect())
}

pub fn select_environment(environment_id: Option<&str>) -> AppResult<ConfiguredGitHubEnvironment> {
    let environments = configured_environments()?;
    let stored_id = read_active_environment_id()?;
    let requested_id = environment_id.or(stored_id.as_deref());
    let selected = match requested_id {
        Some(requested_id) => environments
            .iter()
            .find(|configured| configured.environment.id == requested_id)
            .cloned()
            .or_else(|| environment_id.is_none().then(|| environments[0].clone()))
            .ok_or(AppError::MissingConfig(ENVIRONMENTS_CONFIG_KEY))?,
        None => environments[0].clone(),
    };

    set_runtime_environment(&selected.environment);
    store_active_environment_id(&selected.environment.id)?;
    Ok(selected)
}

pub fn active_environment() -> GitHubEnvironment {
    runtime_environment()
        .read()
        .expect("active GitHub environment lock poisoned")
        .clone()
}

fn set_runtime_environment(environment: &GitHubEnvironment) {
    *runtime_environment()
        .write()
        .expect("active GitHub environment lock poisoned") = environment.clone();
}

#[cfg(test)]
mod tests {
    use super::parse_environments;

    #[test]
    fn defaults_enterprise_api_url() {
        let environments = parse_environments(
            r#"[{"id":"server","name":"GitHub Enterprise Server","web_base_url":"https://github.contoso.com","client_id":"id","client_secret":"secret"}]"#,
        )
        .unwrap();

        assert_eq!(
            environments[0].environment.api_base_url,
            "https://github.contoso.com/api/v3"
        );
        assert_eq!(
            environments[0].authorize_url,
            "https://github.contoso.com/login/oauth/authorize"
        );
    }

    #[test]
    fn uses_github_dot_com_api_url() {
        let environments = parse_environments(
            r#"[{"id":"github","name":"GitHub.com","web_base_url":"https://github.com","client_id":"id","client_secret":"secret"}]"#,
        )
        .unwrap();

        assert_eq!(
            environments[0].environment.api_base_url,
            "https://api.github.com"
        );
    }

    #[test]
    fn uses_enterprise_cloud_data_residency_api_url() {
        let environments = parse_environments(
            r#"[{"id":"msft","name":"Microsoft GitHub","web_base_url":"https://msft.ghe.com","client_id":"id","client_secret":"secret"}]"#,
        )
        .unwrap();

        assert_eq!(
            environments[0].environment.api_base_url,
            "https://api.msft.ghe.com"
        );
    }

    #[test]
    fn rejects_environment_ids_that_are_unsafe_for_storage_keys() {
        let result = parse_environments(
            r#"[{"id":"msft/ghe","name":"Microsoft GitHub","web_base_url":"https://msft.ghe.com","client_id":"id","client_secret":"secret"}]"#,
        );

        assert!(result.is_err());
    }
}
