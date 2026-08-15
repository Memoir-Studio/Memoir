use crate::{
    domain::{AppResult, AttachmentFile, NoteFile},
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

    pub fn scan_attachments(&self, root: &str) -> AppResult<Vec<AttachmentFile>> {
        self.filesystem.scan_attachments(root)
    }

    pub fn save_attachment(
        &self,
        root: &str,
        bytes_base64: &str,
        file_name: Option<&str>,
        mime_type: Option<&str>,
    ) -> AppResult<AttachmentFile> {
        let bytes = decode_attachment_bytes(bytes_base64)?;
        self.filesystem
            .save_attachment(root, &bytes, file_name, mime_type)
    }

    pub fn import_attachment(&self, root: &str, source_path: &str) -> AppResult<AttachmentFile> {
        self.filesystem.import_attachment(root, source_path)
    }

    pub fn delete_attachment(&self, root: &str, relative_path: &str) -> AppResult<String> {
        self.filesystem.delete_attachment(root, relative_path)
    }
}

fn decode_attachment_bytes(bytes_base64: &str) -> AppResult<Vec<u8>> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    STANDARD.decode(bytes_base64.trim()).map_err(|error| {
        crate::domain::AppError::new(
            crate::domain::ErrorCode::Io,
            "Attachment data is not valid base64.",
        )
        .with_details(error.to_string())
    })
}
