pub mod s3;
pub mod webdav;

use crate::domain::{
    cloud_sync::{
        validate_profile_for_connect, CloudSyncProfile, FileIdentity, S3_PROVIDER_ID,
        WEBDAV_PROVIDER_ID,
    },
    AppError, AppResult,
};
use s3::S3Provider;
use webdav::WebDavProvider;

pub trait CloudProvider: Send + Sync {
    #[allow(dead_code)]
    fn id(&self) -> &'static str;
    fn probe(&self) -> AppResult<()>;
    fn list(&self) -> AppResult<Vec<FileIdentity>>;
    fn list_with_progress(
        &self,
        on_progress: &(dyn Fn(&str) + Send + Sync),
    ) -> AppResult<Vec<FileIdentity>> {
        let _ = on_progress;
        self.list()
    }
    fn get(&self, relative_path: &str) -> AppResult<Vec<u8>>;
    fn put(&self, relative_path: &str, bytes: &[u8]) -> AppResult<FileIdentity>;
    fn delete(&self, relative_path: &str) -> AppResult<()>;
}

/// Provider construction is isolated from the sync planner. New remote
/// protocols only need an implementation of `CloudProvider`, a settings
/// variant, and one registry entry here.
pub trait CloudProviderFactory: Send + Sync {
    fn id(&self) -> &'static str;
    fn create(&self, profile: &CloudSyncProfile) -> AppResult<Box<dyn CloudProvider>>;
}

struct WebDavProviderFactory;

impl CloudProviderFactory for WebDavProviderFactory {
    fn id(&self) -> &'static str {
        WEBDAV_PROVIDER_ID
    }

    fn create(&self, profile: &CloudSyncProfile) -> AppResult<Box<dyn CloudProvider>> {
        Ok(Box::new(WebDavProvider::from_profile(profile)?))
    }
}

struct S3ProviderFactory;

impl CloudProviderFactory for S3ProviderFactory {
    fn id(&self) -> &'static str {
        S3_PROVIDER_ID
    }

    fn create(&self, profile: &CloudSyncProfile) -> AppResult<Box<dyn CloudProvider>> {
        Ok(Box::new(S3Provider::from_profile(profile)?))
    }
}

static WEBDAV_FACTORY: WebDavProviderFactory = WebDavProviderFactory;
static S3_FACTORY: S3ProviderFactory = S3ProviderFactory;

fn provider_factories() -> [&'static dyn CloudProviderFactory; 2] {
    [&WEBDAV_FACTORY, &S3_FACTORY]
}

pub fn provider_from_profile(profile: &CloudSyncProfile) -> AppResult<Box<dyn CloudProvider>> {
    validate_profile_for_connect(profile)?;
    provider_factories()
        .into_iter()
        .find(|factory| factory.id() == profile.provider)
        .ok_or_else(|| {
            AppError::new(
                crate::domain::ErrorCode::Io,
                format!("Unsupported cloud provider: {}.", profile.provider),
            )
        })?
        .create(profile)
}
