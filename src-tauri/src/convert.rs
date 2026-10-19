use crate::{
    model::{self, Project},
    storage::{atomic_write, io_error, read_limited},
};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    time::{Duration, Instant},
};

pub fn tools_dir() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    let beside = exe.parent().unwrap_or(Path::new(".")).join("tools");
    #[cfg(debug_assertions)]
    if !beside.join("pandoc.exe").exists() {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tools");
    }
    beside
}
fn run(command: &mut Command) -> Result<Output, String> {
    run_bounded(command, Duration::from_secs(120), 64 * 1024 * 1024)
}
fn run_bounded(
    command: &mut Command,
    timeout: Duration,
    max_stdout: u64,
) -> Result<Output, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let capture = tempfile::tempdir().map_err(io_error)?;
    let stdout = capture.path().join("stdout");
    let stderr = capture.path().join("stderr");
    let mut child = command
        .stdin(Stdio::null())
        .stdout(fs::File::create(&stdout).map_err(io_error)?)
        .stderr(fs::File::create(&stderr).map_err(io_error)?)
        .spawn().map_err(|_| {
        "Не удалось запустить локальный конвертер. Выполните Prepare-converters.cmd из папки приложения и проверьте папку tools."
            .to_string()
    })?;
    let started = Instant::now();
    let result: Result<Output, String> = (|| loop {
        if started.elapsed() >= timeout
            || fs::metadata(&stdout).map_err(io_error)?.len() > max_stdout
            || fs::metadata(&stderr).map_err(io_error)?.len() > 1024 * 1024
        {
            return Err("Конвертация остановлена: превышен лимит времени или размера результата. Проект и исходник сохранены.".into());
        }
        if let Some(status) = child.try_wait().map_err(io_error)? {
            return Ok(Output {
                status,
                stdout: read_limited(&stdout, max_stdout)?,
                stderr: read_limited(&stderr, 1024 * 1024)?,
            });
        }
        std::thread::sleep(Duration::from_millis(20));
    })();
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let output = result?;
    if !output.status.success() {
        return Err("Конвертация не выполнена. Исходник и проект не изменены. Проверьте, что документ не зашифрован и доступно место на диске.".into());
    }
    Ok(output)
}
pub fn import_docx(source: &Path) -> Result<(String, Vec<String>), String> {
    let bytes = read_limited(source, 100 * 1024 * 1024)?;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(&bytes))
        .map_err(|_| "Это не DOCX или файл повреждён.")?;
    if zip.len() > 4096 {
        return Err("В DOCX слишком много файлов (лимит 4096).".into());
    }
    let mut total = 0u64;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|_| "DOCX повреждён.")?;
        total = total
            .checked_add(entry.size())
            .ok_or("DOCX слишком большой.")?;
        if entry.size() > 64 * 1024 * 1024 || total > 128 * 1024 * 1024 {
            return Err("DOCX превышает лимит распаковки: 64 МБ на файл, 128 МБ суммарно.".into());
        }
        // Check actual inflation and CRC before giving the archive to another parser.
        let read = std::io::copy(
            &mut entry.by_ref().take(64 * 1024 * 1024 + 1),
            &mut std::io::sink(),
        )
        .map_err(io_error)?;
        if read != entry.size() {
            return Err("DOCX повреждён или превышает лимит распаковки.".into());
        }
    }
    let mut xml = String::new();
    zip.by_name("word/document.xml")
        .map_err(|_| "В файле нет документа Word.")?
        .take(64 * 1024 * 1024 + 1)
        .read_to_string(&mut xml)
        .map_err(io_error)?;
    let mut warnings = vec!["Импорт переносит текст, заголовки, списки, жирное, курсив, подчёркивание. Макет страниц, шрифты и точное оформление Word не переносятся. Исходный DOCX сохранён в материалах.".into()];
    for (marker, warning) in [
        ("<w:tbl", "Таблицы преобразованы в обычный текст."),
        (
            "<w:drawing",
            "Изображения не включены в редактируемый текст.",
        ),
        (
            "<w:footnoteReference",
            "Сноски добавлены как обычный текст в конце.",
        ),
        ("<w:comment", "Комментарии Word не импортированы."),
        (
            "<w:ins",
            "Исправления Word могут быть приняты конвертером; проверьте исходник.",
        ),
        (
            "<w:del",
            "Удаления Word могут быть приняты конвертером; проверьте исходник.",
        ),
    ] {
        if xml.contains(marker) {
            warnings.push(warning.into());
        }
    }
    let output = run(Command::new(tools_dir().join("pandoc.exe"))
        .args(["--sandbox", "--from=docx", "--to=html5", "--wrap=none"])
        .arg(source))?;
    let html =
        String::from_utf8(output.stdout).map_err(|_| "Не удалось прочитать результат импорта.")?;
    Ok((html, warnings))
}

pub fn export(project: &Project, format: &str, target: &Path) -> Result<(), String> {
    model::validate(project)?;
    if !["docx", "md", "txt", "pdf", "epub"].contains(&format) {
        return Err("Неизвестный формат экспорта.".into());
    }
    let stage = target
        .parent()
        .ok_or("Нет папки экспорта.")?
        .join(format!(".export-{}", model::id()));
    fs::create_dir(&stage).map_err(io_error)?;
    let result = (|| {
        let input = stage.join("manuscript.html");
        fs::write(&input, model::manuscript_html(project)).map_err(io_error)?;
        let output = stage.join(format!("manuscript.{format}"));
        let mut command = Command::new(tools_dir().join("pandoc.exe"));
        command
            .arg("--sandbox")
            .arg("--from=html")
            .arg("--standalone")
            .arg("--metadata=lang:ru")
            .arg(format!("--metadata=title:{}", project.title))
            .arg("--wrap=none")
            .arg(&input);
        if format == "pdf" {
            let typ = stage.join("manuscript.typ");
            run(command
                .arg("--to=typst")
                .arg("--variable=mainfont:Times New Roman")
                .arg("--variable=fontsize:12pt")
                .arg("--variable=papersize:a4")
                .arg("--output")
                .arg(&typ))?;
            run(Command::new(tools_dir().join("typst.exe"))
                .arg("compile")
                .arg("--root")
                .arg(&stage)
                .arg(&typ)
                .arg(&output))?;
        } else {
            let writer = match format {
                "md" => "markdown",
                "txt" => "plain",
                "epub" => "epub3",
                _ => "docx",
            };
            run(command
                .arg(format!("--to={writer}"))
                .arg("--output")
                .arg(&output))?;
        }
        let bytes = read_limited(&output, 250 * 1024 * 1024)?;
        if bytes.is_empty() {
            return Err("Конвертер создал пустой файл.".into());
        }
        atomic_write(target, &bytes)
    })();
    let _ = fs::remove_dir_all(&stage);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn compressed_oversized_docx_is_rejected_before_conversion() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("oversized.docx");
        let mut zip = zip::ZipWriter::new(fs::File::create(&source).unwrap());
        zip.start_file(
            "word/document.xml",
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )
        .unwrap();
        let chunk = [b' '; 1024 * 1024];
        for _ in 0..65 {
            zip.write_all(&chunk).unwrap();
        }
        zip.finish().unwrap();
        assert!(fs::metadata(&source).unwrap().len() < 100 * 1024);
        assert!(import_docx(&source)
            .unwrap_err()
            .contains("лимит распаковки"));
    }
    #[test]
    #[cfg(windows)]
    fn converter_timeout_and_output_limit() {
        let mut stalled = Command::new("powershell.exe");
        stalled.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Start-Sleep -Seconds 30",
        ]);
        let started = Instant::now();
        assert!(run_bounded(&mut stalled, Duration::from_millis(100), 1024).is_err());
        assert!(started.elapsed() < Duration::from_secs(5));
        let mut noisy = Command::new("powershell.exe");
        noisy.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::Out.Write('x' * 8192)",
        ]);
        assert!(run_bounded(&mut noisy, Duration::from_secs(10), 1024).is_err());
    }
    #[test]
    fn all_formats_and_docx_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let mut project = model::new_project("Дорога к морю".into());
        project.chapters[0].document = serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Русский текст — море & <ветер>","marks":[{"type":"bold"}]}]}]});
        for format in ["docx", "md", "txt", "pdf", "epub"] {
            let target = dir.path().join(format!("Книга.{format}"));
            export(&project, format, &target).unwrap_or_else(|e| panic!("{format}: {e}"));
            assert!(fs::metadata(&target).unwrap().len() > 30);
            if let Some(out) = std::env::var_os("STORYLENS_QA_ARTIFACTS") {
                fs::create_dir_all(&out).unwrap();
                fs::copy(&target, PathBuf::from(out).join(format!("book.{format}"))).unwrap();
            }
        }
        let (html, _) = import_docx(&dir.path().join("Книга.docx")).unwrap();
        assert!(html.contains("Русский текст"));
        assert!(html.contains("<strong>"));
        assert!(fs::read_to_string(dir.path().join("Книга.txt"))
            .unwrap()
            .contains("Русский текст"));
        assert!(fs::read(dir.path().join("Книга.pdf"))
            .unwrap()
            .starts_with(b"%PDF-"));
    }
    #[test]
    fn complex_docx_reports_tables_and_preserves_cell_text() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("table.html");
        let docx = dir.path().join("table.docx");
        fs::write(&input, "<html><meta charset=utf-8><body><h1>Глава</h1><p><em>Курсив</em> и <strong>жирный</strong></p><table><tr><td>Станция</td><td>Море</td></tr></table></body></html>").unwrap();
        run(Command::new(tools_dir().join("pandoc.exe"))
            .arg("--sandbox")
            .arg("--from=html")
            .arg(&input)
            .arg("--output")
            .arg(&docx))
        .unwrap();
        let preserved = dir.path().join(model::id());
        fs::copy(&docx, &preserved).unwrap();
        fs::write(&docx, b"source changed after copying").unwrap();
        let (html, warnings) = import_docx(&preserved).unwrap();
        assert!(warnings.iter().any(|s| s.contains("Таблицы")));
        assert!(html.contains("Станция") && html.contains("Море") && html.contains("<em>"));
    }
}
