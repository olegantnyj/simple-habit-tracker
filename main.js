'use strict';

const {
  Plugin,
  ItemView,
  Modal,
  Menu,
  Notice,
  MarkdownRenderChild,
} = require('obsidian');

const VIEW_TYPE = 'simple-habit-tracker-view';
const DAYS_SHOWN = 7;

/* ---------- даты (локальное время, формат YYYY-MM-DD) ---------- */

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmt(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function shortDate(d) {
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1);
}

function weekday(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

/* ---------- модальные окна ---------- */

class TextModal extends Modal {
  constructor(app, opts, onSubmit) {
    super(app);
    this.opts = opts;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: this.opts.title });

    const input = contentEl.createEl('input', { type: 'text' });
    input.addClass('ht-modal-input');
    input.placeholder = this.opts.placeholder || '';
    input.value = this.opts.value || '';

    const submit = () => {
      const value = input.value.trim();
      if (!value) return;
      this.close();
      this.onSubmit(value);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });

    const btn = contentEl.createEl('button', {
      text: this.opts.cta || 'OK',
      cls: 'mod-cta ht-modal-btn',
    });
    btn.addEventListener('click', submit);

    setTimeout(() => input.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ConfirmModal extends Modal {
  constructor(app, text, onConfirm) {
    super(app);
    this.text = text;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('p', { text: this.text });

    const row = contentEl.createDiv('ht-modal-row');
    const cancel = row.createEl('button', { text: 'Отмена' });
    cancel.addEventListener('click', () => this.close());

    const ok = row.createEl('button', { text: 'Удалить', cls: 'mod-warning' });
    ok.addEventListener('click', () => {
      this.close();
      this.onConfirm();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ---------- отрисовка трекера (общая для вкладки и блока кода) ---------- */

function renderTracker(el, plugin, state, rerender) {
  el.empty();
  el.addClass('ht-root');

  const today = new Date();
  const todayStr = fmt(today);
  const end = addDays(today, state.weekOffset * DAYS_SHOWN);
  const days = [];
  for (let i = DAYS_SHOWN - 1; i >= 0; i--) days.push(addDays(end, -i));

  /* верхняя панель: навигация по неделям */
  const header = el.createDiv('ht-header');
  const prev = header.createEl('button', { text: '‹', cls: 'ht-nav' });
  prev.setAttribute('aria-label', 'Раньше');
  prev.addEventListener('click', () => {
    state.weekOffset -= 1;
    rerender();
  });

  const title =
    state.weekOffset === 0
      ? 'Последние 7 дней'
      : shortDate(days[0]) + ' – ' + shortDate(days[DAYS_SHOWN - 1]);
  header.createDiv({ cls: 'ht-title', text: title });

  const next = header.createEl('button', { text: '›', cls: 'ht-nav' });
  next.setAttribute('aria-label', 'Позже');
  if (state.weekOffset >= 0) next.disabled = true;
  next.addEventListener('click', () => {
    state.weekOffset += 1;
    rerender();
  });

  const habits = plugin.data.habits;

  /* сводка за сегодня */
  if (habits.length) {
    const doneToday = habits.filter((h) => plugin.isDone(h.id, todayStr)).length;
    el.createDiv({
      cls: 'ht-summary',
      text: 'Сегодня: ' + doneToday + ' из ' + habits.length,
    });
  }

  /* заголовок дней недели */
  if (habits.length) {
    const head = el.createDiv('ht-row ht-row-head');
    head.createDiv('ht-name');
    days.forEach((d) => {
      const c = head.createDiv('ht-daylabel');
      if (fmt(d) === todayStr) c.addClass('is-today');
      c.createDiv({ text: weekday(d) });
      c.createDiv({ cls: 'ht-daynum', text: String(d.getDate()) });
    });
  }

  /* строки привычек */
  habits.forEach((habit) => {
    const row = el.createDiv('ht-row');

    const nameCell = row.createDiv('ht-name');
    const label = nameCell.createDiv('ht-label');
    label.createSpan({ cls: 'ht-habit-name', text: habit.name });
    const streak = plugin.streak(habit.id);
    if (streak > 0) {
      label.createSpan({ cls: 'ht-streak', text: '🔥 ' + streak });
    }

    const more = nameCell.createEl('button', { text: '⋯', cls: 'ht-more' });
    more.setAttribute('aria-label', 'Действия');
    more.addEventListener('click', (evt) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle('Переименовать').setIcon('pencil').onClick(() => {
          new TextModal(
            plugin.app,
            { title: 'Переименовать привычку', value: habit.name, cta: 'Сохранить' },
            async (name) => {
              await plugin.renameHabit(habit.id, name);
            }
          ).open();
        })
      );
      menu.addItem((item) =>
        item.setTitle('Удалить').setIcon('trash').onClick(() => {
          new ConfirmModal(
            plugin.app,
            'Удалить привычку «' + habit.name + '» вместе с историей?',
            async () => {
              await plugin.deleteHabit(habit.id);
            }
          ).open();
        })
      );
      menu.showAtMouseEvent(evt);
    });

    days.forEach((d) => {
      const ds = fmt(d);
      const cell = row.createEl('button', { cls: 'ht-cell' });
      if (plugin.isDone(habit.id, ds)) {
        cell.addClass('is-done');
        cell.setText('✓');
      }
      if (ds === todayStr) cell.addClass('is-today');
      cell.setAttribute('aria-label', habit.name + ', ' + ds);
      cell.addEventListener('click', async () => {
        await plugin.toggle(habit.id, ds);
      });
    });
  });

  if (!habits.length) {
    el.createDiv({
      cls: 'ht-empty',
      text: 'Пока нет привычек. Добавьте первую ниже.',
    });
  }

  /* форма добавления */
  const form = el.createDiv('ht-add');
  const input = form.createEl('input', { type: 'text' });
  input.placeholder = 'Новая привычка';
  const add = form.createEl('button', { text: 'Добавить', cls: 'mod-cta' });

  const submit = async () => {
    const name = input.value.trim();
    if (!name) return;
    await plugin.addHabit(name);
  };
  add.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
}

/* ---------- вкладка ---------- */

class HabitView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.state = { weekOffset: 0 };
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return 'Трекер привычек';
  }

  getIcon() {
    return 'check-circle';
  }

  async onOpen() {
    this.contentEl.addClass('ht-view');
    this.render = () =>
      renderTracker(this.contentEl, this.plugin, this.state, this.render);
    this.plugin.renderers.add(this.render);
    this.render();
  }

  async onClose() {
    this.plugin.renderers.delete(this.render);
  }
}

/* ---------- плагин ---------- */

module.exports = class SimpleHabitTracker extends Plugin {
  async onload() {
    const saved = (await this.loadData()) || {};
    this.data = {
      habits: Array.isArray(saved.habits) ? saved.habits : [],
      log: saved.log && typeof saved.log === 'object' ? saved.log : {},
    };
    this.renderers = new Set();

    this.registerView(VIEW_TYPE, (leaf) => new HabitView(leaf, this));

    this.addRibbonIcon('check-circle', 'Трекер привычек', () => {
      this.activateView();
    });

    this.addCommand({
      id: 'open-habit-tracker',
      name: 'Открыть трекер привычек',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'add-habit',
      name: 'Добавить привычку',
      callback: () => {
        new TextModal(
          this.app,
          { title: 'Новая привычка', placeholder: 'Например: Зарядка', cta: 'Добавить' },
          (name) => this.addHabit(name)
        ).open();
      },
    });

    /* трекер внутри заметки: блок кода ```habits ``` */
    this.registerMarkdownCodeBlockProcessor('habits', (source, el, ctx) => {
      const state = { weekOffset: 0 };
      const render = () => renderTracker(el, this, state, render);
      const child = new MarkdownRenderChild(el);
      child.onunload = () => this.renderers.delete(render);
      ctx.addChild(child);
      this.renderers.add(render);
      render();
    });
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  /* --- данные --- */

  isDone(id, date) {
    const log = this.data.log[id];
    return !!(log && log[date]);
  }

  streak(id) {
    const log = this.data.log[id] || {};
    let d = new Date();
    if (!log[fmt(d)]) d = addDays(d, -1);
    let n = 0;
    while (log[fmt(d)]) {
      n++;
      d = addDays(d, -1);
    }
    return n;
  }

  async toggle(id, date) {
    if (!this.data.log[id]) this.data.log[id] = {};
    if (this.data.log[id][date]) delete this.data.log[id][date];
    else this.data.log[id][date] = true;
    await this.commit();
  }

  async addHabit(name) {
    const id = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.data.habits.push({ id, name });
    await this.commit();
  }

  async renameHabit(id, name) {
    const habit = this.data.habits.find((h) => h.id === id);
    if (!habit) return;
    habit.name = name;
    await this.commit();
  }

  async deleteHabit(id) {
    this.data.habits = this.data.habits.filter((h) => h.id !== id);
    delete this.data.log[id];
    await this.commit();
    new Notice('Привычка удалена');
  }

  async commit() {
    await this.saveData(this.data);
    this.renderers.forEach((render) => render());
  }
};
