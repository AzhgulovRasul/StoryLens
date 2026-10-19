use crate::model::{self, Attachment, Project};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

pub const MAX_JSON: u64 = 64 * 1024 * 1024;
const MAX_ASSET: u64 = 250 * 1024 * 1024;
const MAX_BACKUP: u64 = 1024 * 1024 * 1024;
pub fn io_error(e: std::io::Error) -> String {
    format!("Операция с файлом не выполнена ({:?}). Проверьте права и свободное место. Данные в редакторе сохранены в памяти.", e.kind())
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn read_limited(path: &Path, max: u64) -> Result<Vec<u8>, String> {
    safe_file(path)?;
    let file = File::open(path).map_err(io_error)?;
    if file.metadata().map_err(io_error)?.len() > max {
        return Err("Файл превышает допустимый размер.".into());
    }
    let mut bytes = vec![];
    file.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(io_error)?;
    if bytes.len() as u64 > max {
        return Err("Файл превышает допустимый размер.".into());
    }
    Ok(bytes)
}
pub fn safe_file(path: &Path) -> Result<(), String> {
    let m = fs::symlink_metadata(path).map_err(io_error)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return Err("Ссылки и точки перенаправления внутри проекта не поддерживаются.".into());
        }
    }
    if m.file_type().is_symlink() {
        return Err("Ссылки внутри проекта не поддерживаются.".into());
    }
    Ok(())
}
fn parse(bytes: &[u8]) -> Result<Project, String> {
    let project: Project = serde_json::from_slice(bytes).map_err(|_| {
        "Файл проекта повреждён. Откройте «Восстановить»; исходный файл не изменён.".to_string()
    })?;
    model::validate(&project)?;
    Ok(project)
}

#[cfg(windows)]
fn replace(source: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let s: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let t: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe {
        MoveFileExW(
            s.as_ptr(),
            t.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(io_error(std::io::Error::last_os_error()));
    }
    Ok(())
}
#[cfg(not(windows))]
fn replace(source: &Path, target: &Path) -> Result<(), String> {
    fs::rename(source, target).map_err(io_error)
}

pub fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = target.with_file_name(format!(".{}.tmp", model::id()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(io_error)?;
        file.write_all(bytes).map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
        drop(file);
        replace(&temp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

pub struct Session {
    pub root: PathBuf,
    pub project: Project,
    disk: Vec<u8>,
    _lock: File,
    last_backup: Instant,
}
impl Session {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        safe_file(&root)?;
        let lock_path = root.join(".storylens.lock");
        if lock_path.exists() {
            safe_file(&lock_path)?;
        }
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)
            .map_err(io_error)?;
        lock.try_lock().map_err(|_| {
            "Книга уже открыта для редактирования в другом окне StoryLens.".to_string()
        })?;
        let disk = read_limited(&root.join("project.json"), MAX_JSON)?;
        let project = parse(&disk)?;
        verify_assets(&root, &project)?;
        Ok(Self {
            root,
            project,
            disk,
            _lock: lock,
            last_backup: Instant::now() - Duration::from_secs(301),
        })
    }
    pub fn create(root: PathBuf, title: String) -> Result<Self, String> {
        let project = model::new_project(title);
        model::validate(&project)?;
        fs::create_dir(&root)
            .map_err(|_| "Папка уже существует или недоступна. Выберите новое имя.".to_string())?;
        fs::create_dir(root.join("assets")).map_err(io_error)?;
        atomic_write(
            &root.join("project.json"),
            &serde_json::to_vec_pretty(&project).map_err(|_| "Не удалось подготовить проект.")?,
        )?;
        Self::open(root)
    }
    pub fn save(&mut self, project: Project) -> Result<Option<String>, String> {
        self.commit(project, false)
    }
    fn commit(
        &mut self,
        project: Project,
        fail_before_commit: bool,
    ) -> Result<Option<String>, String> {
        model::validate(&project)?;
        if project.id != self.project.id {
            return Err("Это данные другой книги. Сохранение остановлено.".into());
        }
        verify_assets(&self.root, &project)?;
        let current = read_limited(&self.root.join("project.json"), MAX_JSON)?;
        if current != self.disk {
            return Err("Файл изменён другой программой. Сохранение остановлено. Создайте резервную копию текущей работы и откройте книгу заново.".into());
        }
        let bytes =
            serde_json::to_vec_pretty(&project).map_err(|_| "Не удалось подготовить запись.")?;
        if bytes.len() as u64 > MAX_JSON {
            return Err("Книга превышает лимит 64 МБ JSON.".into());
        }
        atomic_write(&self.root.join("project.previous.json"), &self.disk)?;
        if fail_before_commit {
            return Err("Проверочный обрыв до замены файла".into());
        }
        atomic_write(&self.root.join("project.json"), &bytes)?;
        self.disk = bytes;
        self.project = project;
        if self.last_backup.elapsed() >= Duration::from_secs(300) {
            let folder = self
                .root
                .parent()
                .ok_or("Нет папки резервных копий.")?
                .join("StoryLens backups")
                .join(&self.project.id);
            let result = (|| {
                fs::create_dir_all(&folder).map_err(io_error)?;
                let seconds = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                self.backup(&folder.join(format!("{seconds}-{}.storylens.zip", model::id())))
            })();
            if let Err(e) = result {
                return Ok(Some(format!(
                    "Книга сохранена, но резервная копия не создана: {e}"
                )));
            }
            self.last_backup = Instant::now();
        }
        Ok(None)
    }
    pub fn add_asset(&self, source: &Path) -> Result<Attachment, String> {
        let bytes = read_limited(source, MAX_ASSET)?;
        let id = model::id();
        let path = format!("assets/{id}");
        safe_file(&self.root.join("assets"))?;
        atomic_write(&self.root.join(&path), &bytes)?;
        Ok(Attachment {
            id,
            name: source
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            path,
            sha256: hash(&bytes),
        })
    }
    pub fn backup(&self, target: &Path) -> Result<(), String> {
        model::validate(&self.project)?;
        verify_assets(&self.root, &self.project)?;
        write_backup(target, &self.root, &self.project)
    }
    pub fn backup_current(&self, target: &Path, project: &Project) -> Result<(), String> {
        model::validate(project)?;
        if project.id != self.project.id {
            return Err("Другая книга.".into());
        }
        verify_assets(&self.root, project)?;
        write_backup(target, &self.root, project)
    }
}

fn verify_assets(root: &Path, project: &Project) -> Result<(), String> {
    if !project.attachments.is_empty() {
        safe_file(&root.join("assets"))?;
    }
    let mut total = 0u64;
    for asset in &project.attachments {
        let bytes = read_limited(&root.join(&asset.path), MAX_ASSET)?;
        total += bytes.len() as u64;
        if total > MAX_BACKUP {
            return Err("Вложения книги превышают 1 ГБ.".into());
        }
        if hash(&bytes) != asset.sha256 {
            return Err(
                "Вложение отсутствует или повреждено. Восстановите книгу из резервной копии."
                    .into(),
            );
        }
    }
    Ok(())
}
fn write_backup(target: &Path, root: &Path, project: &Project) -> Result<(), String> {
    let temp = target.with_file_name(format!(".{}.tmp", model::id()));
    let result = (|| {
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(io_error)?;
        let mut zip = ZipWriter::new(file);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("project.json", options)
            .map_err(|_| "Не удалось создать архив.")?;
        zip.write_all(&serde_json::to_vec_pretty(project).map_err(|_| "Неверные данные проекта.")?)
            .map_err(io_error)?;
        for a in &project.attachments {
            zip.start_file(&a.path, options)
                .map_err(|_| "Не удалось добавить вложение в архив.")?;
            zip.write_all(&read_limited(&root.join(&a.path), MAX_ASSET)?)
                .map_err(io_error)?;
        }
        zip.finish()
            .map_err(|_| "Не удалось завершить архив.")?
            .sync_all()
            .map_err(io_error)?;
        replace(&temp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

pub fn restore(archive: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        return Err("Папка назначения уже существует. Укажите новое имя.".into());
    }
    let file = File::open(archive).map_err(io_error)?;
    let mut zip = ZipArchive::new(file).map_err(|_| "Не удалось прочитать архив.")?;
    if zip.len() > 20000 {
        return Err("Слишком много файлов в архиве.".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|_| "Повреждённый архив.")?;
        let name = entry
            .name()
            .map_err(|_| "Недопустимое имя файла в архиве.")?;
        let allowed = name == "project.json"
            || name
                .strip_prefix("assets/")
                .is_some_and(|s| uuid::Uuid::parse_str(s).is_ok() && !s.contains(['/', '\\']));
        total = total
            .checked_add(entry.size())
            .ok_or("Архив слишком большой.")?;
        if !allowed
            || !seen.insert(name.to_string())
            || entry.size() > MAX_ASSET
            || total > MAX_BACKUP + MAX_JSON
            || entry.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
        {
            return Err(
                "Архив содержит недопустимые пути, ссылки или превышает лимит размера.".into(),
            );
        }
    }
    let stage = destination.with_file_name(format!(".restore-{}", model::id()));
    fs::create_dir(&stage).map_err(io_error)?;
    let result = (|| {
        fs::create_dir(stage.join("assets")).map_err(io_error)?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|_| "Повреждённый архив.")?;
            let name = entry
                .name()
                .map_err(|_| "Недопустимое имя файла в архиве.")?;
            let limit = if name == "project.json" {
                MAX_JSON
            } else {
                MAX_ASSET
            };
            let path = stage.join(name.as_ref());
            let mut out = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(path)
                .map_err(io_error)?;
            let expected = entry.size();
            let actual =
                std::io::copy(&mut entry.by_ref().take(limit + 1), &mut out).map_err(io_error)?;
            if actual > limit || actual != expected {
                return Err("Архив повреждён или превышает лимит распаковки.".into());
            }
            out.sync_all().map_err(io_error)?;
        }
        let project = parse(&read_limited(&stage.join("project.json"), MAX_JSON)?)?;
        verify_assets(&stage, &project)?;
        if seen.len() != project.attachments.len() + 1 {
            return Err("Состав архива не совпадает с проектом.".into());
        }
        fs::rename(&stage, destination).map_err(io_error)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&stage);
    }
    result
}

pub fn recover_previous(root: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        return Err("Укажите новую папку для восстановленной книги.".into());
    }
    let project = parse(&read_limited(
        &root.join("project.previous.json"),
        MAX_JSON,
    )?)?;
    verify_assets(root, &project)?;
    let temp = destination.with_file_name(format!(".recovery-{}.zip", model::id()));
    write_backup(&temp, root, &project)?;
    let result = restore(&temp, destination);
    let _ = fs::remove_file(temp);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn save_lock_interrupt_external_change_and_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Книга");
        let mut s = Session::create(root.clone(), "Море".into()).unwrap();
        assert!(Session::open(root.clone()).is_err());
        let mut changed = s.project.clone();
        changed.chapters[0].document = serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Русский текст — море"}]}]});
        assert!(s.commit(changed.clone(), true).is_err());
        assert_eq!(
            parse(&fs::read(root.join("project.json")).unwrap())
                .unwrap()
                .title,
            "Море"
        );
        fs::write(root.join(".unfinished.tmp"), b"broken").unwrap();
        s.save(changed.clone()).unwrap();
        drop(s);
        let mut s = Session::open(root.clone()).unwrap();
        assert_eq!(s.project.chapters[0].document, changed.chapters[0].document);
        fs::write(root.join("project.json"), b"external").unwrap();
        assert!(s.save(changed).is_err());
        assert_eq!(fs::read(root.join("project.json")).unwrap(), b"external");
        drop(s);
        assert!(Session::open(root.clone()).is_err());
        recover_previous(&root, &dir.path().join("Recovered")).unwrap();
        assert!(Session::open(dir.path().join("Recovered")).is_ok());
    }
    #[test]
    fn backup_restores_assets_and_rejects_traversal_and_corruption() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Session::create(dir.path().join("Original"), "Роман".into()).unwrap();
        let asset = dir.path().join("заметка.txt");
        fs::write(&asset, "Материал").unwrap();
        let a = s.add_asset(&asset).unwrap();
        let mut p = s.project.clone();
        p.attachments.push(a.clone());
        s.save(p).unwrap();
        let backup = dir.path().join("backup.zip");
        s.backup(&backup).unwrap();
        let restored = dir.path().join("Restored");
        restore(&backup, &restored).unwrap();
        assert_eq!(
            fs::read(restored.join(a.path)).unwrap(),
            "Материал".as_bytes()
        );
        assert!(restore(&backup, &restored).is_err());
        let bad = dir.path().join("bad.zip");
        let mut zip = ZipWriter::new(File::create(&bad).unwrap());
        zip.start_file("../escaped", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"bad").unwrap();
        zip.finish().unwrap();
        assert!(restore(&bad, &dir.path().join("Bad")).is_err());
        assert!(!dir.path().join("escaped").exists());
        fs::write(restored.join("project.json"), "broken").unwrap();
        assert!(Session::open(restored).is_err());
    }
    #[test]
    fn failed_replace_keeps_old_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("as-directory");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("keep"), b"original").unwrap();
        assert!(atomic_write(&target, b"new").is_err());
        assert_eq!(fs::read(target.join("keep")).unwrap(), b"original");
    }
    #[test]
    fn restore_rejects_symlink_with_allowed_asset_name() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("link.zip");
        let mut zip = ZipWriter::new(File::create(&archive).unwrap());
        zip.add_symlink(
            format!("assets/{}", model::id()),
            "../../outside",
            SimpleFileOptions::default(),
        )
        .unwrap();
        zip.finish().unwrap();
        let destination = dir.path().join("Restored");
        assert!(restore(&archive, &destination)
            .unwrap_err()
            .contains("недопустимые"));
        assert!(!destination.exists());
        assert!(!dir.path().join("outside").exists());
    }
}
