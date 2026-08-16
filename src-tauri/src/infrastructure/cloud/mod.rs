pub mod webdav;

use crate::domain::{
    cloud_sync::{validate_profile_for_connect, CloudSyncProfile, FileIdentity, WEBDAV_PROVIDER_ID},
    AppError, AppResult,
};
use webdav::WebDavProvider;

pub trait CloudProvider: Send + Sync {
    #[allow(dead_code)]
    fn id(&self) -> &'static str;
    fn probe(&self) -> AppResult<()>;
    fn list(&self) -> AppResult<Vec<FileIdentity>>;
    fn get(&self, relative_path: &str) -> AppResult<Vec<u8>>;
    fn put(&self, relative_path: &str, bytes: &[u8]) -> AppResult<FileIdentity>;
    fn delete(&self, relative_path: &str) -> AppResult<()>;
}

pub fn provider_from_profile(profile: &CloudSyncProfile) -> AppResult<Box<dyn CloudProvider>> {
    validate_profile_for_connect(profile)?;
    match profile.provider.as_str() {
        WEBDAV_PROVIDER_ID => Ok(Box::new(WebDavProvider::from_profile(profile)?)),
        other => Err(AppError::new(
            crate::domain::ErrorCode::Io,
            format!("Unsupported cloud provider: {other}."),
        )),
    }
}
