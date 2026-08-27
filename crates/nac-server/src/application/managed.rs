use std::path::{Path, PathBuf};

use anyhow::Result;
use nac_contracts::{NewProject, ProjectRecord};
use nac_managed::clone_workflow::ProjectRegistrar;

/// SQLite-backed adapter for the managed clone workflow's project port.
#[derive(Clone)]
pub(crate) struct StoreProjectRegistrar {
    store_path: PathBuf,
}

impl StoreProjectRegistrar {
    pub(crate) fn new(store_path: impl AsRef<Path>) -> Self {
        Self {
            store_path: store_path.as_ref().to_path_buf(),
        }
    }
}

impl ProjectRegistrar for StoreProjectRegistrar {
    fn list_projects(&self) -> Result<Vec<ProjectRecord>> {
        nac_core::projects::list_projects(&self.store_path).map_err(anyhow::Error::new)
    }

    fn register_project(&self, project: NewProject) -> Result<ProjectRecord> {
        nac_core::projects::insert_project(&self.store_path, project).map_err(anyhow::Error::new)
    }
}
