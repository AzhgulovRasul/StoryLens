## Русский

Первый публичный предварительный выпуск **StoryLens 0.1.0** для Windows 10/11 x64. Интерфейс на русском.

- Непрерывный редактор глав с привычным оформлением, поиском и отменой/повтором.
- Персонажи, мир, заметки и файлы материалов; план сцен и простая хронология; режим «Только текст».
- Локальное автосохранение, предыдущая исправная запись, полные ZIP-копии и восстановление в новую папку.
- Импорт DOCX и экспорт DOCX/PDF/EPUB/Markdown/TXT выполняются локально после подготовки конвертеров. Точное оформление Word не переносится.

**Как запустить:** скачать `StoryLens-0.1.0-windows-x64.zip`, распаковать всю папку и открыть `StoryLens.exe`. Для импорта/экспорта один раз запустить `Prepare-converters.cmd` с интернетом: он загружает официальные Pandoc/Typst и проверяет SHA-256. Затем конвертация работает без сети. Конвертеры не включены в ZIP; Node.js и Rust пользователю не нужны. Нужен системный WebView2 Runtime.

Проверено: 9 Rust-тестов, 2 теста очереди записи, 10 сценариев интерфейса, production build, Clippy, реальные локальные конвертеры пяти форматов и сохранение в Windows-окне. Для DOCX добавлены лимиты распаковки, для конвертеров — таймаут и ограничения вывода; ZIP-библиотека обновлена до исправленной версии. Проверка известных уязвимостей npm/OSV на момент подготовки выпуска не дала совпадений после обновления.

**Ограничения:** EXE без цифровой подписи; чистая Windows и длительная работа с реальными рукописями не проверены. Проекты и копии не зашифрованы; автоматические копии находятся на том же диске и не очищаются сами. Храните отдельную копию важных книг на другом носителе. Полные результаты и пределы проверки — [QA_RESULTS.md](https://github.com/AzhgulovRasul/StoryLens/blob/main/QA_RESULTS.md).

Исходники — **MIT**. Сверьте скачанный ZIP с `SHA256SUMS.txt`.

## English

The first public **StoryLens 0.1.0 preview** for Windows 10/11 x64. The current UI is Russian.

- Continuous chapter editing, familiar formatting, search and undo/redo.
- Character/world cards, notes and copied reference files; scene planning, a simple timeline and text-only mode.
- Local autosave, previous valid JSON, complete ZIP backups and restore into a new folder.
- Local DOCX import and DOCX/PDF/EPUB/Markdown/TXT export after preparing converters. Exact Word layout is not preserved.

**Run:** download `StoryLens-0.1.0-windows-x64.zip`, extract the whole folder and run `StoryLens.exe`. For import/export, run `Prepare-converters.cmd` once with internet access; it downloads official Pandoc/Typst tools and verifies SHA-256. Conversion then works offline. Converter binaries are not redistributed in this ZIP. End users do not need Node.js or Rust. System WebView2 Runtime is required.

Validation: 9 Rust tests, 2 save-queue tests, 10 UI scenarios, production build, Clippy, five formats using actual local converters, and real Windows-window saving. DOCX expansion/output/time limits were added and the ZIP library was updated. npm/OSV known-vulnerability checks returned no matches for the final dependency versions at release preparation time.

**Limits:** unsigned executable; clean Windows and extended real-manuscript use remain untested. Projects/backups are plaintext. Automatic backups share the same disk and have no retention cleanup. Keep a separate backup of important work on another drive. See [QA results](https://github.com/AzhgulovRasul/StoryLens/blob/main/QA_RESULTS.md) for evidence and limits.

Source: **MIT**. Verify the ZIP against `SHA256SUMS.txt`.
