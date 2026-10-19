import { test, expect, type Page } from '@playwright/test';

async function prepare(page: Page) {
  await page.addInitScript(() => {
    const uid = () => crypto.randomUUID();
    const stored = JSON.parse(localStorage.getItem('fixture') || 'null');
    let book = stored || { schemaVersion: 1, id: uid(), title: 'Тестовая книга', chapters: [{ id: uid(), title: 'Глава 1', document: { type: 'doc', content: [{ type: 'paragraph' }] } }], cards: [], scenes: [], events: [], attachments: [] };
    (window as any).__saved = book;
    (window as any).__calls = [];
    const callbacks: Record<number, Function> = {};
    let callbackId = 0;
    (window as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (fn: Function) => { callbacks[++callbackId] = fn; return callbackId; },
      invoke: async (cmd: string, args: any) => {
        (window as any).__calls.push(cmd);
        if (cmd === 'plugin:event|listen' && args.event === 'tauri://close-requested') {
          (window as any).__emitClose = () => callbacks[args.handler]({ event: args.event, id: 1, payload: null });
          return 1;
        }
        if (cmd === 'create_project' || cmd === 'open_project') return { project: book, path: 'D:\\Тест\\Книга', backupFolder: 'D:\\Тест\\Копии' };
        if (cmd === 'save_project') {
          if ((window as any).__failSave) throw Error('Проверочная ошибка записи');
          book = structuredClone(args.project); (window as any).__saved = book; localStorage.setItem('fixture', JSON.stringify(book)); return null;
        }
        return null;
      },
    };
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Открыть папку книги' }).click();
  await expect(page.getByRole('textbox', { name: 'Текст главы' })).toBeVisible();
}
async function addNamed(page: Page, button: string, title: string) {
  await page.getByRole('button', { name: button, exact: true }).click();
  await page.locator('#answer').fill(title);
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
}
test('writing, format, undo, chapters, search and reopen', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await prepare(page);
  const editor = page.getByRole('textbox', { name: 'Текст главы' });
  await editor.fill('Поезд ушёл. Лида осталась у моря.');
  await editor.press('Control+a'); await page.getByRole('button', { name: 'Полужирный', exact: true }).click();
  await expect(editor.locator('strong')).toContainText('Лида');
  await editor.press('Control+z'); await expect(editor.locator('strong')).toHaveCount(0);
  await editor.press('Control+y'); await expect(editor.locator('strong')).toHaveCount(1);
  await addNamed(page, '＋ Добавить главу', 'Вторая глава');
  await editor.fill('Соль и ветер.');
  await page.locator('#chapters button').first().click(); await expect(editor).toContainText('Лида');
  await page.getByRole('button', { name: '⌕ Поиск' }).click(); await page.getByRole('searchbox').fill('ветер');
  await page.locator('[data-result]').click(); await expect(editor).toContainText('Соль и ветер');
  await page.getByRole('button', { name: 'Закрыть поиск' }).click();
  await editor.press('Control+s'); await expect(page.locator('#save-state')).toHaveText('✓ Сохранено');
  await page.reload(); await page.getByRole('button', { name: 'Открыть папку книги' }).click();
  await page.locator('#chapters button').nth(1).click(); await expect(editor).toContainText('Соль и ветер');
  expect(errors).toEqual([]);
});
test('materials, scene plan, timeline and focus retain edits', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Материалы', exact: true }).click();
  await addNamed(page, 'Добавить запись', 'Лида');
  await page.locator('#card-text').fill('Возвращается в город детства.');
  await page.getByRole('button', { name: 'Заметки', exact: true }).click();
  await addNamed(page, 'Добавить запись', 'Письмо'); await page.locator('#card-text').fill('Кто отправил второе письмо?');
  await page.getByRole('button', { name: 'План сцен', exact: true }).click();
  await page.getByRole('button', { name: '＋ Добавить сцену' }).click();
  await page.locator('#item-title').fill('Возвращение'); await page.locator('#item-text').fill('Лида на станции.');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.scene')).toContainText('Возвращение');
  await page.getByRole('button', { name: 'Хронология', exact: true }).click();
  await page.getByRole('button', { name: '＋ Добавить событие' }).click();
  await page.locator('#item-title').fill('Письмо отправлено'); await page.locator('#item-when').fill('За три дня до приезда');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.event')).toContainText('За три дня');
  await page.getByRole('button', { name: 'Только текст' }).click(); await expect(page.locator('.sidebar')).toBeHidden();
  await page.keyboard.press('Escape'); await expect(page.locator('.sidebar')).toBeVisible();
  await page.getByRole('button', { name: 'Персонажи', exact: true }).click(); await expect(page.locator('#card-text')).toHaveValue('Возвращается в город детства.');
  await page.keyboard.press('Control+s'); await expect(page.locator('#save-state')).toHaveText('✓ Сохранено');
  const saved = await page.evaluate(() => (window as any).__saved);
  expect(saved.cards).toHaveLength(2); expect(saved.scenes).toHaveLength(1); expect(saved.events).toHaveLength(1);
  await page.screenshot({ path: 'qa/output/editor-materials.png' });
});
test('save failure is visible, blocks switching and retains text', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => { (window as any).__failSave = true; });
  await page.getByRole('textbox', { name: 'Текст главы' }).fill('Не потерять этот текст.');
  await expect(page.locator('#save-state')).toContainText('Не удалось сохранить');
  await page.getByRole('button', { name: 'Книга ▾' }).click();
  await page.getByRole('button', { name: 'Открыть книгу', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Текст главы' })).toContainText('Не потерять');
  expect(await page.evaluate(() => (window as any).__calls.filter((c: string) => c === 'open_project').length)).toBe(1);
  await page.evaluate(() => { (window as any).__failSave = false; });
  await page.keyboard.press('Control+s'); await expect(page.locator('#save-state')).toHaveText('✓ Сохранено');
});

test('900px window and a large chapter stay usable', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 620 });
  await prepare(page);
  const text = 'Лида вернулась к морю. '.repeat(20000);
  const start = Date.now();
  await page.getByRole('textbox', { name: 'Текст главы' }).fill(text);
  await page.keyboard.press('Control+s');
  await expect(page.locator('#save-state')).toHaveText('✓ Сохранено');
  await page.getByRole('button', { name: 'Материалы', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'qa/output/small-window.png' });
  console.log(`400k-character chapter: edit, save fixture, open panel in ${Date.now() - start} ms`);
});

test('close flushes pending edits before destroying the window', async ({ page }) => {
  await prepare(page);
  await page.getByRole('textbox', { name: 'Текст главы' }).fill('Сохранить при закрытии');
  await page.evaluate(async () => { await (window as any).__emitClose(); });
  const calls: string[] = await page.evaluate(() => (window as any).__calls);
  expect(calls.at(-1)).toBe('plugin:window|destroy');
  expect(calls.lastIndexOf('save_project')).toBeLessThan(calls.lastIndexOf('plugin:window|destroy'));
  expect(await page.evaluate(() => JSON.stringify((window as any).__saved))).toContain('Сохранить при закрытии');
});

test('failed save can cancel close and keep the editor usable', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => { (window as any).__failSave = true; });
  await page.getByRole('textbox', { name: 'Текст главы' }).fill('Сохранить позже');
  await page.evaluate(() => { void (window as any).__emitClose(); });
  await expect(page.getByRole('heading', { name: 'Изменения не сохранены' })).toBeVisible();
  await page.getByRole('button', { name: 'Вернуться', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Текст главы' })).toBeEditable();
  expect(await page.evaluate(() => (window as any).__calls.includes('plugin:window|destroy'))).toBe(false);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`format dropdowns have readable options in ${scheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await prepare(page);
    for (const selector of ['#align', '#style']) {
      const colors = await page.locator(`${selector} option`).evaluateAll(options => options.map(option => {
        const css = getComputedStyle(option);
        return { color: css.color, background: css.backgroundColor };
      }));
      for (const colorset of colors) {
        expect(colorset).toEqual(scheme === 'dark'
          ? { color: 'rgb(226, 233, 242)', background: 'rgb(36, 43, 52)' }
          : { color: 'rgb(41, 52, 71)', background: 'rgb(255, 255, 255)' });
      }
    }
    const editor = page.getByRole('textbox', { name: 'Текст главы' });
    await editor.fill('Выравнивание работает.');
    await page.getByLabel('Выравнивание', { exact: true }).selectOption('center');
    await expect(editor.locator('p')).toHaveCSS('text-align', 'center');
  });
}

test('quotes preserve formatted selection and undo as one action', async ({ page }) => {
  await prepare(page);
  const editor = page.getByRole('textbox', { name: 'Текст главы' });
  await editor.fill('Лида у моря'); await editor.press('Control+a');
  await page.getByRole('button', { name: 'Полужирный', exact: true }).click();
  await page.getByRole('button', { name: 'Кавычки', exact: true }).click();
  await expect(editor).toHaveText('«Лида у моря»');
  await expect(editor.locator('strong')).toContainText('Лида у моря');
  await editor.press('Control+z');
  await expect(editor).toHaveText('Лида у моря');
  await expect(editor.locator('strong')).toContainText('Лида у моря');
  await editor.press('Control+y'); await expect(editor).toHaveText('«Лида у моря»');
  await editor.press('Control+s'); await expect(page.locator('#save-state')).toHaveText('✓ Сохранено');
  await page.reload(); await page.getByRole('button', { name: 'Открыть папку книги' }).click();
  await expect(editor).toHaveText('«Лида у моря»');
});

test('quotes insert a pair with the caret inside when nothing is selected', async ({ page }) => {
  await prepare(page);
  const editor = page.getByRole('textbox', { name: 'Текст главы' });
  await editor.click();
  await page.getByRole('button', { name: 'Кавычки', exact: true }).click();
  await expect(editor).toHaveText('«»');
  await page.keyboard.insertText('слово');
  await expect(editor).toHaveText('«слово»');
});
