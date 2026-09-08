use std::path::Path;

use nac_core::ssh_configurations::{
    self, NewSshConfiguration, SshConfigurationRecord, SshConfigurationStoreError,
};

use super::Field;

#[cfg(test)]
#[path = "ssh_configurations_tests.rs"]
mod tests;

pub(crate) struct CreateSshConfiguration {
    pub(crate) name: String,
    pub(crate) ssh_host: String,
    pub(crate) ssh_port: Option<u16>,
    pub(crate) ssh_identity_file: Option<String>,
}

pub(crate) struct UpdateSshConfiguration {
    pub(crate) name: Field<String>,
    pub(crate) ssh_host: Field<String>,
    pub(crate) ssh_port: Field<u16>,
    pub(crate) ssh_identity_file: Field<String>,
}

/// Owns the saved SSH-connection use cases independently of HTTP and session
/// lifecycle coordination.
pub(crate) struct SshConfigurationApplication<'a> {
    store_path: &'a Path,
}

impl<'a> SshConfigurationApplication<'a> {
    pub(crate) fn new(store_path: &'a Path) -> Self {
        Self { store_path }
    }

    pub(crate) fn list(&self) -> Result<Vec<SshConfigurationRecord>, SshConfigurationStoreError> {
        ssh_configurations::list_ssh_configurations(self.store_path)
    }

    pub(crate) fn create(
        &self,
        command: CreateSshConfiguration,
    ) -> Result<SshConfigurationRecord, SshConfigurationStoreError> {
        ssh_configurations::insert_ssh_configuration(
            self.store_path,
            &uuid::Uuid::new_v4().to_string(),
            NewSshConfiguration {
                name: command.name,
                ssh_host: command.ssh_host,
                ssh_port: command.ssh_port,
                ssh_identity_file: command.ssh_identity_file,
            },
        )
    }

    pub(crate) fn update(
        &self,
        config_id: &str,
        command: UpdateSshConfiguration,
    ) -> Result<SshConfigurationRecord, SshConfigurationStoreError> {
        let existing = ssh_configurations::load_ssh_configuration(self.store_path, config_id)?;
        ssh_configurations::update_ssh_configuration(
            self.store_path,
            config_id,
            NewSshConfiguration {
                name: required_text(command.name, &existing.name),
                ssh_host: required_text(command.ssh_host, &existing.ssh_host),
                ssh_port: optional_value(command.ssh_port, existing.ssh_port),
                ssh_identity_file: optional_value(
                    command.ssh_identity_file,
                    existing.ssh_identity_file,
                ),
            },
        )
    }

    pub(crate) fn delete(&self, config_id: &str) -> Result<(), SshConfigurationStoreError> {
        ssh_configurations::load_ssh_configuration(self.store_path, config_id)?;
        ssh_configurations::delete_ssh_configuration(self.store_path, config_id)?;
        Ok(())
    }
}

fn required_text(field: Field<String>, current: &str) -> String {
    match field {
        Field::Set(value) => value,
        Field::Clear => String::new(),
        Field::Unchanged => current.to_string(),
    }
}

fn optional_value<T>(field: Field<T>, current: Option<T>) -> Option<T> {
    match field {
        Field::Set(value) => Some(value),
        Field::Clear => None,
        Field::Unchanged => current,
    }
}
