//! Typed read-only product observations and destination resolution. The host
//! composes this port; it grants no browser, configuration or execution authority.
mod contracts;
pub use contracts::*;
use futures_util::future::BoxFuture;

pub type ProductContextFuture<'a, T> = BoxFuture<'a, anyhow::Result<T>>;

pub trait ProductContextPort: Send + Sync {
    fn read(&self) -> BoxFuture<'_, anyhow::Result<ProductContext>>;
    fn resolve(
        &self,
        destination: ProductDestination,
        expected_build_id: String,
    ) -> BoxFuture<'_, anyhow::Result<ProductNavigationResolution>>;
}
