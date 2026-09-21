use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const SERVICE_NAME: &str = "github-review";
const ACCOUNT_NAME: &str = "github-token";
const LOGIN_ACCOUNT_NAME: &str = "github-login";
const ACTIVE_ENVIRONMENT_ACCOUNT_NAME: &str = "github-active-environment";
const LEGACY_ENVIRONMENT_ID: &str = "github.com";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredToken {
    pub access_token: String,
    #[serde(default)]
    pub legacy: bool,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub access_token_expires_at: Option<i64>,
    #[serde(default)]
    pub refresh_token_expires_at: Option<i64>,
}

impl StoredToken {
    pub fn legacy(access_token: String) -> Self {
        Self {
            access_token,
            legacy: true,
            refresh_token: None,
            access_token_expires_at: None,
            refresh_token_expires_at: None,
        }
    }

    pub(crate) fn from_stored_value(value: String) -> Self {
        serde_json::from_str(&value).unwrap_or_else(|_| Self::legacy(value))
    }

    fn to_stored_value(&self) -> AppResult<String> {
        Ok(serde_json::to_string(self)?)
    }
}

fn environment_account_name(account_name: &str, environment_id: &str) -> String {
    format!("{account_name}:{environment_id}")
}

fn read_password(account_name: &str) -> AppResult<Option<String>> {
    let entry = Entry::new(SERVICE_NAME, account_name)?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(other) => Err(AppError::from(other)),
    }
}

fn delete_password(account_name: &str) -> AppResult<()> {
    let entry = Entry::new(SERVICE_NAME, account_name)?;
    match entry.delete_password() {
        Ok(_) | Err(KeyringError::NoEntry) => Ok(()),
        Err(other) => Err(AppError::from(other)),
    }
}

pub fn store_token(environment_id: &str, token: &StoredToken) -> AppResult<()> {
    let account_name = environment_account_name(ACCOUNT_NAME, environment_id);
    let entry = Entry::new(SERVICE_NAME, &account_name)?;
    entry.set_password(&token.to_stored_value()?)?;
    Ok(())
}

pub fn store_last_login(environment_id: &str, login: &str) -> AppResult<()> {
    let account_name = environment_account_name(LOGIN_ACCOUNT_NAME, environment_id);
    let entry = Entry::new(SERVICE_NAME, &account_name)?;
    entry.set_password(login)?;
    Ok(())
}

pub fn read_last_login(environment_id: &str) -> AppResult<Option<String>> {
    let account_name = environment_account_name(LOGIN_ACCOUNT_NAME, environment_id);
    let login = read_password(&account_name)?;
    if login.is_some() || environment_id != LEGACY_ENVIRONMENT_ID {
        return Ok(login);
    }
    read_password(LOGIN_ACCOUNT_NAME)
}

pub fn delete_last_login(environment_id: &str) -> AppResult<()> {
    let account_name = environment_account_name(LOGIN_ACCOUNT_NAME, environment_id);
    delete_password(&account_name)?;
    if environment_id == LEGACY_ENVIRONMENT_ID {
        delete_password(LOGIN_ACCOUNT_NAME)?;
    }
    Ok(())
}

pub fn read_token(environment_id: &str) -> AppResult<Option<StoredToken>> {
    let account_name = environment_account_name(ACCOUNT_NAME, environment_id);
    let token = read_password(&account_name)?.map(StoredToken::from_stored_value);
    if token.is_some() || environment_id != LEGACY_ENVIRONMENT_ID {
        return Ok(token);
    }
    Ok(read_password(ACCOUNT_NAME)?.map(StoredToken::from_stored_value))
}

pub fn delete_token(environment_id: &str) -> AppResult<()> {
    let account_name = environment_account_name(ACCOUNT_NAME, environment_id);
    delete_password(&account_name)?;
    if environment_id == LEGACY_ENVIRONMENT_ID {
        delete_password(ACCOUNT_NAME)?;
    }
    Ok(())
}

pub fn store_active_environment_id(environment_id: &str) -> AppResult<()> {
    let entry = Entry::new(SERVICE_NAME, ACTIVE_ENVIRONMENT_ACCOUNT_NAME)?;
    entry.set_password(environment_id)?;
    Ok(())
}

pub fn read_active_environment_id() -> AppResult<Option<String>> {
    read_password(ACTIVE_ENVIRONMENT_ACCOUNT_NAME)
}
