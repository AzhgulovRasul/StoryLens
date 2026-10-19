import { Editor, type JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { SaveQueue } from './save-queue.js';
import './style.css';

type Chapter = { id: string; title: string; document: JSONContent };
type Card = { id: string; kind: string; title: string; text: string };
type Scene = { id: string; chapterId: string | null; title: string; text: string };
type StoryEvent = { id: string; when: string; title: string; text: string };
type Attachment = { id: string; name: string; path: string; sha256: string };
type Project = { schemaVersion: number; id: string; title: string; chapters: Chapter[]; cards: Card[]; scenes: Scene[]; events: StoryEvent[]; attachments: Attachment[] };
type Opened = { project: Project; path: string; backupFolder: string };
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const id = () => crypto.randomUUID();
const emptyDoc = (): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph' }] });
const extensions = () => [StarterKit.configure({ link: false, heading: { levels: [1, 2, 3] } }), TextAlign.configure({ types: ['heading', 'paragraph'] })];
let project: Project | null = null, path = '', backupFolder = '', chapterId = '', view = 'text', kind = 'character', cardId = '';
let materials = false, focus = false, busy = false;
const editors = new Map<string, Editor>();
let timer: ReturnType<typeof setTimeout>;
let queue: SaveQueue;
let saveError = '', backupWarning = '';

$('#app').innerHTML = `
<div id="work">
<header class="masthead"><span class="brand"><span aria-hidden="true" class="brand-icon">▤</span>StoryLens</span><button id="book-name" class="book-name" title="Переименовать книгу">Новая история</button><span class="spacer"></span><span id="save-state" role="status" aria-live="polite"></span><button id="focus" aria-pressed="false">⤢ <span>Только текст</span></button><button id="file" aria-haspopup="dialog">Книга ▾</button></header>
<nav class="view-nav" aria-label="Разделы книги"><button data-view="text" aria-pressed="true">Текст</button><button data-view="plan" aria-pressed="false">План сцен</button><button data-view="timeline" aria-pressed="false">Хронология</button><span class="spacer"></span><button id="search-button" title="Поиск по книге (Ctrl+F)">⌕ Поиск</button><button id="materials-button" aria-pressed="false">Материалы</button></nav>
<div class="ribbon" role="toolbar" aria-label="Оформление текста"><select id="style" aria-label="Стиль абзаца"><option value="0">Основной текст</option><option value="1">Заголовок 1</option><option value="2">Заголовок 2</option><option value="3">Заголовок 3</option></select><span class="rule"></span><button data-format="bold" title="Полужирный (Ctrl+B)" aria-label="Полужирный"><b>Ж</b></button><button data-format="italic" title="Курсив (Ctrl+I)" aria-label="Курсив"><i>К</i></button><button data-format="underline" title="Подчёркнутый (Ctrl+U)" aria-label="Подчёркнутый"><u>Ч</u></button><span class="rule"></span><button data-format="bulletList" title="Маркированный список" aria-label="Маркированный список">☷</button><button data-format="orderedList" title="Нумерованный список" aria-label="Нумерованный список">1.</button><button data-format="blockquote" title="Цитата" aria-label="Цитата">“ ”</button><button id="quotes" title="Обрамить выделение кавычками «ёлочками»" aria-label="Кавычки">« »</button><select id="align" aria-label="Выравнивание"><option value="left">По левому краю</option><option value="center">По центру</option><option value="right">По правому краю</option><option value="justify">По ширине</option></select><span class="spacer"></span><button id="undo" aria-label="Отменить" title="Отменить (Ctrl+Z)">↶</button><button id="redo" aria-label="Повторить" title="Повторить (Ctrl+Y)">↷</button></div>
<div id="search-pane" hidden><div class="search-controls"><input id="query" type="search" aria-label="Найти в книге" placeholder="Найти в тексте, карточках, плане…"><button id="search-close" aria-label="Закрыть поиск">✕</button></div><div id="results" aria-live="polite"></div></div>
<div class="layout"><aside class="sidebar" aria-label="Главы книги"><p class="section-label">Главы книги</p><nav id="chapters" aria-label="Выбрать главу"></nav><button id="add-chapter" class="add-chapter">＋ Добавить главу</button><p class="side-note">Пишите в своём ритме.<br>Всё остаётся на компьютере.</p></aside><main class="main"><div class="chapter-tools"><span id="chapter-context"></span><span class="spacer"></span><button id="chapter-menu" aria-label="Действия с главой">Действия с главой ▾</button></div><div id="text-pane" class="pane"><article class="document"><p id="chapter-number" class="eyebrow"></p><input id="chapter-title" class="chapter-title" aria-label="Название главы" placeholder="Название главы"><div id="editor-host"></div></article></div><div id="plan-pane" class="pane" hidden></div><div id="timeline-pane" class="pane" hidden></div></main><aside id="materials" class="materials" aria-label="Материалы книги" hidden></aside></div>
<footer><span id="context"></span><span id="counts"></span><span>Локально · без аккаунта</span></footer>
</div>
<section id="welcome" class="welcome"><div class="welcome-card"><p class="eyebrow">ВАША ИСТОРИЯ НАЧИНАЕТСЯ ЗДЕСЬ</p><h1>Место для книги.<br>И всего, что за ней.</h1><p>Текст, заметки и замыслы — рядом.<br>Книги хранятся в папках на вашем компьютере.</p><div class="welcome-actions"><button class="primary" id="new-welcome">Создать книгу</button><button id="open-welcome">Открыть папку книги</button></div><button id="restore-welcome">Восстановить из копии</button><button id="previous-welcome" class="subtle">Из предыдущей записи</button><small>StoryLens · первая рабочая версия</small></div></section>
<dialog id="dialog"><form id="dialog-form"><div id="dialog-content"></div><div id="dialog-actions" class="dialog-actions"></div></form></dialog>
<div id="notice" role="status" hidden></div><div id="busy" role="status" hidden><span>Работаем локально…</span></div>`;

const btn = (label: string, action: string, cls = '') => `<button type="button" data-action="${action}" class="${cls}">${label}</button>`;
function message(text: string, error = false) {
  const el = $('#notice'); el.textContent = text; el.classList.toggle('error', error); el.hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => el.hidden = true, error ? 18000 : 8000);
}
let noticeTimer: ReturnType<typeof setTimeout>;
function dialog(content: string, actions: { label: string; value: string; primary?: boolean }[]): Promise<string | null> {
  const d = $<HTMLDialogElement>('#dialog');
  $('#dialog-content').innerHTML = content;
  $('#dialog-actions').innerHTML = actions.map(a => `<button type="button" data-value="${a.value}" class="${a.primary ? 'primary' : ''}">${esc(a.label)}</button>`).join('');
  return new Promise(resolve => {
    const done = (value: string | null) => { d.close(); d.removeEventListener('cancel', cancel); $('#dialog-actions').onclick = null; $('#dialog-form').onsubmit = null; resolve(value); };
    const cancel = (e: Event) => { e.preventDefault(); done(null); };
    d.addEventListener('cancel', cancel);
    $('#dialog-actions').onclick = e => { const target = (e.target as Element).closest<HTMLButtonElement>('button[data-value]'); if (target) done(target.dataset.value!); };
    $('#dialog-form').onsubmit = e => { e.preventDefault(); done(actions.find(a => a.primary)?.value ?? actions[0].value); };
    d.showModal();
  });
}
async function ask(title: string, label: string, value = ''): Promise<string | null> {
  const result = await dialog(`<h2>${esc(title)}</h2><label>${esc(label)}<input id="answer" value="${esc(value)}" maxlength="200" autofocus required></label>`, [{ label: 'Отмена', value: 'cancel' }, { label: 'Продолжить', value: 'ok', primary: true }]);
  return result === 'ok' ? $<HTMLInputElement>('#answer').value.trim() || null : null;
}
async function operation(action: () => Promise<void>) {
  if (busy) return;
  busy = true; $('#work').inert = true; $('#welcome').inert = true; $('#busy').hidden = false;
  try { await action(); } catch (e) { message(String(e), true); }
  finally { busy = false; $('#work').inert = false; $('#welcome').inert = false; $('#busy').hidden = true; }
}
function status(state: string) {
  const el = $('#save-state');
  el.textContent = ({ dirty: 'Есть изменения', saving: 'Сохраняем…', saved: '✓ Сохранено', error: '⚠ Не удалось сохранить' } as Record<string, string>)[state];
  el.classList.toggle('save-error', state === 'error');
  el.title = state === 'error' ? saveError : backupWarning || path;
}
function changed() {
  queue.mark(); clearTimeout(timer);
  timer = setTimeout(() => void flush().catch(() => {}), 650);
  counts();
}
async function flush() { clearTimeout(timer); if (queue) await queue.flush(); }
function load(opened: Opened) {
  editors.forEach(e => e.destroy()); editors.clear(); $('#editor-host').replaceChildren();
  project = opened.project; path = opened.path; backupFolder = opened.backupFolder;
  chapterId = project.chapters[0].id; view = 'text'; cardId = ''; saveError = ''; backupWarning = '';
  queue = new SaveQueue(() => project!, async (snapshot: Project) => {
    try { backupWarning = await invoke<string | null>('save_project', { project: snapshot }) ?? ''; saveError = ''; if (backupWarning) message(backupWarning, true); }
    catch (e) { saveError = String(e); message(saveError, true); throw e; }
  }, status);
  $('#welcome').hidden = true; $('#work').hidden = false;
  $('#book-name').textContent = project.title; $('#book-name').title = path + '\nПереименовать книгу';
  queue.mark(); void flush().catch(() => {});
  render();
  void getCurrentWindow().setTitle(`${project.title} — StoryLens`).catch(() => {});
}
function currentChapter() { return project!.chapters.find(c => c.id === chapterId)!; }
function currentEditor() { return editors.get(chapterId); }
function render() {
  if (!project) return;
  $('#work').classList.toggle('focus-mode', focus); $('#work').classList.toggle('materials-on', materials);
  $('#focus').setAttribute('aria-pressed', String(focus));
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  $('#materials-button').setAttribute('aria-pressed', String(materials));
  $('#materials').hidden = !materials;
  $('#text-pane').hidden = view !== 'text'; $('#plan-pane').hidden = view !== 'plan'; $('#timeline-pane').hidden = view !== 'timeline';
  $('.ribbon').hidden = view !== 'text'; $('.chapter-tools').hidden = view !== 'text';
  $('#chapters').innerHTML = project.chapters.map((c, i) => `<button data-chapter="${c.id}" aria-pressed="${c.id === chapterId}"><span class="chapter-index">${String(i + 1).padStart(2, '0')}</span><span>${esc(c.title || 'Без названия')}</span></button>`).join('');
  $('#chapter-context').textContent = `${project.title} › ${currentChapter().title}`;
  $('#chapter-number').textContent = `ГЛАВА ${project.chapters.findIndex(c => c.id === chapterId) + 1}`;
  $<HTMLInputElement>('#chapter-title').value = currentChapter().title;
  if (view === 'text') mountEditor();
  if (view === 'plan') renderPlan(); if (view === 'timeline') renderTimeline();
  if (materials) renderMaterials(); counts();
}
function mountEditor() {
  $('#editor-host').childNodes.forEach(node => { (node as HTMLElement).hidden = true; });
  let editor = currentEditor();
  if (!editor) {
    const element = document.createElement('div'); element.dataset.editor = chapterId; $('#editor-host').append(element);
    const cid = chapterId;
    editor = new Editor({ element, extensions: extensions(), content: currentChapter().document, editorProps: { attributes: { 'aria-label': 'Текст главы', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' } },
      onUpdate: ({ editor }) => { project!.chapters.find(c => c.id === cid)!.document = editor.getJSON(); changed(); },
      onSelectionUpdate: updateFormat, onTransaction: updateFormat });
    editors.set(cid, editor);
  }
  $<HTMLElement>(`[data-editor="${chapterId}"]`).hidden = false; updateFormat();
}
function updateFormat() {
  const editor = currentEditor(); if (!editor) return;
  document.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(b => b.setAttribute('aria-pressed', String(editor.isActive(b.dataset.format!))));
  $<HTMLSelectElement>('#style').value = String(editor.isActive('heading') ? editor.getAttributes('heading').level : 0);
  $<HTMLSelectElement>('#align').value = editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph').textAlign || 'left';
  $<HTMLButtonElement>('#undo').disabled = !editor.can().undo(); $<HTMLButtonElement>('#redo').disabled = !editor.can().redo();
}
function docText(doc: JSONContent): string { return doc.text ?? (doc.content ?? []).map(docText).join(['doc', 'paragraph', 'heading'].includes(doc.type ?? '') ? ' ' : ''); }
function counts() {
  if (!project) return;
  const words = project.chapters.map(c => docText(c.document)).join(' ').match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  $('#counts').textContent = `${words.toLocaleString('ru-RU')} слов в книге`;
  $('#context').textContent = `${view === 'text' ? `Глава ${project.chapters.findIndex(c => c.id === chapterId) + 1} из ${project.chapters.length}` : view === 'plan' ? `${project.scenes.length} сцен` : `${project.events.length} событий`}`;
}
function renderMaterials() {
  const cards = project!.cards.filter(c => c.kind === kind);
  if (!cards.some(c => c.id === cardId)) cardId = cards[0]?.id ?? '';
  const card = cards.find(c => c.id === cardId);
  const labels: Record<string, string> = { character: 'Персонажи', world: 'Мир', note: 'Заметки', files: 'Файлы' };
  $('#materials').innerHTML = `<div class="panel-head"><strong>Материалы</strong>${btn('✕','close-materials')}</div><nav class="material-nav" aria-label="Тип материалов">${Object.entries(labels).map(([k, label]) => `<button data-kind="${k}" aria-pressed="${k === kind}">${label}</button>`).join('')}</nav>` + (kind === 'files' ?
    `${btn('＋ Добавить файл','add-file')}<p class="hint">Файл копируется в книгу. Оригинал остаётся на месте.</p><div class="file-list">${project!.attachments.map(a => `<button data-extract="${a.id}" title="Сохранить копию файла">▧ ${esc(a.name)}</button>`).join('') || '<p class="hint">Здесь появятся добавленные файлы и исходники DOCX.</p>'}</div>` :
    `<div class="card-picker"><select id="card-picker" aria-label="Выбрать материал">${cards.map(c => `<option value="${c.id}" ${c.id === cardId ? 'selected' : ''}>${esc(c.title || 'Без названия')}</option>`).join('')}</select>${btn('＋','add-card')}</div>${card ? `<label class="field-label">Название<input id="card-title" value="${esc(card.title)}" maxlength="200"></label><label class="field-label">${kind === 'note' ? 'Заметка' : 'Описание'}<textarea id="card-text" rows="14" placeholder="Только то, что нужно вашей истории…">${esc(card.text)}</textarea></label>${btn('Удалить материал','delete-card','subtle')}` : '<div class="empty"><span class="empty-icon">✎</span><p>Дайте место замыслам.</p><p class="hint">Добавьте запись — свободный текст без обязательных анкет.</p>' + btn('Добавить запись','add-card') + '</div>'}`);
  const picker = $<HTMLSelectElement>('#card-picker'); if (picker) picker.onchange = () => { cardId = picker.value; renderMaterials(); };
  const title = $<HTMLInputElement>('#card-title'); if (title) title.oninput = () => { card!.title = title.value; const option = document.querySelector<HTMLOptionElement>(`#card-picker option[value="${cardId}"]`); if (option) option.textContent = title.value || 'Без названия'; changed(); };
  const text = $<HTMLTextAreaElement>('#card-text'); if (text) text.oninput = () => { card!.text = text.value; changed(); };
}
function renderPlan() {
  $('#plan-pane').innerHTML = `<div class="page-head"><div><p class="eyebrow">ПОРЯДОК ИСТОРИИ В КНИГЕ</p><h1>План сцен</h1><p class="hint">От первого замысла до последней сцены.</p></div>${btn('＋ Добавить сцену','add-scene','primary')}</div><div class="scene-list">${project!.scenes.map((s, i) => `<article class="scene"><span class="order">${i + 1}</span><div><button class="item-title" data-edit-scene="${s.id}">${esc(s.title || 'Без названия')}</button><p>${esc(s.text)}</p><small>${esc(project!.chapters.find(c => c.id === s.chapterId)?.title || 'Без главы · замысел')}</small><div class="item-actions"><button data-move-scene="${s.id}" data-step="-1" ${i === 0 ? 'disabled' : ''} aria-label="Переместить сцену вверх">↑</button><button data-move-scene="${s.id}" data-step="1" ${i === project!.scenes.length - 1 ? 'disabled' : ''} aria-label="Переместить сцену вниз">↓</button><button data-edit-scene="${s.id}">Изменить</button><button data-delete-scene="${s.id}">Удалить</button></div></div></article>`).join('') || '<div class="empty"><p>История может начаться с одной сцены.</p><p class="hint">Запишите, что произойдёт. Текст можно написать позже.</p></div>'}</div>`;
}
function renderTimeline() {
  $('#timeline-pane').innerHTML = `<div class="page-head"><div><p class="eyebrow">ВРЕМЯ ВНУТРИ ВАШЕГО МИРА</p><h1>Хронология</h1><p class="hint">События идут в вашем порядке, независимо от глав.</p></div>${btn('＋ Добавить событие','add-event','primary')}</div><div class="event-list">${project!.events.map((e, i) => `<article class="event"><time>${esc(e.when || 'Без даты')}</time><div class="event-body"><button class="item-title" data-edit-event="${e.id}">${esc(e.title || 'Без названия')}</button><p>${esc(e.text)}</p><div class="item-actions"><button data-move-event="${e.id}" data-step="-1" ${i === 0 ? 'disabled' : ''} aria-label="Переместить событие вверх">↑</button><button data-move-event="${e.id}" data-step="1" ${i === project!.events.length - 1 ? 'disabled' : ''} aria-label="Переместить событие вниз">↓</button><button data-edit-event="${e.id}">Изменить</button><button data-delete-event="${e.id}">Удалить</button></div></div></article>`).join('') || '<div class="empty"><p>Что было раньше, а что — потом?</p><p class="hint">Даты могут быть любыми: «Десять лет назад», «День 2», «Утро».</p></div>'}</div>`;
}
async function editItem(type: 'scene' | 'event', itemId?: string) {
  const isScene = type === 'scene';
  const existing = isScene ? project!.scenes.find(s => s.id === itemId) : project!.events.find(e => e.id === itemId);
  const answer = await dialog(`<h2>${existing ? 'Изменить' : 'Добавить'} ${isScene ? 'сцену' : 'событие'}</h2><label>Название<input id="item-title" value="${esc(existing?.title ?? '')}" maxlength="200" autofocus></label>${isScene ? `<label>Глава<select id="item-chapter"><option value="">Без главы · замысел</option>${project!.chapters.map(c => `<option value="${c.id}" ${(existing as Scene)?.chapterId === c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></label>` : `<label>Когда<input id="item-when" value="${esc((existing as StoryEvent)?.when ?? '')}" placeholder="Например: День 2 · утро" maxlength="200"></label>`}<label>Краткое описание<textarea id="item-text" rows="5">${esc(existing?.text ?? '')}</textarea></label>`, [{ label: 'Отмена', value: 'cancel' }, { label: 'Сохранить', value: 'save', primary: true }]);
  if (answer !== 'save') return;
  const common = { id: existing?.id ?? id(), title: $<HTMLInputElement>('#item-title').value.trim() || 'Без названия', text: $<HTMLTextAreaElement>('#item-text').value };
  if (isScene) { const value = { ...common, chapterId: $<HTMLSelectElement>('#item-chapter').value || null }; if (existing) Object.assign(existing, value); else project!.scenes.push(value); }
  else { const value = { ...common, when: $<HTMLInputElement>('#item-when').value }; if (existing) Object.assign(existing, value); else project!.events.push(value); }
  changed(); render();
}
async function confirmDelete(what: string): Promise<boolean> {
  return await dialog(`<h2>Удалить ${esc(what)}?</h2><p>Это действие нельзя отменить обычной отменой текста. Локальные резервные копии сохраняются.</p>`, [{ label: 'Оставить', value: 'cancel', primary: true }, { label: 'Удалить', value: 'delete' }]) === 'delete';
}
async function create() {
  const title = await ask('Новая книга', 'Название книги'); if (!title) return;
  await operation(async () => { await flush(); const opened = await invoke<Opened | null>('create_project', { title }); if (opened) load(opened); });
}
async function open() { await operation(async () => { await flush(); const opened = await invoke<Opened | null>('open_project'); if (opened) load(opened); }); }
async function restore(previous = false) {
  const title = await ask('Восстановление книги', 'Имя новой папки для восстановленной книги', 'Восстановленная книга'); if (!title) return;
  await operation(async () => { await flush(); const opened = await invoke<Opened | null>('restore_project', { title, previous }); if (opened) { load(opened); message('Книга восстановлена в новую папку.'); } });
}
async function fileMenu() {
  const choice = await dialog(`<h2>Книга</h2><p class="hint">${esc(path)}</p><div class="menu-grid">${btn('Создать книгу','menu-new')}${btn('Открыть книгу','menu-open')}${btn('Импорт DOCX','menu-import')}${btn('Экспорт','menu-export')}${btn('Резервные копии','menu-backups')}${btn('Сохранить сейчас · Ctrl+S','menu-save')}</div>`, [{ label: 'Вернуться к тексту', value: 'cancel', primary: true }]);
  void choice;
}
function dismissDialog() { $<HTMLDialogElement>('#dialog').dispatchEvent(new Event('cancel', { cancelable: true })); }
async function backupsMenu() {
  const answer = await dialog(`<h2>Резервные копии</h2><p>При первом сохранении и затем каждые 5 минут активной работы создаётся полная копия книги с файлами. Копии хранятся отдельно от папки книги:</p><p class="path">${esc(backupFolder)}</p><p>Для защиты от поломки диска сохраните копию на другой носитель. Восстановление создаёт новую папку.</p>`, [{ label: 'Закрыть', value: 'cancel' }, { label: 'Восстановить ZIP', value: 'restore' }, { label: 'Предыдущая запись', value: 'previous' }, { label: 'Создать копию', value: 'backup', primary: true }]);
  if (answer === 'restore') await restore();
  if (answer === 'previous') await restore(true);
  if (answer === 'backup') await operation(async () => {
    const result = await invoke<string | null>('backup_project', { project });
    if (result) message(`Копия сохранена: ${result}`);
  });
}
async function exportMenu() {
  const answer = await dialog(`<h2>Экспорт книги</h2><p>Экспортируется вся рукопись в порядке глав. Заметки, карточки и файлы остаются в проекте и резервной копии.</p><label>Формат<select id="export-format"><option value="docx">Word · DOCX</option><option value="pdf">PDF</option><option value="epub">Электронная книга · EPUB</option><option value="md">Markdown</option><option value="txt">Обычный текст · TXT</option></select></label><p class="hint">TXT не сохраняет оформление. Markdown не сохраняет выравнивание и часть оформления. Результат DOCX, PDF и EPUB проверьте перед отправкой.</p>`, [{ label: 'Отмена', value: 'cancel' }, { label: 'Экспортировать', value: 'export', primary: true }]);
  if (answer !== 'export') return;
  const format = $<HTMLSelectElement>('#export-format').value;
  await operation(async () => { await flush(); const result = await invoke<string | null>('export_project', { project, format }); if (result) message(`Файл сохранён: ${result}`); });
}
async function importDocx() {
  await operation(async () => {
    await flush();
    const imported = await invoke<{ html: string; attachment: Attachment; warnings: string[] } | null>('import_docx');
    if (!imported) return;
    const dom = new DOMParser().parseFromString(imported.html, 'text/html');
    dom.querySelectorAll('script,style,iframe,object').forEach(el => el.remove());
    dom.querySelectorAll('table').forEach(table => {
      const block = document.createElement('div');
      table.querySelectorAll('tr').forEach(row => { const p = document.createElement('p'); p.textContent = [...row.querySelectorAll('th,td')].map(c => c.textContent).join(' | '); block.append(p); }); table.replaceWith(block);
    });
    dom.querySelectorAll('img').forEach(img => img.replaceWith(document.createTextNode(img.alt ? `[${img.alt}]` : '[Изображение — см. исходный DOCX]')));
    const temp = new Editor({ extensions: extensions(), content: dom.body.innerHTML });
    const c = { id: id(), title: imported.attachment.name.replace(/\.docx$/i, ''), document: temp.getJSON() }; temp.destroy();
    project!.chapters.push(c); project!.attachments.push(imported.attachment); chapterId = c.id; view = 'text'; changed(); render(); await flush();
    // Show the conversion report after leaving the busy state.
    setTimeout(() => { void dialog(`<h2>Глава импортирована</h2>${imported.warnings.map(w => `<p>${esc(w)}</p>`).join('')}`, [{ label: 'Проверить текст', value: 'ok', primary: true }]); }, 0);
  });
}
function search() {
  if (!project) return;
  const needle = $<HTMLInputElement>('#query').value.trim().toLocaleLowerCase('ru');
  if (!needle) { $('#results').innerHTML = '<p class="hint">Поиск по всей книге и материалам.</p>'; return; }
  const items = [
    ...project.chapters.map(c => ({ id: c.id, type: 'chapter', title: c.title, text: docText(c.document), category: 'Глава' })),
    ...project.cards.map(c => ({ ...c, type: 'card', category: c.kind === 'note' ? 'Заметка' : c.kind === 'world' ? 'Мир' : 'Персонаж' })),
    ...project.scenes.map(c => ({ ...c, type: 'scene', category: 'Сцена' })),
    ...project.events.map(c => ({ ...c, text: `${c.when} ${c.text}`, type: 'event', category: 'Событие' })),
  ].filter(c => `${c.title} ${c.text}`.toLocaleLowerCase('ru').includes(needle));
  $('#results').innerHTML = items.slice(0, 100).map(c => { const pos = Math.max(0, c.text.toLocaleLowerCase('ru').indexOf(needle) - 35); return `<button data-result="${c.id}" data-result-type="${c.type}"><small>${c.category}</small><strong>${esc(c.title)}</strong><span>${esc(c.text.slice(pos, pos + 160))}</span></button>`; }).join('') || '<p class="hint">Совпадений нет.</p>';
  if (items.length > 100) $('#results').insertAdjacentHTML('beforeend', '<p class="hint">Показаны первые 100 результатов. Уточните запрос.</p>');
}

$('#new-welcome').onclick = () => void create(); $('#open-welcome').onclick = () => void open(); $('#restore-welcome').onclick = () => void restore();
$('#previous-welcome').onclick = () => void restore(true);
$('#file').onclick = () => void fileMenu();
$('#focus').onclick = () => { focus = !focus; view = 'text'; render(); };
$('#materials-button').onclick = () => { materials = !materials; render(); };
$('#book-name').onclick = async () => { if (!project) return; const title = await ask('Название книги', 'Название', project.title); if (title) { project.title = title; $('#book-name').textContent = title; changed(); void getCurrentWindow().setTitle(`${title} — StoryLens`).catch(() => {}); } };
$('#chapter-title').oninput = () => { currentChapter().title = $<HTMLInputElement>('#chapter-title').value; const b = document.querySelector(`[data-chapter="${chapterId}"] span:last-child`); if (b) b.textContent = currentChapter().title || 'Без названия'; changed(); };
$('#add-chapter').onclick = async () => { const title = await ask('Новая глава', 'Название главы', `Глава ${project!.chapters.length + 1}`); if (title) { const c = { id: id(), title, document: emptyDoc() }; project!.chapters.push(c); chapterId = c.id; view = 'text'; changed(); render(); } };
$('#chapter-menu').onclick = async () => {
  const i = project!.chapters.findIndex(c => c.id === chapterId);
  const answer = await dialog(`<h2>${esc(currentChapter().title)}</h2><p>Порядок глав определяет порядок текста при экспорте.</p>`, [{ label: 'Закрыть', value: 'cancel', primary: true }, ...(i > 0 ? [{ label: 'Выше', value: 'up' }] : []), ...(i < project!.chapters.length - 1 ? [{ label: 'Ниже', value: 'down' }] : []), ...(project!.chapters.length > 1 ? [{ label: 'Удалить главу', value: 'delete' }] : [])]);
  if (answer === 'up' || answer === 'down') { const j = i + (answer === 'up' ? -1 : 1); [project!.chapters[i], project!.chapters[j]] = [project!.chapters[j], project!.chapters[i]]; changed(); render(); }
  if (answer === 'delete' && await confirmDelete('главу вместе с её текстом')) { const removed = chapterId; editors.get(removed)?.destroy(); editors.delete(removed); document.querySelector(`[data-editor="${removed}"]`)?.remove(); project!.chapters.splice(i, 1); project!.scenes.forEach(s => { if (s.chapterId === removed) s.chapterId = null; }); chapterId = project!.chapters[Math.min(i, project!.chapters.length - 1)].id; changed(); render(); }
};
$('.ribbon').onmousedown = e => { if ((e.target as Element).closest('button')) e.preventDefault(); };
$('#style').onchange = () => { const level = Number($<HTMLSelectElement>('#style').value); const chain = currentEditor()!.chain().focus(); if (level === 0) chain.setParagraph().run(); else chain.setHeading({ level: level as 1 | 2 | 3 }).run(); };
$('#align').onchange = () => { currentEditor()?.chain().focus().setTextAlign($<HTMLSelectElement>('#align').value).run(); };
$('#quotes').onclick = () => {
  const editor = currentEditor(); if (!editor) return;
  const { from, to, $from, $to } = TextSelection.between(editor.state.selection.$from, editor.state.selection.$to);
  if (!$from.parent.inlineContent || !$to.parent.inlineContent) return;
  editor.chain().focus().command(({ tr }) => {
    closeHistory(tr).insertText('»', to).insertText('«', from);
    return true;
  }).setTextSelection({ from: from + 1, to: to + 1 }).run();
};
$('#undo').onclick = () => { currentEditor()?.chain().focus().undo().run(); }; $('#redo').onclick = () => { currentEditor()?.chain().focus().redo().run(); };
$('#search-button').onclick = () => { $('#search-pane').hidden = !$('#search-pane').hidden; if (!$('#search-pane').hidden) { $<HTMLInputElement>('#query').focus(); search(); } };
$('#search-close').onclick = () => $('#search-pane').hidden = true;
$('#query').oninput = search;

document.addEventListener('click', async e => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button'); if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.view) { view = d.view; render(); }
  if (d.chapter) { chapterId = d.chapter; view = 'text'; render(); }
  if (d.kind) { kind = d.kind; cardId = ''; renderMaterials(); }
  if (d.format) { const c = currentEditor()!.chain().focus(); const actions: Record<string, () => void> = { bold: () => { c.toggleBold().run(); }, italic: () => { c.toggleItalic().run(); }, underline: () => { c.toggleUnderline().run(); }, bulletList: () => { c.toggleBulletList().run(); }, orderedList: () => { c.toggleOrderedList().run(); }, blockquote: () => { c.toggleBlockquote().run(); } }; actions[d.format]?.(); }
  if (d.editScene) await editItem('scene', d.editScene); if (d.editEvent) await editItem('event', d.editEvent);
  if (d.moveScene || d.moveEvent) { const a = d.moveScene ? project!.scenes : project!.events; const index = a.findIndex(x => x.id === (d.moveScene || d.moveEvent)); const j = index + Number(d.step); if (j >= 0 && j < a.length) { [a[index], a[j]] = [a[j], a[index]]; changed(); render(); } }
  if (d.deleteScene && await confirmDelete('сцену')) { project!.scenes = project!.scenes.filter(s => s.id !== d.deleteScene); changed(); render(); }
  if (d.deleteEvent && await confirmDelete('событие')) { project!.events = project!.events.filter(s => s.id !== d.deleteEvent); changed(); render(); }
  if (d.extract) await operation(async () => { await flush(); const result = await invoke<string | null>('extract_attachment', { id: d.extract }); if (result) message(`Копия файла сохранена: ${result}`); });
  if (d.result) {
    if (d.resultType === 'chapter') { chapterId = d.result; view = 'text'; render(); const ed = currentEditor()!; const needle = $<HTMLInputElement>('#query').value.toLocaleLowerCase('ru'); let found = false; ed.state.doc.descendants((node, pos) => { if (!found && node.isText && node.text) { const at = node.text.toLocaleLowerCase('ru').indexOf(needle); if (at >= 0) { found = true; ed.commands.setTextSelection({ from: pos + at, to: pos + at + needle.length }); } } }); if (found) ed.commands.scrollIntoView(); }
    else if (d.resultType === 'card') { const card = project!.cards.find(c => c.id === d.result)!; kind = card.kind; cardId = card.id; materials = true; render(); }
    else if (d.resultType === 'scene') await editItem('scene', d.result); else await editItem('event', d.result);
  }
  switch (d.action) {
    case 'menu-new': dismissDialog(); await create(); break;
    case 'menu-open': dismissDialog(); await open(); break;
    case 'menu-import': dismissDialog(); await importDocx(); break;
    case 'menu-export': dismissDialog(); await exportMenu(); break;
    case 'menu-backups': dismissDialog(); await backupsMenu(); break;
    case 'menu-save': dismissDialog(); await operation(async () => { await flush(); message('Книга сохранена.'); }); break;
    case 'close-materials': materials = false; render(); break;
    case 'add-card': { const title = await ask('Новая запись', 'Название'); if (title) { const c = { id: id(), kind, title, text: '' }; project!.cards.push(c); cardId = c.id; changed(); renderMaterials(); } break; }
    case 'delete-card': if (await confirmDelete('материал')) { project!.cards = project!.cards.filter(c => c.id !== cardId); cardId = ''; changed(); renderMaterials(); } break;
    case 'add-file': await operation(async () => { const a = await invoke<Attachment | null>('add_attachment'); if (a) { project!.attachments.push(a); changed(); renderMaterials(); await flush(); } }); break;
    case 'add-scene': await editItem('scene'); break;
    case 'add-event': await editItem('event'); break;
  }
});
document.addEventListener('keydown', e => {
  if (!project || busy) return;
  if (e.ctrlKey && ['s', 'ы'].includes(e.key.toLowerCase())) { e.preventDefault(); void operation(flush); }
  if (e.ctrlKey && ['f', 'а'].includes(e.key.toLowerCase())) { e.preventDefault(); $('#search-pane').hidden = false; $<HTMLInputElement>('#query').focus(); search(); }
  if (e.key === 'Escape' && !$<HTMLDialogElement>('#dialog').open) { if (focus) { focus = false; render(); } $('#search-pane').hidden = true; }
});
$('#work').hidden = true;
if ('__TAURI_INTERNALS__' in window) {
  void getCurrentWindow().onCloseRequested(async event => {
    if (busy) { event.preventDefault(); message('Дождитесь завершения операции.'); return; }
    $('#work').inert = true;
    try { await flush(); }
    catch { const answer = await dialog('<h2>Изменения не сохранены</h2><p>Книга остаётся в памяти. Можно вернуться к работе и сохранить резервную копию в другую папку.</p>', [{ label: 'Вернуться', value: 'stay', primary: true }, { label: 'Закрыть без сохранения', value: 'close' }]); if (answer !== 'close') { event.preventDefault(); $('#work').inert = false; } }
  });
}
