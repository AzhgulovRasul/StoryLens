#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod convert;
mod model;
mod storage;

use model::{Attachment, Project};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
use storage::Session;
use tauri::State;

#[derive(Default)]
struct AppState(Mutex<Option<Session>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Opened {
    project: Project,
    path: String,
    backup_folder: String,
}
fn opened(s: &Session) -> Opened {
    Opened {
        project: s.project.clone(),
        path: s.root.display().to_string(),
        backup_folder: s
            .root
            .parent()
            .unwrap_or(&s.root)
            .join("StoryLens backups")
            .join(&s.project.id)
            .display()
            .to_string(),
    }
}
fn folder() -> Option<PathBuf> {
    rfd::FileDialog::new()
        .set_title("Выберите папку")
        .pick_folder()
}
fn component(title: &str) -> Result<String, String> {
    let name: String = title
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(80)
        .collect();
    let name = name.trim().trim_end_matches(['.', ' ']);
    if name.is_empty()
        || ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "LPT1", "LPT2"]
            .contains(&name.to_uppercase().as_str())
    {
        return Err("Укажите другое имя книги.".into());
    }
    Ok(name.to_string())
}
fn selected_save(name: &str, ext: &str) -> Result<Option<PathBuf>, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("Сохранить файл")
        .set_file_name(name)
        .add_filter("Файл", &[ext])
        .save_file()
    else {
        return Ok(None);
    };
    if path.exists()
        && !rfd::MessageDialog::new()
            .set_title("Заменить файл?")
            .set_description("Файл уже существует. Заменить его новым файлом?")
            .set_buttons(rfd::MessageButtons::YesNo)
            .show()
            .eq(&rfd::MessageDialogResult::Yes)
    {
        return Ok(None);
    }
    Ok(Some(path))
}
fn outside_project(path: &Path, session: &Session) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("Не удалось определить папку назначения.")?
        .canonicalize()
        .map_err(storage::io_error)?;
    let root = session.root.canonicalize().map_err(storage::io_error)?;
    if parent.starts_with(&root) {
        return Err("Выберите папку вне рабочей папки книги, чтобы не заменить её данные.".into());
    }
    Ok(())
}

#[tauri::command]
async fn create_project(
    title: String,
    state: State<'_, AppState>,
) -> Result<Option<Opened>, String> {
    let name = component(&title)?;
    let Some(parent) = folder() else {
        return Ok(None);
    };
    let session = Session::create(parent.join(name), title)?;
    let result = opened(&session);
    *state.0.lock().map_err(|_| "Ошибка состояния.")? = Some(session);
    Ok(Some(result))
}
#[tauri::command]
async fn open_project(state: State<'_, AppState>) -> Result<Option<Opened>, String> {
    let Some(root) = folder() else {
        return Ok(None);
    };
    let mut guard = state.0.lock().map_err(|_| "Ошибка состояния.")?;
    if let Some(current) = &*guard {
        if current.root == root {
            return Ok(Some(opened(current)));
        }
    }
    let session = Session::open(root)?;
    let result = opened(&session);
    *guard = Some(session);
    Ok(Some(result))
}
#[tauri::command]
async fn save_project(
    project: Project,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    state
        .0
        .lock()
        .map_err(|_| "Ошибка состояния.")?
        .as_mut()
        .ok_or("Сначала откройте книгу.")?
        .save(project)
}
#[tauri::command]
async fn backup_project(
    project: Project,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let Some(path) = selected_save(
        &format!("{}.storylens.zip", component(&project.title)?),
        "zip",
    )?
    else {
        return Ok(None);
    };
    let guard = state.0.lock().map_err(|_| "Ошибка состояния.")?;
    let session = guard.as_ref().ok_or("Нет открытой книги.")?;
    outside_project(&path, session)?;
    session.backup_current(&path, &project)?;
    Ok(Some(path.display().to_string()))
}
#[tauri::command]
async fn restore_project(
    title: String,
    previous: bool,
    state: State<'_, AppState>,
) -> Result<Option<Opened>, String> {
    let source = if previous {
        folder()
    } else {
        rfd::FileDialog::new()
            .set_title("Выберите резервную копию StoryLens")
            .add_filter("Резервная копия", &["zip"])
            .pick_file()
    };
    let Some(source) = source else {
        return Ok(None);
    };
    let Some(parent) = folder() else {
        return Ok(None);
    };
    let dest = parent.join(component(&title)?);
    if previous {
        storage::recover_previous(&source, &dest)?;
    } else {
        storage::restore(&source, &dest)?;
    }
    let session = Session::open(dest)?;
    let result = opened(&session);
    *state.0.lock().map_err(|_| "Ошибка состояния.")? = Some(session);
    Ok(Some(result))
}
#[derive(Serialize)]
struct Imported {
    html: String,
    attachment: Attachment,
    warnings: Vec<String>,
}
#[tauri::command]
async fn import_docx(state: State<'_, AppState>) -> Result<Option<Imported>, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("Импортировать DOCX новой главой")
        .add_filter("Word", &["docx"])
        .pick_file()
    else {
        return Ok(None);
    };
    let guard = state.0.lock().map_err(|_| "Ошибка состояния.")?;
    let session = guard.as_ref().ok_or("Нет открытой книги.")?;
    let attachment = session.add_asset(&path)?;
    // Convert the preserved copy so edits in Word cannot change import provenance.
    let (html, warnings) = convert::import_docx(&session.root.join(&attachment.path))?;
    Ok(Some(Imported {
        html,
        attachment,
        warnings,
    }))
}
#[tauri::command]
async fn add_attachment(state: State<'_, AppState>) -> Result<Option<Attachment>, String> {
    let Some(source) = rfd::FileDialog::new()
        .set_title("Добавить копию файла в книгу")
        .pick_file()
    else {
        return Ok(None);
    };
    let guard = state.0.lock().map_err(|_| "Ошибка состояния.")?;
    Ok(Some(
        guard
            .as_ref()
            .ok_or("Нет открытой книги.")?
            .add_asset(&source)?,
    ))
}
#[tauri::command]
async fn extract_attachment(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let guard = state.0.lock().map_err(|_| "Ошибка состояния.")?;
    let session = guard.as_ref().ok_or("Нет открытой книги.")?;
    let a = session
        .project
        .attachments
        .iter()
        .find(|a| a.id == id)
        .ok_or("Вложение ещё не сохранено. Сохраните книгу.")?;
    let extension = Path::new(&a.name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("bin");
    let Some(path) = selected_save(&a.name, extension)? else {
        return Ok(None);
    };
    outside_project(&path, session)?;
    let bytes = storage::read_limited(&session.root.join(&a.path), 250 * 1024 * 1024)?;
    if storage::hash(&bytes) != a.sha256 {
        return Err("Вложение повреждено.".into());
    }
    storage::atomic_write(&path, &bytes)?;
    Ok(Some(path.display().to_string()))
}
#[tauri::command]
async fn export_project(
    project: Project,
    format: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    if !["docx", "md", "txt", "pdf", "epub"].contains(&format.as_str()) {
        return Err("Неизвестный формат.".into());
    }
    let Some(path) = selected_save(
        &format!("{}.{}", component(&project.title)?, format),
        &format,
    )?
    else {
        return Ok(None);
    };
    let guard = state.0.lock().map_err(|_| "Ошибка состояния.")?;
    let session = guard.as_ref().ok_or("Нет открытой книги.")?;
    outside_project(&path, session)?;
    convert::export(&project, &format, &path)?;
    Ok(Some(path.display().to_string()))
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            create_project,
            open_project,
            save_project,
            backup_project,
            restore_project,
            import_docx,
            add_attachment,
            extract_attachment,
            export_project
        ])
        .run(tauri::generate_context!())
        .expect("StoryLens не удалось запустить");
}
