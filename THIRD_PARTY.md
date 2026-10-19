# Сторонние компоненты

Версии воспроизводимой сборки фиксируются в `package-lock.json` и `src-tauri/Cargo.lock`.

| Компонент | Роль | Лицензия и первичный источник |
| --- | --- | --- |
| Tauri 2 | Windows-оболочка, встроенный интерфейс и IPC | MIT / Apache-2.0, https://github.com/tauri-apps/tauri |
| Tiptap 3 / ProseMirror | Визуальный редактор и обычная отмена | MIT, https://github.com/ueberdosis/tiptap и https://github.com/ProseMirror |
| rfd | Нативный выбор файлов и папок | MIT, https://github.com/PolyMeilex/rfd |
| serde / serde_json | Формат проекта | MIT / Apache-2.0, https://github.com/serde-rs |
| uuid | Идентификаторы | MIT / Apache-2.0, https://github.com/uuid-rs/uuid |
| sha2 | Контроль целостности вложений | MIT / Apache-2.0, https://github.com/RustCrypto/hashes |
| zip | Полная копия и восстановление | MIT, https://github.com/zip-rs/zip2 |
| Pandoc 3.12.1 | DOCX, HTML, Markdown, TXT, EPUB и подготовка Typst | GPL-2.0-or-later, https://github.com/jgm/pandoc/releases/tag/3.12.1 |
| Typst 0.15.1 | Локальный PDF | Apache-2.0, https://github.com/typst/typst/releases/tag/v0.15.1 |

Исходники StoryLens распространяются по [MIT](LICENSE). Тексты лицензий прямых и транзитивных зависимостей приложения собраны в [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt), включая консервативный набор build/test-зависимостей Cargo. Пересоздание: `npm.cmd run notices`; отсутствие текста лицензии останавливает сборку. Источники резервных текстов — [licenses/third-party/README.md](licenses/third-party/README.md). Для неизменённых MPL-2.0-компонентов в уведомлениях приведены ссылки на исходники точных версий.

Pandoc и Typst — самостоятельные неизменённые EXE, запускаемые отдельными процессами. **Публичный ZIP StoryLens не содержит этих EXE.** Пользователь один раз получает их непосредственно из официальных выпусков через `Prepare-converters.cmd`. Адреса и SHA-256 зафиксированы в `scripts/get-tools.ps1`; скрипт сохраняет лицензии и уведомления в `tools/licenses`. Обычная работа после подготовки не использует сеть. Шрифты Windows не копируются в комплект приложения. WebView2 использует установленный системный Runtime.

Исходные тексты конвертеров: https://github.com/jgm/pandoc/tree/3.12.1 и https://github.com/typst/typst/tree/v0.15.1. Эти ссылки не заявляются полным комплектом соответствующих исходников всех статически включённых компонентов Pandoc. Если будущий выпуск будет включать Pandoc EXE, до распространения потребуется отдельно подготовить полное выполнение требований GPL к исходникам; текущая публичная поставка этого EXE не распространяет.

English: StoryLens is MIT licensed. Locked application dependency notices and exact source links are in `THIRD_PARTY_NOTICES.txt`. The public archive does not redistribute Pandoc or Typst binaries. Users obtain the pinned, unmodified official tools directly from upstream with the provided preparation script. Fonts and WebView2 Runtime are not redistributed.
