/* =========================================================
   个人工作任务清单
   纯前端单页应用 · 数据保存在浏览器 localStorage
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */
  const STORE_KEY = 'work-tasks.v1';
  const APP_VER = 1;

  const CATS = {
    bid:       { name: '投标任务', color: '#E05A4E', bg: '#FDECEA', icon: 'i-doc' },
    presale:   { name: '售前支持', color: '#E0952E', bg: '#FDF3E4', icon: 'i-chat' },
    aftersale: { name: '售后支持', color: '#3B82C4', bg: '#EAF2FA', icon: 'i-tool' },
    other:     { name: '其他支持', color: '#7C6BD6', bg: '#F0EDFC', icon: 'i-dots' }
  };
  const CAT_KEYS = ['bid', 'presale', 'aftersale', 'other'];

  const PRIOS = {
    3: { name: '高', color: '#E05A4E', bg: '#FDECEA', bd: '#F2B9B3', fg: '#C9473C' },
    2: { name: '中', color: '#E0952E', bg: '#FDF3E4', bd: '#F0D3A6', fg: '#B6741B' },
    1: { name: '低', color: '#3B82C4', bg: '#EAF2FA', bd: '#BFD8EE', fg: '#2C6B9F' },
    0: { name: '无', color: '#B7BDC7', bg: '#F1F3F6', bd: '#E3E6EB', fg: '#6B7280' }
  };

  const STATUS_NAME = { todo: '待办', doing: '进行中', done: '已完成' };

  const VIEW_META = {
    today:   { title: '今天',       sub: '聚焦今天要推进的事' },
    week:    { title: '未来 7 天',  sub: '提前看到接下来一周的安排' },
    overdue: { title: '已逾期',     sub: '需要尽快处理或调整计划' },
    inbox:   { title: '全部未完成', sub: '所有还没结束的任务' },
    done:    { title: '已完成',     sub: '回看做过的事' },
    'cat:bid':       { title: '投标任务', sub: '标书编制 · 报名 · 保证金 · 澄清答疑 · 开标跟进' },
    'cat:presale':   { title: '售前支持', sub: '方案交流 · 技术答疑 · POC 测试 · 演示汇报' },
    'cat:aftersale': { title: '售后支持', sub: '现场处理 · 故障排查 · 巡检维护 · 客户回访' },
    'cat:other':     { title: '其他支持', sub: '内部会议 · 培训 · 资料整理 · 临时协调' }
  };

  /* ---------------- 状态 ---------------- */
  const state = {
    tasks: [],
    view: 'today',
    layout: 'list',
    status: 'all',
    sort: 'smart',
    search: '',
    editingId: null,
    isNew: false,
    lastDeleted: null
  };

  let dragId = null;

  /* ---------------- 工具 ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function todayStr() { return ymd(new Date()); }
  function parseYmd(s) {
    const p = String(s).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function addDays(s, n) {
    const d = parseYmd(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  }
  function startOfWeek(s) {
    const d = parseYmd(s || todayStr());
    const wd = (d.getDay() + 6) % 7; // 周一为一周起点
    d.setDate(d.getDate() - wd);
    return ymd(d);
  }
  function weekdayCN(s) {
    return '日一二三四五六'[parseYmd(s).getDay()];
  }

  function fmtDue(due, time) {
    if (!due) return '';
    const t = todayStr();
    const diff = Math.round((parseYmd(due) - parseYmd(t)) / 86400000);
    let label;
    if (diff === 0) label = '今天';
    else if (diff === 1) label = '明天';
    else if (diff === 2) label = '后天';
    else if (diff === -1) label = '昨天';
    else if (diff > 2 && diff < 7) label = '周' + weekdayCN(due);
    else if (parseYmd(due).getFullYear() === new Date().getFullYear()) {
      label = (parseYmd(due).getMonth() + 1) + '月' + parseYmd(due).getDate() + '日';
    } else {
      label = due.replace(/-/g, '/');
    }
    return time ? label + ' ' + time : label;
  }

  function fmtDateTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(ctx, args), ms);
    };
  }

  /* ---------------- 存储 ---------------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      const list = Array.isArray(data) ? data : (data && data.tasks) || [];
      return list.map(normalizeTask).filter(Boolean);
    } catch (e) {
      console.warn('读取本地数据失败', e);
      return [];
    }
  }

  function normalizeTask(t) {
    if (!t || !t.id) return null;
    return {
      id: t.id,
      title: String(t.title || ''),
      cat: CATS[t.cat] ? t.cat : 'other',
      status: ['todo', 'doing', 'done'].indexOf(t.status) >= 0 ? t.status : 'todo',
      priority: [0, 1, 2, 3].indexOf(Number(t.priority)) >= 0 ? Number(t.priority) : 0,
      due: t.due || null,
      dueTime: t.dueTime || null,
      note: String(t.note || ''),
      tags: Array.isArray(t.tags) ? t.tags.filter(Boolean) : [],
      subs: Array.isArray(t.subs) ? t.subs.map(s => ({ id: s.id || uid(), title: String(s.title || ''), done: !!s.done })) : [],
      createdAt: t.createdAt || Date.now(),
      updatedAt: t.updatedAt || t.createdAt || Date.now(),
      completedAt: t.completedAt || null
    };
  }

  const save = debounce(function () {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: APP_VER, tasks: state.tasks }));
    } catch (e) {
      toast('保存失败：浏览器存储空间可能已满');
    }
  }, 120);

  /* 界面偏好（视图 / 布局 / 筛选 / 排序）单独存，刷新后保持原样 */
  const PREFS_KEY = 'work-tasks.prefs.v1';

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      return {
        view: VIEW_META[p.view] ? p.view : 'today',
        layout: p.layout === 'board' ? 'board' : 'list',
        status: ['all', 'todo', 'doing', 'done'].indexOf(p.status) >= 0 ? p.status : 'all',
        sort: ['smart', 'due', 'priority', 'created'].indexOf(p.sort) >= 0 ? p.sort : 'smart'
      };
    } catch (e) {
      return { view: 'today', layout: 'list', status: 'all', sort: 'smart' };
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        view: state.view, layout: state.layout, status: state.status, sort: state.sort
      }));
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 任务操作 ---------------- */
  function getTask(id) { return state.tasks.find(t => t.id === id); }

  function addTask(patch) {
    const t = normalizeTask(Object.assign({
      id: uid(),
      title: '',
      cat: 'other',
      status: 'todo',
      priority: 0,
      due: null,
      dueTime: null,
      note: '',
      tags: [],
      subs: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }, patch || {}));
    state.tasks.unshift(t);
    save();
    return t;
  }

  function removeTask(id) {
    const idx = state.tasks.findIndex(t => t.id === id);
    if (idx < 0) return;
    const t = state.tasks[idx];
    state.tasks.splice(idx, 1);
    state.lastDeleted = { task: t, index: idx };
    save();
    renderAll();
    toast('已删除「' + (t.title || '未命名任务') + '」', {
      label: '撤销',
      onClick: function () {
        state.tasks.splice(state.lastDeleted.index, 0, state.lastDeleted.task);
        state.lastDeleted = null;
        save();
        renderAll();
        toast('已恢复');
      }
    });
  }

  function toggleDone(id) {
    const t = getTask(id);
    if (!t) return;
    if (t.status === 'done') {
      t.status = 'todo';
      t.completedAt = null;
    } else {
      t.status = 'done';
      t.completedAt = Date.now();
    }
    t.updatedAt = Date.now();
    save();
    renderAll();
  }

  function setStatus(id, status) {
    const t = getTask(id);
    if (!t) return;
    t.status = status;
    t.completedAt = status === 'done' ? (t.completedAt || Date.now()) : null;
    t.updatedAt = Date.now();
    save();
    renderAll();
  }

  /* ---------------- 视图过滤 ---------------- */
  function viewBase(view) {
    const t = todayStr();
    const end = addDays(t, 7);
    switch (view) {
      case 'today':   return state.tasks.filter(x => x.due === t);
      case 'week':    return state.tasks.filter(x => x.status !== 'done' && x.due && x.due >= t && x.due <= end);
      case 'overdue': return state.tasks.filter(x => x.status !== 'done' && x.due && x.due < t);
      case 'inbox':   return state.tasks.filter(x => x.status !== 'done');
      case 'done':    return state.tasks.filter(x => x.status === 'done');
      default:
        if (view.indexOf('cat:') === 0) {
          const c = view.slice(4);
          return state.tasks.filter(x => x.cat === c);
        }
        return state.tasks.slice();
    }
  }

  function currentList() {
    let list = viewBase(state.view);

    if (state.status !== 'all') {
      list = list.filter(x => x.status === state.status);
    }

    const q = state.search.trim().toLowerCase();
    if (q) {
      list = list.filter(x => {
        const hay = (x.title + ' ' + x.note + ' ' + x.tags.join(' ') + ' ' +
          x.subs.map(s => s.title).join(' ')).toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }

    return sortTasks(list);
  }

  function sortTasks(list) {
    const arr = list.slice();
    const byDue = (a, b) => {
      if (!a.due && !b.due) return 0;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
    };
    if (state.sort === 'due') {
      arr.sort((a, b) => byDue(a, b) || b.priority - a.priority || b.createdAt - a.createdAt);
    } else if (state.sort === 'priority') {
      arr.sort((a, b) => b.priority - a.priority || byDue(a, b) || b.createdAt - a.createdAt);
    } else if (state.sort === 'created') {
      arr.sort((a, b) => b.createdAt - a.createdAt);
    } else {
      arr.sort((a, b) => {
        const ad = a.status === 'done' ? 1 : 0, bd = b.status === 'done' ? 1 : 0;
        if (ad !== bd) return ad - bd;
        if (a.status !== 'done') {
          if (a.status !== b.status) return a.status === 'doing' ? -1 : 1;
        } else {
          return (b.completedAt || 0) - (a.completedAt || 0);
        }
        return byDue(a, b) || b.priority - a.priority || b.createdAt - a.createdAt;
      });
    }
    return arr;
  }

  function groupByDone(list) {
    const t = todayStr();
    const ws = startOfWeek(t);
    const g = [
      { label: '今天完成', items: [] },
      { label: '昨天完成', items: [] },
      { label: '本周更早', items: [] },
      { label: '更早', items: [] }
    ];
    list.forEach(x => {
      const d = x.completedAt ? ymd(new Date(x.completedAt)) : null;
      if (!d) g[3].items.push(x);
      else if (d === t) g[0].items.push(x);
      else if (d === addDays(t, -1)) g[1].items.push(x);
      else if (d >= ws) g[2].items.push(x);
      else g[3].items.push(x);
    });
    return g.filter(x => x.items.length);
  }

  function groupByDue(list) {
    const t = todayStr();
    const g = [
      { label: '已逾期', items: [] },
      { label: '今天', items: [] },
      { label: '明天', items: [] },
      { label: '未来 7 天', items: [] },
      { label: '更晚', items: [] },
      { label: '没有日期', items: [] }
    ];
    list.forEach(x => {
      if (!x.due) g[5].items.push(x);
      else if (x.due < t) g[0].items.push(x);
      else if (x.due === t) g[1].items.push(x);
      else if (x.due === addDays(t, 1)) g[2].items.push(x);
      else if (x.due <= addDays(t, 7)) g[3].items.push(x);
      else g[4].items.push(x);
    });
    return g.filter(x => x.items.length);
  }

  /* ---------------- 渲染：侧边栏计数 ---------------- */
  function counts() {
    const t = todayStr(), end = addDays(t, 7);
    const open = state.tasks.filter(x => x.status !== 'done');
    const c = {
      today: open.filter(x => x.due === t).length,
      week: open.filter(x => x.due && x.due >= t && x.due <= end).length,
      overdue: open.filter(x => x.due && x.due < t).length,
      inbox: open.length,
      done: state.tasks.filter(x => x.status === 'done').length
    };
    CAT_KEYS.forEach(k => { c['cat:' + k] = open.filter(x => x.cat === k).length; });
    return c;
  }

  function renderCounts() {
    const c = counts();
    $$('[data-count]').forEach(el => {
      const n = c[el.getAttribute('data-count')] || 0;
      el.textContent = n > 0 ? n : '';
    });
  }

  function renderNav() {
    $$('.nav-item').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-view') === state.view);
    });
  }

  /* ---------------- 渲染：统计卡 ---------------- */
  function renderStats() {
    const t = todayStr();
    const ws = startOfWeek();
    const wsTs = parseYmd(ws).getTime();

    const todayN = state.tasks.filter(x => x.status !== 'done' && x.due === t).length;
    const overdueN = state.tasks.filter(x => x.status !== 'done' && x.due && x.due < t).length;
    const doingN = state.tasks.filter(x => x.status === 'doing').length;
    const weekDoneN = state.tasks.filter(x => x.status === 'done' && x.completedAt && x.completedAt >= wsTs).length;

    const cards = [
      { n: todayN, label: '今日待办', icon: 'i-sun', c: '#E05A4E', bg: '#FDECEA' },
      { n: overdueN, label: '已逾期', icon: 'i-alert', c: '#D9463C', bg: '#FCECEA' },
      { n: doingN, label: '进行中', icon: 'i-clock', c: '#E0952E', bg: '#FDF3E4' },
      { n: weekDoneN, label: '本周已完成', icon: 'i-check-circle', c: '#2F9E6F', bg: '#E9F6F0' }
    ];

    $('#stats').innerHTML = cards.map(c => `
      <div class="stat">
        <div class="stat-ico" style="--sb:${c.bg};--sc:${c.c}"><svg><use href="#${c.icon}"/></svg></div>
        <div class="stat-txt">
          <div class="stat-num">${c.n}</div>
          <div class="stat-label">${c.label}</div>
        </div>
      </div>`).join('');
  }

  function renderWeekProgress() {
    const ws = startOfWeek();
    const we = addDays(ws, 6);
    const wsTs = parseYmd(ws).getTime();
    const done = state.tasks.filter(x => x.status === 'done' && x.completedAt && x.completedAt >= wsTs).length;
    const left = state.tasks.filter(x => x.status !== 'done' && x.due && x.due >= ws && x.due <= we).length;
    const total = done + left;
    const pct = total ? Math.round(done / total * 100) : 0;

    $('#weekDoneNum').textContent = done;
    $('#weekBar').style.width = pct + '%';
    $('#weekDoneSub').textContent = total
      ? '本周已完成 ' + done + ' 项，还剩 ' + left + ' 项'
      : '本周还没有安排任务';
  }

  /* ---------------- 渲染：任务卡片 ---------------- */
  function dueClass(t) {
    if (!t.due) return '';
    const now = todayStr();
    if (t.due < now && t.status !== 'done') return 'overdue';
    if (t.due === now && t.status !== 'done') return 'today';
    return '';
  }

  function taskItemHTML(t) {
    const cat = CATS[t.cat];
    const prio = PRIOS[t.priority] || PRIOS[0];
    const subDone = t.subs.filter(s => s.done).length;
    const dcls = dueClass(t);

    let meta = '';
    if (t.due) {
      meta += `<span class="t-due ${dcls}"><svg><use href="#i-calendar"/></svg>${esc(fmtDue(t.due, t.dueTime))}</span>`;
    }
    if (t.subs.length) {
      meta += `<span class="t-sub-progress"><svg><use href="#i-check"/></svg>${subDone}/${t.subs.length}</span>`;
    }
    if (t.tags.length) {
      meta += `<span><svg><use href="#i-tag"/></svg>${esc(t.tags.join(' · '))}</span>`;
    }
    if (t.note) {
      meta += `<span class="t-note">${esc(t.note.replace(/\s+/g, ' '))}</span>`;
    }

    return `
      <div class="task ${t.status === 'done' ? 'done' : ''} ${t.status === 'doing' ? 'doing' : ''}" data-id="${t.id}">
        <button class="t-check" data-act="toggle" title="${t.status === 'done' ? '标记为未完成' : '标记完成'}"><svg><use href="#i-check"/></svg></button>
        <div class="t-main" data-act="open">
          <div class="t-row1">
            <span class="t-title">${esc(t.title) || '<span style="color:#b0b6c0">未命名任务</span>'}</span>
            ${t.priority ? `<span class="t-prio-tag" style="--pc:${prio.color};--pb:${prio.bg}">${prio.name}</span>` : ''}
            <span class="t-badge" style="--bc:${cat.color};--bc-bg:${cat.bg}">${cat.name}</span>
            ${t.status === 'doing' ? '<span class="t-badge" style="--bc:#B6741B;--bc-bg:#FDF3E4">进行中</span>' : ''}
          </div>
          ${meta ? `<div class="t-meta">${meta}</div>` : ''}
        </div>
        <div class="t-actions">
          <button data-act="doing" title="标记为进行中"><svg><use href="#i-clock"/></svg></button>
          <button data-act="del" title="删除"><svg><use href="#i-trash"/></svg></button>
        </div>
      </div>`;
  }

  function kcardHTML(t) {
    const cat = CATS[t.cat];
    const prio = PRIOS[t.priority] || PRIOS[0];
    const subDone = t.subs.filter(s => s.done).length;
    let meta = `<span class="t-badge" style="--bc:${cat.color};--bc-bg:${cat.bg}">${cat.name}</span>`;
    if (t.due) {
      meta += `<span class="t-due ${dueClass(t)}"><svg><use href="#i-calendar"/></svg>${esc(fmtDue(t.due, t.dueTime))}</span>`;
    }
    if (t.subs.length) {
      meta += `<span><svg><use href="#i-check"/></svg>${subDone}/${t.subs.length}</span>`;
    }
    return `
      <div class="kcard ${t.status === 'done' ? 'done' : ''}" data-id="${t.id}" draggable="true">
        <div class="k-top">
          ${t.priority ? `<i class="k-prio" style="--pc:${prio.color}" title="优先级：${prio.name}"></i>` : ''}
          <div class="k-title">${esc(t.title) || '<span style="color:#b0b6c0">未命名任务</span>'}</div>
        </div>
        <div class="k-meta">${meta}</div>
      </div>`;
  }

  /* ---------------- 渲染：内容区 ---------------- */
  function renderContent() {
    const list = currentList();
    const el = $('#content');

    if (!state.tasks.length) {
      el.innerHTML = `
        <div class="empty">
          <div class="empty-art"><svg><use href="#i-check-circle"/></svg></div>
          <h3>还没有任务</h3>
          <p>用左侧输入框添加第一条任务，或者先载入几条示例，看看各类工作怎么归类。</p>
          <div class="empty-actions">
            <button class="btn-primary" id="emptyNew">新建任务</button>
            <button class="btn-ghost" id="emptyDemo">载入示例数据</button>
          </div>
        </div>`;
      bindEmpty();
      return;
    }

    if (!list.length) {
      const searching = state.search.trim();
      el.innerHTML = `
        <div class="empty">
          <div class="empty-art"><svg><use href="${searching ? '#i-search' : '#i-check-circle'}"/></svg></div>
          <h3>${searching ? '没有匹配的任务' : '这里已经清空了'}</h3>
          <p>${searching ? '换个关键词试试，或者清空搜索框。' : '这个清单下暂时没有待办，保持住。'}</p>
          <div class="empty-actions">
            ${searching ? '<button class="btn-ghost" id="emptyClear">清空搜索</button>' : '<button class="btn-ghost" id="emptyNew">添加一条任务</button>'}
          </div>
        </div>`;
      const c = $('#emptyClear');
      if (c) c.onclick = () => { state.search = ''; $('#search').value = ''; renderAll(); };
      const n = $('#emptyNew');
      if (n) n.onclick = () => openNew();
      return;
    }

    if (state.layout === 'board') {
      el.innerHTML = renderBoard(list);
      return;
    }

    let html = '';

    // 已完成视图：顶部给个批量清理入口
    if (state.view === 'done' && !state.search.trim()) {
      html += `<div class="bulk-bar">
        <span>共 ${list.length} 条已完成</span>
        <button class="btn-ghost danger" id="btnClearDone">清空已完成</button>
      </div>`;
    }

    if (shouldGroup()) {
      const gs = state.view === 'done' ? groupByDone(list) : groupByDue(list);
      html += '<div class="task-list">' + gs.map(g => `
        <div class="group-head">${g.label} · ${g.items.length}<i></i></div>
        ${g.items.map(taskItemHTML).join('')}
      `).join('') + '</div>';
    } else {
      html += '<div class="task-list">' + list.map(taskItemHTML).join('') + '</div>';
    }

    el.innerHTML = html;

    const clearBtn = $('#btnClearDone');
    if (clearBtn) {
      clearBtn.onclick = function () {
        if (clearBtn.getAttribute('data-armed') === '1') {
          const doneCount = state.tasks.filter(t => t.status === 'done').length;
          state.tasks = state.tasks.filter(t => t.status !== 'done');
          save();
          renderAll();
          toast('已清空 ' + doneCount + ' 条已完成任务');
        } else {
          clearBtn.setAttribute('data-armed', '1');
          clearBtn.textContent = '再点一次确认';
          setTimeout(() => {
            if (!clearBtn.isConnected) return;
            clearBtn.removeAttribute('data-armed');
            clearBtn.textContent = '清空已完成';
          }, 4000);
        }
      };
    }
  }

  function shouldGroup() {
    return state.sort === 'smart' && state.view !== 'today';
  }

  function renderBoard(list) {
    const cols = [
      { k: 'todo', name: '待办', color: '#B7BDC7' },
      { k: 'doing', name: '进行中', color: '#E0952E' },
      { k: 'done', name: '已完成', color: '#2F9E6F' }
    ];
    return '<div class="board">' + cols.map(c => {
      const items = list.filter(x => x.status === c.k);
      return `
        <div class="board-col" data-status="${c.k}">
          <div class="bc-head">
            <i class="dot" style="--c:${c.color}"></i>${c.name}<em>${items.length}</em>
          </div>
          <div class="bc-body">
            ${items.map(kcardHTML).join('')}
            <button class="k-add" data-act="add-to" data-status="${c.k}"><svg><use href="#i-plus"/></svg>添加任务</button>
          </div>
        </div>`;
    }).join('') + '</div>';
  }

  /* ---------------- 渲染：头部 ---------------- */
  function renderHeader() {
    const meta = VIEW_META[state.view] || { title: '任务', sub: '' };
    const list = currentList();
    const openN = list.filter(x => x.status !== 'done').length;
    const doneN = list.length - openN;

    $('#viewTitle').textContent = meta.title;

    let sub = meta.sub;
    if (state.view === 'today') {
      sub = (new Date().getMonth() + 1) + ' 月 ' + new Date().getDate() + ' 日 · 周' + weekdayCN(todayStr());
    }
    if (state.search.trim()) {
      sub = '搜索「' + state.search.trim() + '」· 命中 ' + list.length + ' 条';
    } else if (state.view !== 'today') {
      sub = sub + ' · 待完成 ' + openN + ' 项' + (doneN ? '，已完成 ' + doneN + ' 项' : '');
    } else {
      sub = sub + ' · 待完成 ' + openN + ' 项';
    }
    $('#viewSub').textContent = sub;

    $$('#filters .chip').forEach(b => b.classList.toggle('on', b.getAttribute('data-status') === state.status));
    $$('#layoutSeg button').forEach(b => b.classList.toggle('on', b.getAttribute('data-layout') === state.layout));
    $('#sortBy').value = state.sort;
  }

  function renderAll() {
    renderNav();
    renderCounts();
    renderStats();
    renderWeekProgress();
    renderHeader();
    renderContent();
    savePrefs();
  }

  /* ---------------- 抽屉 ---------------- */
  function openTask(id) {
    const t = getTask(id);
    if (!t) return;
    state.editingId = id;
    state.isNew = false;
    renderDrawer(t);
    $('#drawerMask').classList.add('show');
    $('#drawer').classList.add('show');
    $('#drawer').setAttribute('aria-hidden', 'false');
  }

  function openNew(patch) {
    const t = addTask(Object.assign({
      cat: state.view.indexOf('cat:') === 0 ? state.view.slice(4) : 'other',
      due: state.view === 'today' ? todayStr() : null
    }, patch || {}));
    state.isNew = true;
    state.editingId = t.id;
    renderAll();
    renderDrawer(t);
    $('#drawerMask').classList.add('show');
    $('#drawer').classList.add('show');
    $('#drawer').setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      const el = $('#dTitle');
      if (el) { el.focus(); autoGrow(el); }
    }, 60);
  }

  function closeDrawer() {
    const t = getTask(state.editingId);
    if (t && state.isNew) {
      const empty = !t.title.trim() && !t.note.trim() && !t.subs.length && !t.tags.length;
      if (empty) {
        state.tasks = state.tasks.filter(x => x.id !== t.id);
        save();
      }
    }
    state.editingId = null;
    state.isNew = false;
    $('#drawerMask').classList.remove('show');
    $('#drawer').classList.remove('show');
    $('#drawer').setAttribute('aria-hidden', 'true');
    renderAll();
  }

  function renderDrawer(t) {
    const cat = CATS[t.cat];

    $('#drawerCrumb').innerHTML = '<span style="color:' + cat.color + '">●</span> ' + cat.name + (t.status === 'done' ? ' · 已完成' : '');

    $('#drawerBody').innerHTML = `
      <textarea class="field-title" id="dTitle" rows="1" placeholder="要做什么？">${esc(t.title)}</textarea>

      <div class="field" style="margin-top:20px">
        <label class="field-label">状态</label>
        <div class="opt-row" id="dStatus">
          ${['todo', 'doing', 'done'].map(k => `<button class="opt ${t.status === k ? 'on' : ''}" data-s="${k}">${STATUS_NAME[k]}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label class="field-label">清单分类</label>
        <div class="opt-row" id="dCat">
          ${CAT_KEYS.map(k => `<button class="opt ${t.cat === k ? 'on' : ''}" data-c="${k}" style="--oc-bg:${CATS[k].bg};--oc-bd:${CATS[k].bg};--oc-fg:${CATS[k].color}"><i class="dot" style="--c:${CATS[k].color}"></i>${CATS[k].name}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label class="field-label">优先级</label>
        <div class="opt-row" id="dPrio">
          ${[3, 2, 1, 0].map(p => `<button class="opt ${t.priority === p ? 'on' : ''}" data-p="${p}" style="--oc-bg:${PRIOS[p].bg};--oc-bd:${PRIOS[p].bd};--oc-fg:${PRIOS[p].fg}">${p ? `<i class="dot" style="--c:${PRIOS[p].color}"></i>` : ''}${PRIOS[p].name}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label class="field-label">截止日期</label>
        <div class="date-row">
          <input type="date" id="dDue" value="${t.due || ''}">
          <input type="time" id="dTime" value="${t.dueTime || ''}">
        </div>
        <div class="date-quick" style="margin-top:7px">
          <button data-q="today">今天</button>
          <button data-q="tomorrow">明天</button>
          <button data-q="nextweek">下周同一天</button>
          <button data-q="clear">清除</button>
        </div>
      </div>

      <div class="field">
        <label class="field-label">标签</label>
        <input class="field-input" id="dTags" placeholder="用逗号分隔，例如：国网, 紧急" value="${esc(t.tags.join(', '))}">
      </div>

      <div class="field">
        <label class="field-label">子任务 ${t.subs.length ? `<span style="color:#b0b6c0;font-weight:400">${t.subs.filter(s => s.done).length}/${t.subs.length}</span>` : ''}</label>
        <div class="sub-list" id="dSubs">${subsHTML(t)}</div>
        <div class="sub-add">
          <svg style="width:13px;height:13px"><use href="#i-plus"/></svg>
          <input id="dSubInput" placeholder="添加子任务，回车确认" autocomplete="off">
        </div>
      </div>

      <div class="field">
        <label class="field-label">备注</label>
        <textarea class="field-input" id="dNote" placeholder="补充说明、对接人、会议链接…">${esc(t.note)}</textarea>
      </div>

      <div class="meta-foot">
        创建于 ${fmtDateTime(t.createdAt)}<br>
        最近更新 ${fmtDateTime(t.updatedAt)}
      </div>`;

    bindDrawer(t);
    autoGrow($('#dTitle'));
  }

  function subsHTML(t) {
    if (!t.subs.length) return '';
    return t.subs.map(s => `
      <div class="sub-item ${s.done ? 'done' : ''}" data-sid="${s.id}">
        <button class="t-check" data-sact="toggle" title="完成子任务"><svg><use href="#i-check"/></svg></button>
        <span class="sub-txt" data-sact="edit">${esc(s.title)}</span>
        <button class="sub-del" data-sact="del" title="删除"><svg><use href="#i-close"/></svg></button>
      </div>`).join('');
  }

  function autoGrow(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, 30) + 'px';
  }

  const touch = function (t) {
    t.updatedAt = Date.now();
    save();
  };

  function bindDrawer(t) {
    const title = $('#dTitle');
    title.addEventListener('input', function () {
      t.title = title.value;
      autoGrow(title);
      touch(t);
      renderContent();
      renderHeader();
    });

    $('#dStatus').addEventListener('click', e => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      const s = b.getAttribute('data-s');
      t.status = s;
      t.completedAt = s === 'done' ? (t.completedAt || Date.now()) : null;
      touch(t);
      $$('#dStatus .opt').forEach(x => x.classList.toggle('on', x === b));
      $('#drawerCrumb').innerHTML = '<span style="color:' + CATS[t.cat].color + '">●</span> ' + CATS[t.cat].name + (s === 'done' ? ' · 已完成' : '');
      renderAll();
    });

    $('#dCat').addEventListener('click', e => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      t.cat = b.getAttribute('data-c');
      touch(t);
      $$('#dCat .opt').forEach(x => x.classList.toggle('on', x === b));
      $('#drawerCrumb').innerHTML = '<span style="color:' + CATS[t.cat].color + '">●</span> ' + CATS[t.cat].name + (t.status === 'done' ? ' · 已完成' : '');
      renderAll();
    });

    $('#dPrio').addEventListener('click', e => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      t.priority = Number(b.getAttribute('data-p'));
      touch(t);
      $$('#dPrio .opt').forEach(x => x.classList.toggle('on', x === b));
      renderContent();
    });

    $('#dDue').addEventListener('change', function () {
      t.due = this.value || null;
      if (!t.due) { t.dueTime = null; $('#dTime').value = ''; }
      touch(t);
      renderAll();
    });
    $('#dTime').addEventListener('change', function () {
      t.dueTime = this.value || null;
      touch(t);
      renderContent();
    });

    $('#drawerBody').querySelectorAll('.date-quick button').forEach(b => {
      b.addEventListener('click', function () {
        const q = b.getAttribute('data-q');
        if (q === 'clear') { t.due = null; t.dueTime = null; $('#dTime').value = ''; }
        else if (q === 'today') t.due = todayStr();
        else if (q === 'tomorrow') t.due = addDays(todayStr(), 1);
        else if (q === 'nextweek') t.due = addDays(t.due || todayStr(), 7);
        $('#dDue').value = t.due || '';
        touch(t);
        renderAll();
      });
    });

    $('#dTags').addEventListener('input', function () {
      t.tags = this.value.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
      touch(t);
      renderContent();
    });

    $('#dNote').addEventListener('input', function () {
      t.note = this.value;
      touch(t);
      renderContent();
    });

    const subInput = $('#dSubInput');
    subInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = this.value.trim();
      if (!v) return;
      t.subs.push({ id: uid(), title: v, done: false });
      this.value = '';
      touch(t);
      $('#dSubs').innerHTML = subsHTML(t);
      renderContent();
      refreshSubLabel(t);
    });

    $('#dSubs').addEventListener('click', e => {
      const btn = e.target.closest('[data-sact]');
      if (!btn) return;
      const row = btn.closest('[data-sid]');
      if (!row) return;
      const sid = row.getAttribute('data-sid');
      const sub = t.subs.find(s => s.id === sid);
      if (!sub) return;
      const act = btn.getAttribute('data-sact');

      if (act === 'toggle') {
        sub.done = !sub.done;
        row.classList.toggle('done', sub.done);
        touch(t);
        renderContent();
        refreshSubLabel(t);
      } else if (act === 'del') {
        t.subs = t.subs.filter(s => s.id !== sid);
        row.remove();
        touch(t);
        renderContent();
        refreshSubLabel(t);
      } else if (act === 'edit') {
        btn.setAttribute('contenteditable', 'true');
        btn.focus();
        try {
          const sel = window.getSelection();
          if (sel) sel.selectAllChildren(btn);
        } catch (err) {}
        const finish = () => {
          btn.removeAttribute('contenteditable');
          const v = btn.textContent.trim();
          if (v) { sub.title = v; touch(t); renderContent(); }
          else { btn.textContent = sub.title; }
        };
        btn.addEventListener('blur', finish, { once: true });
        btn.addEventListener('keydown', ev => {
          if (ev.key === 'Enter') { ev.preventDefault(); btn.blur(); }
        });
      }
    });
  }

  function refreshSubLabel(t) {
    $$('#drawerBody .field-label').forEach(el => {
      if (el.textContent.indexOf('子任务') === 0) {
        el.innerHTML = '子任务 ' + (t.subs.length
          ? `<span style="color:#b0b6c0;font-weight:400">${t.subs.filter(s => s.done).length}/${t.subs.length}</span>`
          : '');
      }
    });
  }

  /* ---------------- 快速添加 ---------------- */
  const WEEK_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

  function extractDate(text) {
    const t = todayStr();
    let m;

    // 1. 完整日期 2026-10-20 / 2026/10/20
    m = text.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) {
      return { due: m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0'), rest: cut(text, m) };
    }
    // 2. 月日 10月20日 / 10/20
    m = text.match(/(\d{1,2})\s*[月\/](\d{1,2})\s*[日号]?/);
    if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) {
      const y = new Date().getFullYear();
      let due = y + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
      if (due < t) due = (y + 1) + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
      return { due: due, rest: cut(text, m) };
    }
    // 3. 相对词
    const rel = [
      { re: /大后天/, n: 3 },
      { re: /后天/, n: 2 },
      { re: /明天|明日|明早/, n: 1 },
      { re: /今天|今日|今晚/, n: 0 }
    ];
    for (const r of rel) {
      m = text.match(r.re);
      if (m) return { due: addDays(t, r.n), rest: cut(text, m) };
    }
    // 4. 下周X
    m = text.match(/下周([一二三四五六日天])/);
    if (m) {
      const target = WEEK_MAP[m[1]];
      const ws = parseYmd(startOfWeek(t));
      const d = new Date(ws.getTime());
      const offset = (target + 6) % 7; // 周一=0
      d.setDate(d.getDate() + 7 + offset);
      return { due: ymd(d), rest: cut(text, m) };
    }
    // 5. 周X / 星期X
    m = text.match(/(?:周|星期|礼拜)([一二三四五六日天])/);
    if (m) {
      const target = WEEK_MAP[m[1]];
      const base = parseYmd(startOfWeek(t));
      const offset = (target + 6) % 7;
      const d = new Date(base.getTime());
      d.setDate(d.getDate() + offset);
      if (ymd(d) < t) d.setDate(d.getDate() + 7);
      return { due: ymd(d), rest: cut(text, m) };
    }
    return { due: null, rest: text };
  }

  function cut(text, m) {
    return (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  }

  /* 快速添加里的优先级标记：!高 / !中 / !低 */
  function extractPriority(text) {
    const map = [['!高', 3], ['!中', 2], ['!低', 1]];
    for (let i = 0; i < map.length; i++) {
      const k = map[i][0], p = map[i][1];
      const idx = text.indexOf(k);
      if (idx >= 0) {
        const rest = (text.slice(0, idx) + ' ' + text.slice(idx + k.length)).replace(/\s+/g, ' ').trim();
        return { p: p, rest: rest };
      }
    }
    return { p: 0, rest: text };
  }

  function quickAdd(raw) {
    const text = (raw || '').trim();
    if (!text) return;
    const r = extractDate(text);
    const pr = extractPriority(r.rest);
    const title = pr.rest.replace(/^[\s,，、]+|[\s,，、]+$/g, '');
    if (!title) { toast('请输入任务内容'); return; }

    const fromView = state.view;
    const cat = fromView.indexOf('cat:') === 0 ? fromView.slice(4) : 'other';
    let due = r.due;
    if (!due && fromView === 'today') due = todayStr();

    addTask({ title: title, cat: cat, due: due, priority: pr.p });
    $('#quickAdd').value = '';

    // 在「已完成」视图里新建的任务看不见，自动切到未完成清单
    if (fromView === 'done') {
      state.view = 'inbox';
      state.status = 'all';
    }

    renderAll();
    toast('已添加' + (due ? ' · 截止 ' + fmtDue(due) : '') + (pr.p ? ' · 优先级 ' + PRIOS[pr.p].name : ''));
  }

  /* ---------------- 导入导出 ---------------- */
  function download(filename, content, type) {
    const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJSON() {
    const data = { version: APP_VER, exportedAt: new Date().toISOString(), tasks: state.tasks };
    download('任务清单备份-' + todayStr() + '.json', JSON.stringify(data, null, 2), 'application/json');
    toast('已导出 ' + state.tasks.length + ' 条任务');
  }

  function exportCSV() {
    const head = ['标题', '分类', '状态', '优先级', '截止日期', '截止时间', '标签', '子任务', '备注', '创建时间', '完成时间'];
    const rows = state.tasks.map(t => [
      t.title,
      CATS[t.cat].name,
      STATUS_NAME[t.status],
      PRIOS[t.priority].name,
      t.due || '',
      t.dueTime || '',
      t.tags.join(' / '),
      t.subs.map(s => (s.done ? '✓' : '○') + s.title).join(' | '),
      t.note.replace(/\r?\n/g, ' '),
      fmtDateTime(t.createdAt),
      t.completedAt ? fmtDateTime(t.completedAt) : ''
    ]);
    const csv = '\ufeff' + [head].concat(rows).map(r =>
      r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')
    ).join('\r\n');
    download('任务清单-' + todayStr() + '.csv', csv, 'text/csv;charset=utf-8');
    toast('已导出 CSV');
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(reader.result);
        const list = Array.isArray(data) ? data : (data && data.tasks) || [];
        const incoming = list.map(normalizeTask).filter(Boolean);
        if (!incoming.length) { toast('文件里没有可导入的任务'); return; }
        const exists = new Set(state.tasks.map(t => t.id));
        let added = 0;
        incoming.forEach(t => {
          if (exists.has(t.id)) return;
          state.tasks.push(t);
          added++;
        });
        save();
        renderAll();
        toast('导入完成：新增 ' + added + ' 条，跳过重复 ' + (incoming.length - added) + ' 条');
      } catch (e) {
        toast('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  /* ---------------- 提示 ---------------- */
  let toastTimer = null;
  function toast(msg, opt) {
    const el = $('#toast');
    el.innerHTML = esc(msg) + (opt && opt.label
      ? ' <button style="background:none;border:0;color:#ffb3ac;font-size:12.8px;padding:0 0 0 6px;cursor:pointer">' + esc(opt.label) + '</button>'
      : '');
    el.classList.add('show');
    clearTimeout(toastTimer);

    if (opt && opt.label) {
      const btn = el.querySelector('button');
      if (btn) {
        btn.onclick = function () {
          el.classList.remove('show');
          clearTimeout(toastTimer);
          if (opt.onClick) opt.onClick();
        };
      }
    }
    toastTimer = setTimeout(() => el.classList.remove('show'), opt && opt.label ? 5000 : 2000);
  }

  /* ---------------- 示例数据 ---------------- */
  function loadDemo() {
    const t = todayStr();
    const demo = [
      { title: 'XX 局配网自动化项目 · 标书商务部分编制', cat: 'bid', status: 'doing', priority: 3, due: addDays(t, 1), note: '资质文件、业绩清单先给商务过一遍' },
      { title: '开标现场跟进（市公司 3 楼会议室）', cat: 'bid', status: 'todo', priority: 3, due: addDays(t, 3), dueTime: '09:30' },
      { title: '保证金退还申请', cat: 'bid', status: 'todo', priority: 1, due: addDays(t, -2) },
      { title: '客户技术交流：终端接入方案答疑', cat: 'presale', status: 'doing', priority: 2, due: t, dueTime: '14:00', note: '准备三页架构图' },
      { title: 'POC 测试环境搭建与联调', cat: 'presale', status: 'todo', priority: 2, due: addDays(t, 4), subs: [{ id: uid(), title: '申请测试服务器', done: true }, { id: uid(), title: '导入基础数据', done: false }, { id: uid(), title: '跑通主流程', done: false }] },
      { title: '现场故障处理：采集终端离线', cat: 'aftersale', status: 'todo', priority: 3, due: t, dueTime: '10:00', tags: ['紧急'] },
      { title: '季度巡检报告汇总', cat: 'aftersale', status: 'todo', priority: 1, due: addDays(t, 6) },
      { title: '客户回访：上季度问题闭环确认', cat: 'aftersale', status: 'done', priority: 0, due: addDays(t, -1), completedAt: Date.now() - 86400000 },
      { title: '部门周例会', cat: 'other', status: 'todo', priority: 0, due: addDays(t, 2) },
      { title: '整理产品培训材料', cat: 'other', status: 'todo', priority: 1, note: '面向新入职同事' }
    ];
    demo.forEach(d => {
      const t2 = addTask(d);
      if (d.completedAt) t2.completedAt = d.completedAt;
    });
    save();
    renderAll();
    toast('已载入 ' + demo.length + ' 条示例任务');
  }

  function bindEmpty() {
    const n = $('#emptyNew');
    if (n) n.onclick = () => openNew();
    const d = $('#emptyDemo');
    if (d) d.onclick = () => loadDemo();
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    // 侧边栏导航
    $('#nav').addEventListener('click', e => {
      const item = e.target.closest('.nav-item');
      if (!item) return;
      state.view = item.getAttribute('data-view');
      state.status = 'all';
      state.search = '';
      $('#search').value = '';
      renderAll();
      $('#content').scrollTop = 0;
      $('#sidebar').classList.remove('show');
      $('#sidebarMask').classList.remove('show');
    });

    // 快速添加
    $('#quickAdd').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); quickAdd(e.target.value); }
    });
    $('#quickAddBtn').addEventListener('click', () => quickAdd($('#quickAdd').value));

    // 新建
    $('#btnNew').addEventListener('click', () => openNew());

    // 搜索
    $('#search').addEventListener('input', debounce(function () {
      state.search = this.value;
      renderAll();
    }, 160));

    // 布局切换
    $('#layoutSeg').addEventListener('click', e => {
      const b = e.target.closest('[data-layout]');
      if (!b) return;
      state.layout = b.getAttribute('data-layout');
      renderAll();
    });

    // 状态筛选
    $('#filters').addEventListener('click', e => {
      const b = e.target.closest('[data-status]');
      if (!b) return;
      state.status = b.getAttribute('data-status');
      renderAll();
    });

    // 排序
    $('#sortBy').addEventListener('change', function () {
      state.sort = this.value;
      renderAll();
    });

    // 内容区操作
    $('#content').addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      const card = e.target.closest('.task, .kcard');
      if (!card) return;
      const id = card.getAttribute('data-id');
      const act = btn ? btn.getAttribute('data-act') : null;

      if (act === 'toggle') { toggleDone(id); return; }
      if (act === 'del') { removeTask(id); return; }
      if (act === 'doing') { setStatus(id, 'doing'); return; }
      if (act === 'add-to') {
        openNew({ status: btn.getAttribute('data-status'), cat: state.view.indexOf('cat:') === 0 ? state.view.slice(4) : 'other' });
        return;
      }
      openTask(id);
    });

    // 看板拖拽
    const content = $('#content');
    content.addEventListener('dragstart', e => {
      const card = e.target.closest('.kcard');
      if (!card) return;
      dragId = card.getAttribute('data-id');
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch (err) {}
    });
    content.addEventListener('dragend', e => {
      const card = e.target.closest('.kcard');
      if (card) card.classList.remove('dragging');
      $$('.board-col').forEach(c => c.classList.remove('drag-over'));
      dragId = null;
    });
    content.addEventListener('dragover', e => {
      const col = e.target.closest('.board-col');
      if (!col || !dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      $$('.board-col').forEach(c => c.classList.toggle('drag-over', c === col));
    });
    content.addEventListener('dragleave', e => {
      const col = e.target.closest('.board-col');
      if (col && !col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });
    content.addEventListener('drop', e => {
      const col = e.target.closest('.board-col');
      if (!col) return;
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = dragId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      dragId = null;
      if (!id) return;
      const t = getTask(id);
      if (!t) return;
      const s = col.getAttribute('data-status');
      if (t.status !== s) {
        setStatus(id, s);
        toast('已移到「' + STATUS_NAME[s] + '」');
      }
    });

    // 抽屉
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#drawerMask').addEventListener('click', closeDrawer);
    $('#btnSave').addEventListener('click', closeDrawer);
    $('#btnDuplicate').addEventListener('click', () => {
      const src = getTask(state.editingId);
      if (!src) return;
      const copy = addTask({
        title: src.title + '（副本）',
        cat: src.cat,
        priority: src.priority,
        due: src.due,
        dueTime: src.dueTime,
        note: src.note,
        tags: src.tags.slice(),
        subs: src.subs.map(s => ({ id: uid(), title: s.title, done: false }))
      });
      state.isNew = false;
      state.editingId = copy.id;
      renderAll();
      renderDrawer(copy);
      toast('已复制为新任务');
    });
    $('#btnDelete').addEventListener('click', () => {
      const id = state.editingId;
      if (!id) return;
      state.editingId = null;
      state.isNew = false;
      $('#drawerMask').classList.remove('show');
      $('#drawer').classList.remove('show');
      removeTask(id);
    });

    // 导出导入
    $('#btnExport').addEventListener('click', exportJSON);
    $('#btnExportCsv').addEventListener('click', exportCSV);
    $('#btnImport').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', function () {
      if (this.files && this.files[0]) importJSON(this.files[0]);
      this.value = '';
    });

    // 帮助
    $('#btnHelp').addEventListener('click', () => $('#helpMask').classList.add('show'));
    $('#helpClose').addEventListener('click', () => $('#helpMask').classList.remove('show'));
    $('#helpMask').addEventListener('click', e => {
      if (e.target === $('#helpMask')) $('#helpMask').classList.remove('show');
    });

    // 移动端菜单
    const sidebarMask = $('#sidebarMask');
    function toggleSidebar(open) {
      $('#sidebar').classList.toggle('show', open);
      sidebarMask.classList.toggle('show', open);
    }
    $('#btnMenu').addEventListener('click', () => toggleSidebar(!$('#sidebar').classList.contains('show')));
    sidebarMask.addEventListener('click', () => toggleSidebar(false));

    // 快捷键
    document.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

      if (e.key === 'Escape') {
        if ($('#helpMask').classList.contains('show')) { $('#helpMask').classList.remove('show'); return; }
        if (state.editingId) { closeDrawer(); return; }
        if (document.activeElement === $('#search')) {
          state.search = ''; $('#search').value = ''; $('#search').blur(); renderAll();
        }
        return;
      }

      if (state.editingId) {
        if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); closeDrawer(); return; }
        if (!typing && ['1', '2', '3'].indexOf(e.key) >= 0) {
          const map = { '1': 'todo', '2': 'doing', '3': 'done' };
          const t = getTask(state.editingId);
          if (t) {
            t.status = map[e.key];
            t.completedAt = t.status === 'done' ? (t.completedAt || Date.now()) : null;
            touch(t);
            renderAll();
            renderDrawer(t);
          }
          return;
        }
        return;
      }

      if (typing) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); $('#quickAdd').focus(); }
      else if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    });
  }

  /* ---------------- 启动 ---------------- */
  let inited = false;
  function init() {
    if (inited) return;
    inited = true;

    state.tasks = load();
    Object.assign(state, loadPrefs());
    bindEvents();
    renderAll();

    // 跨零点时刷新“今天”
    let lastDay = todayStr();
    setInterval(() => {
      const d = todayStr();
      if (d !== lastDay) { lastDay = d; renderAll(); }
    }, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
