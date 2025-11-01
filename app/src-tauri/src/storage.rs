use keyring::{Entry, Error as KeyringError};

use crate::error::{AppError, AppResult};

const SERVICE_NAME: &str = "github-review";
const ACCOUNT_NAME: &str = "github-token";

pub fn store_token(token: &str) -> AppResult<()> {
    let entry = Entry::new(SERVICE_NAME, ACCOUNT_NAME)?;
    entry.set_password(token)?;
    Ok(())
}

pub fn read_token() -> AppResult<Option<String>> {
    let entry = Entry::new(SERVICE_NAME, ACCOUNT_NAME)?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(err) => match err {
            KeyringError::NoEntry => Ok(None),
            other => Err(AppError::from(other)),
        },
    }
}

pub fn delete_token() -> AppResult<()> {
    let entry = Entry::new(SERVICE_NAME, ACCOUNT_NAME)?;
    match entry.delete_password() {
        Ok(_) => Ok(()),
        Err(err) => match err {
            KeyringError::NoEntry => Ok(()),
            other => Err(AppError::from(other)),
        },
    }
}
