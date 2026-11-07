//! Object storage for attachments: any S3-compatible service (AWS S3, MinIO, R2…) when
//! `S3_BUCKET` is set, otherwise a private directory on local disk (development).
use crate::config::Config;
use object_store::{aws::AmazonS3Builder, local::LocalFileSystem, ObjectStore};
use std::sync::Arc;

pub(crate) type Store = Arc<dyn ObjectStore>;

pub(crate) fn from_config(cfg: &Config) -> Result<Store, Box<dyn std::error::Error>> {
    if let Some(bucket) = &cfg.s3_bucket {
        let mut b = AmazonS3Builder::new()
            .with_bucket_name(bucket)
            .with_region(cfg.s3_region.clone().unwrap_or_else(|| "us-east-1".into()));
        if let Some(e) = &cfg.s3_endpoint {
            b = b.with_endpoint(e).with_virtual_hosted_style_request(false);
            if e.starts_with("http://") {
                b = b.with_allow_http(true);
            }
        }
        if let (Some(k), Some(s)) = (&cfg.s3_access_key, &cfg.s3_secret_key) {
            b = b.with_access_key_id(k).with_secret_access_key(s);
        }
        return Ok(Arc::new(b.build()?));
    }
    std::fs::create_dir_all(&cfg.attachments_dir)?;
    Ok(Arc::new(LocalFileSystem::new_with_prefix(
        &cfg.attachments_dir,
    )?))
}
