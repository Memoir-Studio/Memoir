use crate::{
    domain::{AppResult, NoteFile},
    infrastructure::filesystem::LocalFileSystem,
};

#[derive(Debug, Clone, Default)]
pub struct WorkspaceService {
    filesystem: LocalFileSystem,
}

impl WorkspaceService {
    pub fn new(filesystem: LocalFileSystem) -> Self {
        Self { filesystem }
    }

    pub fn scan(&self, root: &str) -> AppResult<Vec<NoteFile>> {
        self.filesystem.scan_workspace(root)
    }

    pub fn read(&self, root: &str, relative_path: &str) -> AppResult<String> {
        self.filesystem.read_note(root, relative_path)
    }

    pub fn write(&self, root: &str, relative_path: &str, content: &str) -> AppResult<()> {
        self.filesystem.write_note(root, relative_path, content)
    }

    pub fn create(
        &self,
        root: &str,
        title: &str,
        extension: &str,
        folder: Option<&str>,
        tags: Option<&[String]>,
    ) -> AppResult<String> {
        self.filesystem
            .create_note(root, title, extension, folder, tags)
    }

    pub fn rename(
        &self,
        root: &str,
        old_relative_path: &str,
        new_relative_path: &str,
    ) -> AppResult<String> {
        self.filesystem
            .rename_note(root, old_relative_path, new_relative_path)
    }

    pub fn delete(&self, root: &str, relative_path: &str) -> AppResult<String> {
        self.filesystem.delete_note(root, relative_path)
    }
}
