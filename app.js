/* =========================================================
   个人工作任务清单
   纯前端单页应用 · 数据保存在浏览器 localStorage
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- 常量 ---------------- */
  const STORE_KEY = 'work-tasks.v1';
  const DAILY_KEY = 'work-tasks.daily.v1'; // 日常待办单独存：不参与 JSON / CSV 导出，但会显示在日历里
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

  const REPEATS = {
    none:      { name: '不重复' },
    daily:     { name: '每天' },
    weekly:    { name: '每周' },
    biweekly:  { name: '每两周' },
    monthly:   { name: '每月' },
    yearly:    { name: '每年' }
  };

  /* 按周期加一期（月/年按月末对齐：1月31日 +1月 = 2月28日） */
  function addPeriod(s, freq) {
    if (freq === 'daily') return addDays(s, 1);
    if (freq === 'weekly') return addDays(s, 7);
    if (freq === 'biweekly') return addDays(s, 14);
    const months = freq === 'yearly' ? 12 : 1;
    const d = parseYmd(s);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return ymd(d);
  }

  /* 重复任务的下一期截止日：从原到期日往后推，跨过"今天"为止
     （这样拖了几周才补做的周会，下一条会落到正确的下一个周期，而不是继续逾期） */
  function nextRepeatDue(due, freq) {
    if (!REPEATS[freq] || freq === 'none') return null;
    let next = addPeriod(due || todayStr(), freq);
    const t = todayStr();
    let guard = 0;
    while (next < t && guard++ < 400) next = addPeriod(next, freq);
    return next;
  }

  const VIEW_META = {
    calendar: { title: '日历',     sub: '按月查看与安排任务' },
    daily:    { title: '日常待办', sub: '每天固定要做的零碎事，和任务分开记（只存本机，不参与导出）' },
    today:   { title: '今天',       sub: '所有未完成的任务都在这里' },
    week:    { title: '未来 7 天',  sub: '提前看到接下来一周的安排' },
    overdue: { title: '已逾期',     sub: '需要尽快处理或调整计划' },
    inbox:   { title: '全部未完成', sub: '所有还没结束的任务' },
    done:    { title: '已完成',     sub: '回看做过的事' },
    stats:   { title: '分类统计',   sub: '看各类工作的时间投入与完成情况' },
    archive: { title: '归档',       sub: '删掉的任务都在这儿，随时能翻回来' },
    'cat:bid':       { title: '投标任务', sub: '标书编制 · 报名 · 保证金 · 澄清答疑 · 开标跟进' },
    'cat:presale':   { title: '售前支持', sub: '方案交流 · 技术答疑 · POC 测试 · 演示汇报' },
    'cat:aftersale': { title: '售后支持', sub: '现场处理 · 故障排查 · 巡检维护 · 客户回访' },
    'cat:other':     { title: '其他支持', sub: '内部会议 · 培训 · 资料整理 · 临时协调' }
  };

  /* ---------------- 状态 ---------------- */
  const state = {
    tasks: [],
    view: 'calendar',
    layout: 'list',
    status: 'all',
    sort: 'smart',
    search: '',
    statsRange: 'month',
    theme: 'auto',
    calMonth: todayStr().slice(0, 7), // 'YYYY-MM'，日历当前月
    calSelDay: todayStr(),             // 日历选中日（下方当日清单）
    editingId: null,
    isNew: false,
    lastDeleted: null,
    purged: {},          // 墓碑：彻底删除的 id -> 删除时间（防别的标签页/备份复活它）
    daily: [],           // 日常待办：{id,date,time,text,done,doneAt,createdAt,updatedAt}，不参与导出
    dailyPurged: {},     // 日常待办的删除墓碑
    dailyDate: todayStr(), // 日常待办默认写入的日期
    dailyDraft: '',        // 日常待办输入框草稿（重绘时不丢）
    sel: new Set(),      // 批量选择：任务 id
    selAnchor: null,     // Shift 连选的锚点
    navId: null          // 键盘导航当前聚焦的行
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
    else if (diff > 2 && diff < 7) {
      // 同一周内直接写「周四」，跨到下一周写「下周四」，避免误读成本周
      const sameWeek = startOfWeek(due) === startOfWeek(t);
      label = (sameWeek ? '周' : '下周') + weekdayCN(due);
    } else if (parseYmd(due).getFullYear() === new Date().getFullYear()) {
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
  const BACKUP_KEY = 'work-tasks.backup.v1';
  const BACKUP_MAX = 3;

  function loadBackups() {
    try {
      const arr = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  /* 每天首次打开存一份快照，留最近 3 天，防误清缓存 / 数据损坏 */
  let backupDone = false;

  function saveBackup() {
    if (backupDone) return;
    if (!state.tasks.length) return;
    try {
      const today = todayStr();
      const list = loadBackups();
      if (list.length && list[0].date === today) { backupDone = true; return; }
      list.unshift({ at: Date.now(), date: today, count: state.tasks.length, tasks: state.tasks, daily: state.daily });
      localStorage.setItem(BACKUP_KEY, JSON.stringify(list.slice(0, BACKUP_MAX)));
      backupDone = true;
    } catch (e) {
      /* 空间不够就算了，不能影响主流程 */
    }
  }

  function restoreBackup(index) {
    const list = loadBackups();
    const b = list[index];
    if (!b || !Array.isArray(b.tasks)) { toast('没有可用的备份'); return; }
    const have = new Set(state.tasks.map(t => t.id));
    let added = 0;
    b.tasks.forEach(raw => {
      const n = normalizeTask(raw);
      if (n && !have.has(n.id)) { state.tasks.push(n); added++; }
    });

    // 日常记录一起从快照补回（只增不覆盖，避免恢复备份时抹掉新记的内容）
    let addedD = 0;
    if (Array.isArray(b.daily)) {
      const haveD = new Set(state.daily.map(x => x.id));
      b.daily.forEach(raw => {
        const n = normalizeDaily(raw);
        if (n && !haveD.has(n.id)) { state.daily.push(n); addedD++; }
      });
      if (addedD) saveDaily();
    }

    save();
    renderAll();
    const parts = [];
    if (added) parts.push(added + ' 条任务');
    if (addedD) parts.push(addedD + ' 条日常待办');
    toast(parts.length
      ? '已从 ' + b.date + ' 的快照恢复 ' + parts.join('、')
      : '快照里的内容都还在，无需恢复');
  }

  function renderBackupInfo() {
    const list = loadBackups();
    const info = $('#backupInfo');
    const actions = $('#backupActions');
    if (!info || !actions) return;

    if (!list.length) {
      info.textContent = '还没有快照。每天首次打开会自动存一份，保留最近 3 份。';
      actions.innerHTML = '';
      return;
    }

    info.innerHTML = '每天首次打开会自动存一份快照，保留最近 3 份。当前有：<br>' +
      list.map(b => '· ' + esc(b.date) + '　' + b.count + ' 条任务').join('<br>');

    actions.innerHTML = list.map((b, i) =>
      `<button class="btn-ghost" data-restore="${i}" style="margin:8px 8px 0 0;height:28px;font-size:12px">恢复 ${esc(b.date)}</button>`
    ).join('');

    actions.querySelectorAll('[data-restore]').forEach(btn => {
      btn.onclick = function () {
        restoreBackup(Number(btn.getAttribute('data-restore')));
        $('#helpMask').classList.remove('show');
      };
    });
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { tasks: [], purged: {} };
      JSON.parse(raw); // 主数据损坏时抛错，走下面的快照兜底
      return parseStore(raw);
    } catch (e) {
      console.warn('读取本地数据失败，尝试从备份恢复', e);
      const list = loadBackups();
      if (list.length && Array.isArray(list[0].tasks)) {
        console.warn('已使用 ' + list[0].date + ' 的快照');
        return { tasks: list[0].tasks.map(normalizeTask).filter(Boolean), purged: {} };
      }
      return { tasks: [], purged: {} };
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
      order: typeof t.order === 'number' ? t.order : null,
      hours: typeof t.hours === 'number' && t.hours >= 0 ? t.hours : null,
      archived: !!t.archived,
      archivedAt: t.archivedAt || null,
      repeat: REPEATS[t.repeat] ? t.repeat : 'none',
      nextId: t.nextId || null,
      createdAt: t.createdAt || Date.now(),
      updatedAt: t.updatedAt || t.createdAt || Date.now(),
      completedAt: t.completedAt || null
    };
  }

  const save = debounce(function () {
    // 写入前先和 localStorage 里（可能是别的标签页刚写的）合并一次，
    // 避免两个标签页互相整包覆盖
    syncWithStore();
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        version: APP_VER, tasks: state.tasks, purged: state.purged
      }));
    } catch (e) {
      toast('保存失败：浏览器存储空间可能已满');
    }
    saveBackup();
  }, 120);

  /* ---------------- 多标签页同步 ---------------- */
  const PURGED_MAX = 500;

  function parseStore(raw) {
    if (!raw) return { tasks: [], purged: {} };
    try {
      const data = JSON.parse(raw);
      const list = (Array.isArray(data) ? data : (data && data.tasks) || [])
        .map(normalizeTask).filter(Boolean);
      const purged = (data && data.purged && typeof data.purged === 'object') ? data.purged : {};
      return { tasks: list, purged: purged };
    } catch (e) {
      return { tasks: [], purged: {} };
    }
  }

  /* 把远端数据合进本地（就地）。规则：
     - 墓碑（purged：彻底删除的 id -> 删除时间）：删除时间晚于对方任务 updatedAt 的一方生效，
       两边墓碑取并集；这样删除能同步，旧备份也不会让已删任务复活。
     - 同 id 任务：updatedAt 新者胜（就地覆盖，抽屉正编辑它时引用仍有效）。
     - 本地有、远端没有且无墓碑：是本机新增对方还没看到的，保留。
     返回是否有变化。 */
  function mergeRemote(local, localPurged, remote, remotePurged) {
    let changed = false;

    Object.keys(remotePurged).forEach(id => {
      const ts = Number(remotePurged[id]) || 0;
      if (!(id in localPurged) || Number(localPurged[id]) < ts) localPurged[id] = ts;
      const cur = local.find(t => t.id === id);
      if (cur && ts >= (cur.updatedAt || 0)) {
        local.splice(local.indexOf(cur), 1);
        changed = true;
      }
    });

    const lmap = {};
    local.forEach(t => { lmap[t.id] = t; });
    remote.forEach(t => {
      if (t.id in localPurged && localPurged[t.id] >= (t.updatedAt || 0)) return;
      const cur = lmap[t.id];
      if (!cur) {
        local.push(t);
        changed = true;
      } else if ((t.updatedAt || 0) > (cur.updatedAt || 0)) {
        Object.keys(t).forEach(k => { cur[k] = t[k]; });
        changed = true;
      }
    });

    // 墓碑集合防膨胀：按删除时间保留最近 PURGED_MAX 条
    const keys = Object.keys(localPurged);
    if (keys.length > PURGED_MAX) {
      keys.sort((a, b) => localPurged[b] - localPurged[a]).slice(PURGED_MAX).forEach(k => { delete localPurged[k]; });
    }
    return changed;
  }

  function syncWithStore() {
    const remote = parseStore(localStorage.getItem(STORE_KEY));
    return mergeRemote(state.tasks, state.purged, remote.tasks, remote.purged);
  }

  /* ---------------- 日常待办存储（独立 key，导出时不会带上） ---------------- */
  function normalizeDaily(x) {
    if (!x || !x.id) return null;
    return {
      id: String(x.id),
      date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : todayStr(),
      time: /^\d{1,2}:\d{2}$/.test(x.time || '') ? x.time : '',
      text: String(x.text || ''),
      done: !!x.done,
      doneAt: x.done ? (x.doneAt || x.updatedAt || 0) : null,
      createdAt: x.createdAt || Date.now(),
      updatedAt: x.updatedAt || x.createdAt || Date.now()
    };
  }

  /* 新建一条日常待办：视图和日历面板共用 */
  function pushDaily(date, text) {
    text = String(text || '').replace(/\r/g, '').trim();
    if (!text) return null;
    const now = new Date();
    const p = n => String(n).padStart(2, '0');
    const item = {
      id: uid(),
      date: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : todayStr(),
      time: p(now.getHours()) + ':' + p(now.getMinutes()),
      text: text,
      done: false,
      doneAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    state.daily.push(item);
    saveDaily();
    return item;
  }

  /* 勾掉 / 取消勾掉一条日常待办 */
  function toggleDailyDone(id) {
    const it = state.daily.find(x => x.id === id);
    if (!it) return;
    it.done = !it.done;
    it.doneAt = it.done ? Date.now() : null;
    it.updatedAt = Date.now();
    saveDaily();
    renderAll();
    if (it.done) toast('已完成一条日常待办');
  }

  function parseDaily(raw) {
    try {
      const d = raw ? JSON.parse(raw) : null;
      const items = ((d && Array.isArray(d.items)) ? d.items : []).map(normalizeDaily).filter(Boolean);
      const purged = (d && d.purged && typeof d.purged === 'object') ? d.purged : {};
      return { items: items, purged: purged };
    } catch (e) {
      return { items: [], purged: {} };
    }
  }

  function loadDaily() {
    return parseDaily(localStorage.getItem(DAILY_KEY));
  }

  // 日常记录都是离散操作（记一条 / 改一条 / 删一条），直接落盘，避免关标签页瞬间丢记录
  function saveDaily() {
    // 和任务一样：先合并别的标签页写入的记录，再整包写回
    const remote = parseDaily(localStorage.getItem(DAILY_KEY));
    mergeRemote(state.daily, state.dailyPurged, remote.items, remote.purged);
    try {
      localStorage.setItem(DAILY_KEY, JSON.stringify({
        version: APP_VER, items: state.daily, purged: state.dailyPurged
      }));
    } catch (e) {
      toast('保存失败：浏览器存储空间可能已满');
    }
  }

  window.addEventListener('storage', function (e) {
    if (e.key === DAILY_KEY && e.newValue != null) {
      const remote = parseDaily(e.newValue);
      if (!mergeRemote(state.daily, state.dailyPurged, remote.items, remote.purged)) return;
      renderCounts();
      if (state.view === 'daily' || state.view === 'calendar') renderAll();
      toast('已同步另一个标签页的日常待办');
      return;
    }
    if (e.key !== STORE_KEY || e.newValue == null) return;
    const remote = parseStore(e.newValue);
    if (!mergeRemote(state.tasks, state.purged, remote.tasks, remote.purged)) return;
    if (state.editingId && getTask(state.editingId)) renderDrawer(getTask(state.editingId));
    renderAll();
    toast('已同步另一个标签页的改动');
  });

  /* 界面偏好（视图 / 布局 / 筛选 / 排序）单独存，刷新后保持原样 */
  const PREFS_KEY = 'work-tasks.prefs.v1';

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      return {
        view: VIEW_META[p.view] ? p.view : 'calendar',
        layout: p.layout === 'board' ? 'board' : 'list',
        status: ['all', 'todo', 'doing', 'done'].indexOf(p.status) >= 0 ? p.status : 'all',
        sort: ['smart', 'due', 'priority', 'created', 'manual'].indexOf(p.sort) >= 0 ? p.sort : 'smart',
        statsRange: ['week', 'month', 'all'].indexOf(p.statsRange) >= 0 ? p.statsRange : 'month',
        theme: ['auto', 'light', 'dark'].indexOf(p.theme) >= 0 ? p.theme : 'auto'
      };
    } catch (e) {
      return { view: 'calendar', layout: 'list', status: 'all', sort: 'smart', statsRange: 'month', theme: 'auto' };
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        view: state.view, layout: state.layout, status: state.status,
        sort: state.sort, statsRange: state.statsRange, theme: state.theme
      }));
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 主题（自动 / 浅色 / 深色） ---------------- */
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function applyTheme() {
    const dark = state.theme === 'dark' || (state.theme === 'auto' && darkQuery && darkQuery.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const btn = $('#btnTheme');
    if (btn) {
      const label = state.theme === 'auto' ? '自动' : dark ? '深色' : '浅色';
      btn.title = '主题：' + label + '（点击切换）';
      btn.innerHTML = state.theme === 'auto'
        ? '<svg><use href="#i-moon"/></svg>'
        : dark ? '<svg><use href="#i-moon"/></svg>' : '<svg><use href="#i-sun"/></svg>';
    }
  }

  function cycleTheme() {
    state.theme = { auto: 'light', light: 'dark', dark: 'auto' }[state.theme];
    applyTheme();
    savePrefs();
    toast('主题：' + (state.theme === 'auto' ? '跟随系统' : state.theme === 'dark' ? '深色' : '浅色'));
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

  /* 删除 / 归档后收回选中态，避免操作条计数与实际不符 */
  function unselect(id) {
    if (state.sel.delete(id)) updateSelectingClass();
  }

  /* 删除 = 归档，进「归档」清单还能翻回来 */
  function archiveTask(id) {
    const t = getTask(id);
    if (!t) return;
    unselect(id);
    t.archived = true;
    t.archivedAt = Date.now();
    t.updatedAt = Date.now();
    save();
    renderAll();
    toast('已归档「' + (t.title || '未命名任务') + '」', {
      label: '撤销',
      onClick: function () {
        t.archived = false;
        t.archivedAt = null;
        save();
        renderAll();
        toast('已恢复到原清单');
      }
    });
  }

  function restoreTask(id) {
    const t = getTask(id);
    if (!t) return;
    t.archived = false;
    t.archivedAt = null;
    t.updatedAt = Date.now();
    save();
    renderAll();
    toast('已恢复「' + (t.title || '未命名任务') + '」');
  }

  function deleteForever(id) {
    const idx = state.tasks.findIndex(t => t.id === id);
    if (idx < 0) return;
    const t = state.tasks[idx];
    state.tasks.splice(idx, 1);
    const purgedAt = Date.now();
    state.purged[id] = purgedAt; // 墓碑：别的标签页不能让它复活
    state.lastDeleted = { task: t, index: idx };
    save();
    renderAll();
    toast('已彻底删除「' + (t.title || '未命名任务') + '」', {
      label: '撤销',
      onClick: function () {
        state.tasks.splice(state.lastDeleted.index, 0, state.lastDeleted.task);
        delete state.purged[id]; // 撤销则收回墓碑
        state.lastDeleted = null;
        save();
        renderAll();
        toast('已恢复');
      }
    });
  }

  /* 重复任务：完成本期后自动生成下一期（子任务全部重置为未完成）。
     nextId 指向已生成的下一期；只要那条还活着（未彻底删除/未归档），就不再重复生成，
     防"取消完成 -> 再完成"刷出一串任务。 */
  function spawnNextInstance(t) {
    if (!REPEATS[t.repeat] || t.repeat === 'none') return null;
    if (t.nextId) {
      const prev = getTask(t.nextId);
      if (prev && !prev.archived) return null;
    }
    const next = addTask({
      title: t.title,
      cat: t.cat,
      priority: t.priority,
      due: nextRepeatDue(t.due, t.repeat),
      dueTime: t.dueTime,
      note: t.note,
      tags: t.tags.slice(),
      subs: t.subs.map(s => ({ id: uid(), title: s.title, done: false })),
      repeat: t.repeat
    });
    t.nextId = next.id;
    return next;
  }

  function toggleDone(id) {
    const t = getTask(id);
    if (!t) return;
    if (t.status === 'done') {
      t.status = 'todo';
      t.completedAt = null;
      t.updatedAt = Date.now();
      save();
      renderAll();
    } else {
      setStatus(id, 'done');
    }
  }

  function setStatus(id, status) {
    const t = getTask(id);
    if (!t) return;
    const wasDone = t.status === 'done';
    t.status = status;
    t.completedAt = status === 'done' ? (t.completedAt || Date.now()) : null;
    t.updatedAt = Date.now();
    let next = null;
    if (status === 'done' && !wasDone) next = spawnNextInstance(t);
    save();
    renderAll();
    if (next) toast('已生成下一期 · ' + (next.due ? fmtDue(next.due, next.dueTime) : '未排期'));
    return next;
  }

  /* 手动排序：把 fromId 插到 targetId 前/后，再把当前列表顺序写回 order */
  function reorderTasks(fromId, targetId, after) {
    const ids = currentList().map(t => t.id);
    const from = ids.indexOf(fromId);
    if (from < 0) return;
    ids.splice(from, 1);
    let to = ids.indexOf(targetId);
    if (to < 0) return;
    if (after) to += 1;
    ids.splice(to, 0, fromId);

    ids.forEach((id, i) => {
      const t = getTask(id);
      if (t) t.order = i;
    });
    save();
    renderAll();
  }

  /* ---------------- 农历 ----------------
     用浏览器内置的中国历法（Intl u-ca-chinese），零依赖、含闰月；
     拿不到就整体降级（不显示农历），不影响其他功能 */
  const lunarFmt = (function () {
    try {
      const f = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { year: 'numeric', month: 'numeric', day: 'numeric' });
      if (f.resolvedOptions().calendar !== 'chinese') return null;
      return f;
    } catch (e) { return null; }
  })();

  const LUNAR_DAY = ['初一','初二','初三','初四','初五','初六','初七','初八','初九','初十',
    '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十',
    '廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十'];

  /* 返回 { month, day, label } 或 null；label 优先节日，其次农历日 */
  function lunarOf(dateStr) {
    if (!lunarFmt) return null;
    const ps = lunarFmt.formatToParts(parseYmd(dateStr));
    const month = (ps.find(p => p.type === 'month') || {}).value || '';
    const dayN = Number((ps.find(p => p.type === 'day') || {}).value || 0);
    if (!month || !dayN) return null;
    // 初一显示月名（正月/十月/闰六月…），其余显示农历日；节日另存
    return { month: month, day: dayN, label: dayN === 1 ? month : (LUNAR_DAY[dayN - 1] || ''), dayName: LUNAR_DAY[dayN - 1] || '', fest: festivalOf(month, dayN, dateStr) };
  }

  /* 传统节日：按农历月日判断（除夕看明天是不是正月初一） */
  const LUNAR_FEST = {
    '正月1': '春节', '正月15': '元宵', '五月5': '端午', '七月7': '七夕',
    '八月15': '中秋', '九月9': '重阳', '腊月8': '腊八', '腊月23': '小年', '腊月30': '除夕'
  };
  /* 公历节日优先于农历日（主流日历习惯） */
  const SOLAR_FEST = {
    '01-01': '元旦', '02-14': '情人节', '03-08': '妇女节', '03-12': '植树节',
    '05-01': '劳动节', '05-04': '青年节', '06-01': '儿童节', '09-10': '教师节',
    '10-01': '国庆节', '12-24': '平安夜', '12-25': '圣诞节'
  };
  function festivalOf(month, day, dateStr) {
    const key = month + day;
    if (LUNAR_FEST[key]) return LUNAR_FEST[key];
    if (month === '腊月' && day === 29) {
      // 腊月廿九是否除夕：小月（无三十）时廿九就是除夕
      const nx = lunarPartsRaw(addDays(dateStr, 1));
      if (nx && nx.month === '正月' && nx.day === 1) return '除夕';
    }
    return SOLAR_FEST[dateStr.slice(5)] || '';
  }
  function lunarPartsRaw(dateStr) {
    if (!lunarFmt) return null;
    const ps = lunarFmt.formatToParts(parseYmd(dateStr));
    return {
      month: (ps.find(p => p.type === 'month') || {}).value || '',
      day: Number((ps.find(p => p.type === 'day') || {}).value || 0)
    };
  }

  /* 月视图要算 42 格 + 相邻日，缓存一次 */
  let lunarCache = {};
  function lunarCached(dateStr) {
    if (!(dateStr in lunarCache)) lunarCache[dateStr] = lunarOf(dateStr);
    return lunarCache[dateStr];
  }

  /* ---------------- 视图过滤 ---------------- */
  function viewBase(view) {
    const t = todayStr();
    const end = addDays(t, 7);
    const alive = state.tasks.filter(x => !x.archived);

    switch (view) {
      case 'today':
        // 首页：所有未完成的任务都放出来，另外保留今天已完成的（划线，便于回顾）
        return alive.filter(x =>
          x.status !== 'done' ||
          (x.completedAt && ymd(new Date(x.completedAt)) === t)
        );
      case 'week':    return alive.filter(x => x.status !== 'done' && x.due && x.due >= t && x.due <= end);
      case 'overdue': return alive.filter(x => x.status !== 'done' && x.due && x.due < t);
      case 'inbox':   return alive.filter(x => x.status !== 'done');
      case 'done':    return alive.filter(x => x.status === 'done');
      case 'archive': return state.tasks.filter(x => x.archived);
      case 'stats':   return [];
      case 'daily':   return [];
      default:
        if (view.indexOf('cat:') === 0) {
          const c = view.slice(4);
          return alive.filter(x => x.cat === c);
        }
        return alive.slice();
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
    } else if (state.sort === 'manual') {
      arr.sort((a, b) => {
        const ao = a.order == null ? Number.MAX_SAFE_INTEGER : a.order;
        const bo = b.order == null ? Number.MAX_SAFE_INTEGER : b.order;
        if (ao !== bo) return ao - bo;
        return b.createdAt - a.createdAt;
      });
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

  function groupByDue(list, opts) {
    const t = todayStr();
    const g = [
      { label: '已逾期', items: [] },
      { label: '今天', items: [] },
      { label: '明天', items: [] },
      { label: '未来 7 天', items: [] },
      { label: '更晚', items: [] },
      { label: '没有日期', items: [] }
    ];
    const doneGroup = { label: '今天已完成', items: [] };
    list.forEach(x => {
      if (opts && opts.todayView && x.status === 'done') { doneGroup.items.push(x); return; }
      if (!x.due) g[5].items.push(x);
      else if (x.due < t) g[0].items.push(x);
      else if (x.due === t) g[1].items.push(x);
      else if (x.due === addDays(t, 1)) g[2].items.push(x);
      else if (x.due <= addDays(t, 7)) g[3].items.push(x);
      else g[4].items.push(x);
    });
    const out = g.filter(x => x.items.length);
    if (doneGroup.items.length) out.push(doneGroup);
    return out;
  }

  /* ---------------- 渲染：侧边栏计数 ---------------- */
  function counts() {
    const t = todayStr(), end = addDays(t, 7);
    const alive = state.tasks.filter(x => !x.archived);
    const open = alive.filter(x => x.status !== 'done');
    const doneToday = alive.filter(x =>
      x.status === 'done' && x.completedAt && ymd(new Date(x.completedAt)) === t
    ).length;

    const mb = calMonthBounds(todayStr().slice(0, 7));
    const c = {
      calendar: open.filter(x => x.due && x.due >= mb.from && x.due <= mb.to).length +
        state.daily.filter(x => !x.done && x.date >= mb.from && x.date <= mb.to).length,
      today: open.length + doneToday,
      week: open.filter(x => x.due && x.due >= t && x.due <= end).length,
      overdue: open.filter(x => x.due && x.due < t).length,
      inbox: open.length,
      done: alive.filter(x => x.status === 'done').length,
      archive: state.tasks.filter(x => x.archived).length,
      daily: state.daily.filter(x => x.date === t && !x.done).length
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
    const alive = state.tasks.filter(x => !x.archived);

    const openTotal = alive.filter(x => x.status !== 'done').length;
    const overdueN = alive.filter(x => x.status !== 'done' && x.due && x.due < t).length;
    const doingN = alive.filter(x => x.status === 'doing').length;
    const weekDoneN = alive.filter(x => x.status === 'done' && x.completedAt && x.completedAt >= wsTs).length;

    const cards = [
      { n: openTotal, label: '待办总数', icon: 'i-inbox', c: '#E05A4E', bg: '#FDECEA' },
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
    const alive = state.tasks.filter(x => !x.archived);
    const done = alive.filter(x => x.status === 'done' && x.completedAt && x.completedAt >= wsTs).length;
    const left = alive.filter(x => x.status !== 'done' && x.due && x.due >= ws && x.due <= we).length;
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

  /* 搜索命中词高亮（先转义再替换，避免把用户输入当 HTML） */
  function hl(text) {
    const safe = esc(text);
    const q = state.search.trim();
    if (!q) return safe;
    const qq = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      return safe.replace(new RegExp('(' + qq + ')', 'gi'), '<mark class="hl">$1</mark>');
    } catch (e) {
      return safe;
    }
  }

  function taskItemHTML(t) {
    const cat = CATS[t.cat];
    const prio = PRIOS[t.priority] || PRIOS[0];
    const subDone = t.subs.filter(s => s.done).length;
    const dcls = dueClass(t);
    const inArchive = state.view === 'archive';
    const manual = state.sort === 'manual' && state.layout === 'list';

    let meta = '';
    if (t.due) {
      meta += `<span class="t-due ${dcls}"><svg><use href="#i-calendar"/></svg>${esc(fmtDue(t.due, t.dueTime))}</span>`;
    }
    if (t.subs.length) {
      meta += `<span class="t-sub-progress"><svg><use href="#i-check"/></svg>${subDone}/${t.subs.length}</span>`;
    }
    if (t.hours) {
      meta += `<span><svg><use href="#i-clock"/></svg>${esc(fmtHours(t.hours))}</span>`;
    }
    if (t.tags.length) {
      meta += `<span><svg><use href="#i-tag"/></svg>${esc(t.tags.join(' · '))}</span>`;
    }
    if (t.repeat && t.repeat !== 'none') {
      meta += `<span title="重复：${REPEATS[t.repeat].name}，完成后自动生成下一期"><svg><use href="#i-repeat"/></svg>${REPEATS[t.repeat].name}</span>`;
    }
    if (inArchive && t.archivedAt) {
      meta += `<span>归档于 ${esc(fmtDateTime(t.archivedAt))}</span>`;
    }
    if (t.note) {
      meta += `<span class="t-note">${hl(t.note.replace(/\s+/g, ' '))}</span>`;
    }

    const actions = inArchive
      ? `<button data-act="restore" title="恢复到原清单"><svg><use href="#i-restore"/></svg></button>
         <button data-act="delete" title="彻底删除"><svg><use href="#i-trash"/></svg></button>`
      : `<button data-act="doing" title="标记为进行中"><svg><use href="#i-clock"/></svg></button>
         <button data-act="archive" title="归档（可在「归档」里找回）"><svg><use href="#i-archive"/></svg></button>`;

    const selected = state.sel.has(t.id);
    return `
      <div class="task ${t.status === 'done' ? 'done' : ''} ${t.status === 'doing' ? 'doing' : ''} ${inArchive ? 'archived-item' : ''} ${selected ? 'selected' : ''} ${state.navId === t.id ? 'nav-focus' : ''}"
           data-id="${t.id}" ${manual ? 'draggable="true"' : ''}>
        <button class="t-selbox" data-act="sel" title="选择（Shift+点击可连选）" tabindex="-1"><svg><use href="#i-check"/></svg></button>
        <button class="t-check" data-act="toggle" title="${t.status === 'done' ? '标记为未完成' : '标记完成'}"><svg><use href="#i-check"/></svg></button>
        <div class="t-main" data-act="open">
          <div class="t-row1">
            <span class="t-title">${t.title ? hl(t.title) : '<span style="color:var(--placeholder)">未命名任务</span>'}</span>
            ${t.priority ? `<span class="t-prio-tag" style="--pc:${prio.color};--pb:${prio.bg}">${prio.name}</span>` : ''}
            <span class="t-badge" style="--bc:${cat.color};--bc-bg:${cat.bg}">${cat.name}</span>
            ${t.status === 'doing' ? '<span class="t-badge" style="--bc:#B6741B;--bc-bg:#FDF3E4">进行中</span>' : ''}
          </div>
          ${meta ? `<div class="t-meta">${meta}</div>` : ''}
        </div>
        <div class="t-actions">${actions}</div>
      </div>`;
  }

  function fmtHours(h) {
    if (h == null) return '';
    return (Math.round(h * 10) / 10) + ' 小时';
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
      <div class="kcard ${t.status === 'done' ? 'done' : ''} ${state.navId === t.id ? 'nav-focus' : ''}" data-id="${t.id}" draggable="true">
        <div class="k-top">
          ${t.priority ? `<i class="k-prio" style="--pc:${prio.color}" title="优先级：${prio.name}"></i>` : ''}
          <div class="k-title">${t.title ? hl(t.title) : '<span style="color:var(--placeholder)">未命名任务</span>'}</div>
        </div>
        <div class="k-meta">${meta}</div>
      </div>`;
  }

  /* ---------------- 渲染：内容区 ---------------- */
  function renderContent() {
    const el = $('#content');

    // 统计是独立面板，不走任务列表那套
    if (state.view === 'stats') {
      el.innerHTML = renderStatsPanel();
      bindStatsPanel();
      return;
    }

    // 日历首页：月视图 + 选中日清单
    if (state.view === 'calendar') {
      el.innerHTML = renderCalendarPanel();
      bindCalendarPanel();
      return;
    }

    // 日常记录：独立面板，不跟任务列表混在一起
    if (state.view === 'daily') {
      el.innerHTML = renderDailyPanel();
      bindDailyPanel();
      return;
    }

    const list = currentList();
    const liveCount = state.tasks.filter(t => !t.archived).length;

    if (!liveCount && state.view !== 'archive') {
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
      const isArchive = state.view === 'archive';
      el.innerHTML = `
        <div class="empty">
          <div class="empty-art"><svg><use href="${searching ? '#i-search' : isArchive ? '#i-archive' : '#i-check-circle'}"/></svg></div>
          <h3>${searching ? '没有匹配的任务' : isArchive ? '归档是空的' : '这里已经清空了'}</h3>
          <p>${searching ? '换个关键词试试，或者清空搜索框。'
            : isArchive ? '删除的任务会先放到这里，随时能翻回来。' : '这个清单下暂时没有待办，保持住。'}</p>
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
      updateSelectingClass();
      return;
    }

    let html = '';

    if (state.view === 'done' && !state.search.trim()) {
      html += bulkBar('共 ' + list.length + ' 条已完成', 'btnClearDone', '归档这些已完成');
    }
    if (state.view === 'archive' && !state.search.trim()) {
      html += bulkBar('共 ' + list.length + ' 条归档', 'btnClearArchive', '清空归档');
    }
    if (state.sort === 'manual' && !state.search.trim()) {
      html += '<div class="manual-tip"><svg><use href="#i-list"/></svg>拖动任务可调整顺序，松手即保存</div>';
    }

    if (shouldGroup()) {
      const gs = state.view === 'done' ? groupByDone(list) : groupByDue(list, { todayView: state.view === 'today' });
      html += '<div class="task-list">' + gs.map(g => `
        <div class="group-head">${g.label} · ${g.items.length}<i></i></div>
        ${g.items.map(taskItemHTML).join('')}
      `).join('') + '</div>';
    } else {
      html += '<div class="task-list">' + list.map(taskItemHTML).join('') + '</div>';
    }

    if (state.sel.size) html += selBarHTML();

    el.innerHTML = html;
    updateSelectingClass();
    bindSelBar();

    bindBulk('btnClearDone', '归档这些已完成', function () {
      let n = 0;
      state.tasks.forEach(t => {
        if (!t.archived && t.status === 'done') {
          t.archived = true;
          t.archivedAt = Date.now();
          n++;
        }
      });
      save();
      renderAll();
      toast('已归档 ' + n + ' 条已完成任务');
    });

    bindBulk('btnClearArchive', '清空归档', function () {
      const n = state.tasks.filter(t => t.archived).length;
      state.tasks = state.tasks.filter(t => !t.archived);
      save();
      renderAll();
      toast('已彻底删除 ' + n + ' 条归档任务');
    });
  }

  function bulkBar(text, btnId, btnText) {
    return `<div class="bulk-bar"><span>${text}</span>
      <button class="btn-ghost danger" id="${btnId}">${btnText}</button></div>`;
  }

  /* ---------------- 批量选择 ---------------- */
  function toggleSelect(id, anchorMode) {
    if (state.layout === 'board') return; // 批量选择只在列表视图提供
    if (anchorMode && state.selAnchor) {
      // Shift 连选：从锚点到当前行（按当前列表顺序）
      const ids = currentList().map(t => t.id);
      const a = ids.indexOf(state.selAnchor), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => state.sel.add(x));
        renderContent();
        return;
      }
    }
    if (state.sel.has(id)) { state.sel.delete(id); state.selAnchor = null; }
    else { state.sel.add(id); state.selAnchor = id; }
    renderContent();
  }

  function clearSel() {
    if (!state.sel.size) return;
    state.sel.clear();
    state.selAnchor = null;
    renderContent();
  }

  function selectedTasks() {
    const alive = {};
    currentList().forEach(t => { alive[t.id] = t; });
    return Array.from(state.sel).map(id => alive[id]).filter(Boolean);
  }

  /* 批量选择时压住逐条重绘（quietOps 计数，renderAll 期间跳过） */
  let quietOps = 0;

  function updateSelectingClass() {
    document.body.classList.toggle('selecting', state.sel.size > 0);
  }

  function bulkAction(label, fn) {
    const list = selectedTasks();
    if (!list.length) { clearSel(); return; }
    quietOps++;
    try {
      list.forEach(fn);
    } finally {
      quietOps--;
    }
    save();
    clearSel();
    renderAll();
    toast('已对 ' + list.length + ' 条任务' + label);
  }

  function selBarHTML() {
    const inArchive = state.view === 'archive';
    const catMenu = CAT_KEYS.map(k =>
      `<button data-scat="${k}"><i class="dot" style="--c:${CATS[k].color};width:7px;height:7px;border-radius:50%;background:${CATS[k].color}"></i>${CATS[k].name}</button>`).join('');
    return `
      <div class="sel-bar" id="selBar">
        <span>已选 <b>${state.sel.size}</b> 条</span>
        ${inArchive ? '' : `
        <button data-sdo="complete"><svg><use href="#i-check"/></svg>完成</button>
        <div class="sel-menu">
          <button id="selCatBtn"><svg><use href="#i-dots"/></svg>改分类</button>
          <div class="sel-menu-pop" id="selCatPop" style="display:none">${catMenu}</div>
        </div>
        <button data-sdo="duetomorrow"><svg><use href="#i-calendar"/></svg>改期到明天</button>
        <div class="sel-menu">
          <button id="selDateBtn"><svg><use href="#i-calendar"/></svg>选日期</button>
          <input type="date" id="selDatePop" style="display:none;position:absolute;bottom:32px;left:0;z-index:40">
        </div>`}
        <button data-sdo="${inArchive ? 'delete' : 'archive'}"><svg><use href="#i-${inArchive ? 'trash' : 'archive'}"/></svg>${inArchive ? '彻底删除' : '归档'}</button>
        <span class="sep"></span>
        <button class="btn-cancel" data-sdo="clear">取消</button>
      </div>`;
  }

  function bindSelBar() {
    const bar = $('#selBar');
    if (!bar) return;
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-sdo]');
      if (b) {
        const act = b.getAttribute('data-sdo');
        if (act === 'clear') clearSel();
        else if (act === 'delete') {
          const ids = Array.from(state.sel);
          const n = ids.length;
          const now = Date.now();
          quietOps++;
          try {
            ids.forEach(id => {
              if (id in state.purged) return;
              state.purged[id] = now;
              const i = state.tasks.findIndex(t => t.id === id);
              if (i >= 0) state.tasks.splice(i, 1);
            });
          } finally { quietOps--; }
          save();
          clearSel();
          renderAll();
          toast('已彻底删除 ' + n + ' 条任务');
        }
        else if (act === 'complete') bulkAction('标记完成', t => {
          if (t.status !== 'done') setStatus(t.id, 'done');
        });
        else if (act === 'duetomorrow') bulkAction('改期到明天', t => { t.due = addDays(todayStr(), 1); });
        else if (act === 'archive') bulkAction('归档', t => { t.archived = true; t.archivedAt = Date.now(); });
        return;
      }
      const catBtn = e.target.closest('#selCatBtn');
      if (catBtn) {
        const pop = $('#selCatPop');
        pop.style.display = pop.style.display === 'none' ? 'flex' : 'none';
        return;
      }
      const cb = e.target.closest('[data-scat]');
      if (cb) {
        const k = cb.getAttribute('data-scat');
        bulkAction('移到「' + CATS[k].name + '」', t => { t.cat = k; });
        return;
      }
      const dateBtn = e.target.closest('#selDateBtn');
      if (dateBtn) {
        const pop = $('#selDatePop');
        if (pop.style.display === 'none') {
          pop.style.display = '';
          try { pop.showPicker ? pop.showPicker() : pop.focus(); } catch (err) { pop.focus(); }
        }
      }
    });
    const dp = $('#selDatePop');
    if (dp) dp.addEventListener('change', function () {
      if (!this.value) return;
      const v = this.value;
      bulkAction('改期到 ' + fmtDue(v), t => { t.due = v; });
    });
  }

  function bindBulk(id, label, action) {
    const btn = $('#' + id);
    if (!btn) return;
    btn.onclick = function () {
      if (btn.getAttribute('data-armed') === '1') { action(); return; }
      btn.setAttribute('data-armed', '1');
      btn.textContent = '再点一次确认';
      setTimeout(() => {
        if (!btn.isConnected) return;
        btn.removeAttribute('data-armed');
        btn.textContent = label;
      }, 4000);
    };
  }

  function shouldGroup() {
    return state.sort === 'smart' && state.layout === 'list' &&
      state.view !== 'archive' && !state.search.trim();
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

  /* ---------------- 渲染：分类统计 ---------------- */
  function statsRangeBounds(range) {
    const t = todayStr();
    if (range === 'week') {
      const from = startOfWeek(t);
      return { from: from, to: addDays(from, 6), label: '本周 ' + from.slice(5).replace('-', '/') + ' ~ ' + addDays(from, 6).slice(5).replace('-', '/') };
    }
    if (range === 'month') {
      const d = parseYmd(t);
      const from = ymd(new Date(d.getFullYear(), d.getMonth(), 1));
      const to = ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      return { from: from, to: to, label: (d.getMonth() + 1) + ' 月' };
    }
    return { from: null, to: null, label: '全部时间' };
  }

  function renderStatsPanel() {
    const b = statsRangeBounds(state.statsRange);
    const alive = state.tasks.filter(x => !x.archived);

    // 口径：已完成的按完成时间算，未完成的按截止日期算，都没有的按创建时间
    const inRange = alive.filter(x => {
      if (!b.from) return true;
      let ref;
      if (x.status === 'done' && x.completedAt) ref = ymd(new Date(x.completedAt));
      else ref = x.due || ymd(new Date(x.createdAt));
      return ref >= b.from && ref <= b.to;
    });

    const total = inRange.length;
    const doneN = inRange.filter(x => x.status === 'done').length;
    const doingN = inRange.filter(x => x.status === 'doing').length;
    const rate = total ? Math.round(doneN / total * 100) : 0;
    const totalHours = inRange.reduce((s, x) => s + (x.hours || 0), 0);
    const hasHours = totalHours > 0;

    const byCat = CAT_KEYS.map(k => {
      const items = inRange.filter(x => x.cat === k);
      const d = items.filter(x => x.status === 'done').length;
      const h = items.reduce((s, x) => s + (x.hours || 0), 0);
      return {
        k: k,
        n: items.length,
        done: d,
        rate: items.length ? Math.round(d / items.length * 100) : 0,
        hours: h
      };
    });

    const rangeBtn = (key, label) =>
      `<button data-range="${key}" class="${state.statsRange === key ? 'on' : ''}">${label}</button>`;

    return `
      <div class="sp-head">
        <div class="sp-range">
          ${rangeBtn('week', '本周')}${rangeBtn('month', '本月')}${rangeBtn('all', '全部')}
        </div>
        <div class="sp-range-label">${b.label} · 已完成按完成时间算，未完成按截止日期算</div>
      </div>

      <div class="sp-summary">
        <div class="sp-card">
          <span class="sp-card-label">任务总数</span>
          <strong>${total}</strong>
          <span class="sp-card-sub">进行中 ${doingN}</span>
        </div>
        <div class="sp-card">
          <span class="sp-card-label">已完成</span>
          <strong>${doneN}</strong>
          <span class="sp-card-sub">未完成 ${total - doneN}</span>
        </div>
        <div class="sp-card">
          <span class="sp-card-label">完成率</span>
          <strong>${rate}<small>%</small></strong>
          <div class="sp-mini-bar"><i style="width:${rate}%"></i></div>
        </div>
        <div class="sp-card">
          <span class="sp-card-label">累计耗时</span>
          <strong>${hasHours ? (Math.round(totalHours * 10) / 10) + '<small>h</small>' : '—'}</strong>
          <span class="sp-card-sub">${hasHours ? '按任务填写的耗时汇总' : '还没填过耗时'}</span>
        </div>
      </div>

      <div class="sp-cats">
        ${byCat.map(c => {
          const cat = CATS[c.k];
          return `
          <div class="sp-cat">
            <div class="sp-cat-head">
              <i class="dot" style="--c:${cat.color}"></i>
              <b>${cat.name}</b>
              <span class="sp-cat-num">${c.n} 项</span>
              <span class="sp-cat-done">完成 ${c.done}/${c.n}</span>
            </div>
            <div class="sp-bar-row">
              <span class="sp-bar-label">任务量</span>
              <div class="sp-bar"><i style="width:${total ? Math.round(c.n / total * 100) : 0}%;background:${cat.color}"></i></div>
              <span class="sp-bar-val">${total ? Math.round(c.n / total * 100) : 0}%</span>
            </div>
            <div class="sp-bar-row">
              <span class="sp-bar-label">耗时</span>
              <div class="sp-bar"><i style="width:${hasHours ? Math.round(c.hours / totalHours * 100) : 0}%;background:${cat.color};opacity:.6"></i></div>
              <span class="sp-bar-val">${c.hours ? (Math.round(c.hours * 10) / 10) + 'h' : '—'}</span>
            </div>
            <div class="sp-cat-rate">
              <div class="sp-rate-track"><i style="width:${c.rate}%;background:${cat.color}"></i></div>
              <span>完成率 ${c.rate}%</span>
            </div>
          </div>`;
        }).join('')}
      </div>

      <p class="sp-hint">
        ${hasHours
          ? '耗时统计来自任务详情里的「实际耗时」，未填写的不计入。'
          : '想按时间看工作重心，可以在任务详情里填「实际耗时」（单位：小时）。'}
        这里的统计不含归档任务。
      </p>`;
  }

  function bindStatsPanel() {
    $$('#content .sp-range button').forEach(b => {
      b.onclick = function () {
        state.statsRange = b.getAttribute('data-range');
        renderContent();
      };
    });
  }

  /* ---------------- 渲染：日历首页 ---------------- */
  function aliveOpen() {
    return state.tasks.filter(x => !x.archived && x.status !== 'done');
  }
  function calMonthBounds(ym) {
    const d = parseYmd(ym + '-01');
    return { from: ymd(d), to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
  }

  function monthMatrix(ym) {
    const ws = startOfWeek(ym + '-01'); // 周一为一周起点
    const rows = [];
    for (let w = 0; w < 6; w++) {
      const row = [];
      for (let i = 0; i < 7; i++) row.push(addDays(ws, w * 7 + i));
      // 周是连续的，第一次出现整周都不在本月即可停
      if (row[0].slice(0, 7) !== ym && row[6].slice(0, 7) !== ym) break;
      rows.push(row);
    }
    return rows;
  }

  /* 日历里的任务：未归档、有截止日期；重复任务额外铺出未来 3 期 */
  function calTasksByDay() {
    const map = {};
    const push = (day, t) => { (map[day] = map[day] || []).push(t); };
    state.tasks.forEach(t => {
      if (t.archived || !t.due) return;
      push(t.due, { t: t, virtual: false });
      if (t.repeat && t.repeat !== 'none' && t.status === 'done') {
        // 已完成、下一期还没生成：把未来 3 期虚拟铺出来（只读预览，点击落到真实任务上）
        const real = t.nextId && getTask(t.nextId) && !getTask(t.nextId).archived;
        if (!real) {
          let nd = t.due;
          for (let k = 0; k < 3; k++) {
            nd = nextRepeatDue(nd, t.repeat);
            if (!nd) break;
            push(nd, { t: t, virtual: true });
          }
        }
      }
    });
    Object.keys(map).forEach(day => {
      map[day].sort((a, b) => (a.virtual - b.virtual) || (b.t.status === 'done' - a.t.status === 'done') ||
        (a.t.dueTime || '99:99').localeCompare(b.t.dueTime || '99:99') || b.t.priority - a.t.priority);
    });
    return map;
  }

  function calChipHTML(item) {
    const t = item.t;
    const cat = CATS[t.cat];
    const label = (t.dueTime ? t.dueTime + ' ' : '') + (t.title || '未命名任务');
    return `<div class="cal-event ${t.status === 'done' ? 'done' : ''} ${item.virtual ? 'virtual' : ''}"
      data-id="${t.id}" data-virtual="${item.virtual ? 1 : 0}" draggable="${item.virtual ? 'false' : 'true'}"
      style="--cc:${cat.color}" title="${esc((item.virtual ? '（重复预览）' : '') + cat.name + ' · ' + label)}">
      <i class="cal-edot"></i>${esc(label)}</div>`;
  }

  /* 日历里的日常待办：按日期分组，未完成在前 */
  function calDailyByDay() {
    const map = {};
    state.daily.forEach(x => {
      if (!x.date) return;
      (map[x.date] = map[x.date] || []).push(x);
    });
    Object.keys(map).forEach(day => {
      map[day].sort((a, b) => {
        if (!!a.done !== !!b.done) return a.done ? 1 : -1;
        return (a.time || '99:99').localeCompare(b.time || '99:99');
      });
    });
    return map;
  }

  function calDailyChipHTML(x) {
    const label = (x.time ? x.time + ' ' : '') + (x.text || '日常待办');
    return `<div class="cal-event cal-daily${x.done ? ' done' : ''}" data-daily-id="${esc(x.id)}" draggable="true"
      title="${esc('日常待办 · ' + label)}"><i class="cal-edot"></i>${esc(label)}</div>`;
  }

  function renderCalendarPanel() {
    const ym = state.calMonth;
    const t = todayStr();
    if (!state.calSelDay || state.calSelDay.slice(0, 7) !== ym) state.calSelDay = t.slice(0, 7) === ym ? t : ym + '-01';
    const byDay = calTasksByDay();
    const dailyByDay = calDailyByDay();
    lunarCache = {}; // 换月/跨天后重算
    const monthLabel = ym.replace('-', ' 年 ') + ' 月';
    const wd = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

    const grid = monthMatrix(ym).map((row, ri) => `
      <div class="cal-week${ri === 0 ? ' first' : ''}">
        ${row.map((day, ci) => {
          const items = byDay[day] || [];
          const inMonth = day.slice(0, 7) === ym;
          const cls = ['cal-day'];
          if (!inMonth) cls.push('out');
          if (day === t) cls.push('today');
          if (day === state.calSelDay) cls.push('sel');
          if (ci >= 5) cls.push('weekend');
          const dayNum = Number(day.slice(8));
          const lunar = lunarCached(day);
          const lLabel = lunar ? (lunar.fest || lunar.label) : '';
          const lCls = lunar && lunar.fest ? ' fest' : '';
          const daily = dailyByDay[day] || [];
          const taskChips = items.slice(0, 4).map(calChipHTML);
          const dailyChips = taskChips.length < 4
            ? daily.slice(0, 4 - taskChips.length).map(calDailyChipHTML) : [];
          const restN = Math.max(0, items.length - taskChips.length) + Math.max(0, daily.length - dailyChips.length);
          const more = restN
            ? `<button class="cal-more" data-more="${day}">还有 ${restN} 项</button>` : '';
          return `<div class="${cls.join(' ')}" data-day="${day}">
            <div class="cal-day-head"><span class="cal-daynum">${dayNum}</span><span class="cal-lunar${lCls}" title="${lunar ? esc(lunar.month + lunar.dayName + (lunar.fest ? ' · ' + lunar.fest : '')) : ''}">${esc(lLabel)}</span></div>
            <div class="cal-events">${taskChips.join('')}${dailyChips.join('')}${more}</div>
          </div>`;
        }).join('')}
      </div>`).join('');

    const selItems = byDay[state.calSelDay] || [];
    const selDaily = dailyByDay[state.calSelDay] || [];
    const selDate = parseYmd(state.calSelDay);
    const selL = lunarCached(state.calSelDay);
    const selLunar = selL ? (selL.month + selL.dayName + (selL.fest ? ' · ' + selL.fest : '')) : '';
    const openN = selItems.filter(x => x.t.status !== 'done' && !x.virtual).length +
      selDaily.filter(x => !x.done).length;
    const liveCount = state.tasks.filter(x => !x.archived).length;
    const dayTasksHtml = selItems.length ? selItems.map(item => {
      const t2 = item.t;
      const cat = CATS[t2.cat];
      const prio = PRIOS[t2.priority] || PRIOS[0];
      const overdue = t2.status !== 'done' && t2.due < todayStr();
      return `
        <div class="cal-task ${t2.status === 'done' ? 'done' : ''}" data-id="${t2.id}" data-virtual="${item.virtual ? 1 : 0}">
          <button class="t-check" data-act="toggle" ${item.virtual ? 'disabled' : ''}><svg><use href="#i-check"/></svg></button>
          <div class="t-main" data-act="open">
            <span class="t-title">${esc(t2.title || '未命名任务')}</span>
            ${t2.dueTime ? `<span class="t-due"><svg><use href="#i-clock"/></svg>${esc(t2.dueTime)}</span>` : ''}
            ${t2.priority ? `<span class="t-prio-tag" style="--pc:${prio.color};--pb:${prio.bg}">${prio.name}</span>` : ''}
            <span class="t-badge" style="--bc:${cat.color};--bc-bg:${cat.bg}">${cat.name}</span>
            ${item.virtual ? '<span class="t-badge" style="--bc:var(--muted)">重复预览</span>' : ''}
            ${overdue ? '<span class="t-badge" style="--bc:#d9463c">已逾期</span>' : ''}
          </div>
        </div>`;
    }).join('') : `<div class="cal-day-empty"${selDaily.length ? ' style="padding:8px 2px"' : ''}>${liveCount ? '这一天没有任务。' : '还没有任务，先添加一条，或者载入几条示例看看各类工作怎么归类。'}
      <button class="btn-ghost" id="calAddDay" style="height:26px;font-size:12px;margin-left:8px">＋ 添加任务</button>
      ${liveCount ? '' : '<button class="btn-ghost" id="calDemo" style="height:26px;font-size:12px;margin-left:6px">载入示例数据</button>'}</div>`;

    const dayDailyHtml = selDaily.length ? selDaily.map(x => `
        <div class="cal-task cal-daily-row${x.done ? ' done' : ''}" data-daily-id="${esc(x.id)}">
          <button class="t-check" data-act="dtoggle" title="${x.done ? '标记未完成' : '标记完成'}"><svg><use href="#i-check"/></svg></button>
          <div class="t-main" data-act="dtext">
            <span class="t-title">${esc(x.text)}</span>
            ${x.time ? `<span class="t-due"><svg><use href="#i-clock"/></svg>${esc(x.time)}</span>` : ''}
            <span class="t-badge" style="--bc:var(--muted);--bc-bg:var(--track)">日常</span>
          </div>
          <button class="t-act-btn" data-act="ddel" title="删除这条日常待办"><svg><use href="#i-close"/></svg></button>
        </div>`).join('')
      : '<div class="cal-day-empty" style="padding:8px 2px">这一天没有日常待办。</div>';

    return `
      <div class="cal-wrap">
        <div class="cal-head">
          <div class="cal-nav">
            <button class="icon-btn" data-cal="prev" title="上个月"><svg><use href="#i-chev-l"/></svg></button>
            <b class="cal-month">${monthLabel}</b>
            <button class="icon-btn" data-cal="next" title="下个月"><svg><use href="#i-chev-r"/></svg></button>
            <button class="btn-ghost" data-cal="today" style="height:26px;font-size:12px;margin-left:6px">回到今天</button>
          </div>
          <div class="cal-legend">
            ${CAT_KEYS.map(k => `<span><i style="background:${CATS[k].color}"></i>${CATS[k].name}</span>`).join('')}
            <span><i class="cal-legend-daily"></i>日常待办</span>
          </div>
        </div>
        <div class="cal-grid" id="calGrid">
          <div class="cal-wdrow">${wd.map(x => `<div class="cal-wd">${x}</div>`).join('')}</div>
          ${grid}
          <p class="cal-tip">拖动任务 / 日常待办可改日期；点日期看当天安排；点日常待办的色条可直接勾掉。</p>
        </div>
        <div class="cal-daypanel" id="calDayPanel">
          <div class="cal-day-head2">
            <b>${Number(state.calSelDay.slice(8))} 日 · 周${'日一二三四五六'[selDate.getDay()]}${state.calSelDay === t ? '（今天）' : ''}<span class="cal-day-lunar">${esc(selLunar)}</span></b>
            <span>${openN ? openN + ' 项待办' : '没有待办'}</span>
          </div>
          <div class="cal-daylist">
            <div class="cal-sec-label">任务</div>
            ${dayTasksHtml}
            <div class="cal-sec-label daily">日常待办
              <span class="cal-sec-add-wrap"><input class="cal-sec-add" id="calDailyAdd" placeholder="＋ 加一条，回车保存"></span>
            </div>
            ${dayDailyHtml}
          </div>
        </div>
      </div>`;
  }

  function calShiftMonth(ym, delta) {
    const d = parseYmd(ym + '-01');
    d.setMonth(d.getMonth() + delta);
    return ymd(d).slice(0, 7);
  }

  function bindCalendarPanel() {
    $$('#content [data-cal]').forEach(b => {
      b.onclick = function () {
        const a = b.getAttribute('data-cal');
        if (a === 'prev') state.calMonth = calShiftMonth(state.calMonth, -1);
        else if (a === 'next') state.calMonth = calShiftMonth(state.calMonth, 1);
        else if (a === 'today') { state.calMonth = todayStr().slice(0, 7); state.calSelDay = todayStr(); }
        renderContent();
      };
    });

    const grid = $('#calGrid');
    if (!grid) return;

    grid.addEventListener('click', e => {
      const more = e.target.closest('[data-more]');
      if (more) { state.calSelDay = more.getAttribute('data-more'); renderContent(); scrollDayPanel(); return; }
      const dchip = e.target.closest('.cal-event.cal-daily');
      if (dchip) {
        // 日历上的日常待办：点一下 = 勾掉 / 取消勾掉
        toggleDailyDone(dchip.getAttribute('data-daily-id'));
        return;
      }
      const chip = e.target.closest('.cal-event');
      if (chip) {
        const id = chip.getAttribute('data-id');
        const dayEl = chip.closest('.cal-day');
        if (dayEl) state.calSelDay = dayEl.getAttribute('data-day'); // 点色片同时选中这天
        if (chip.getAttribute('data-virtual') === '1') {
          // 虚拟期：跳到真实任务并提示
          toast('这是重复任务的预览期，打开的是本期任务');
        }
        openTask(id);
        return;
      }
      const day = e.target.closest('.cal-day');
      if (day) {
        state.calSelDay = day.getAttribute('data-day');
        renderContent();
        scrollDayPanel();
      }
    });

    const addBtn = $('#calAddDay');
    if (addBtn) addBtn.onclick = () => openNew({ due: state.calSelDay });
    const demoBtn = $('#calDemo');
    if (demoBtn) demoBtn.onclick = () => loadDemo();

    // 当日面板：就地添加日常待办
    const dAdd = $('#calDailyAdd');
    if (dAdd) dAdd.addEventListener('keydown', function (e) {
      if (e.isComposing) return;
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const item = pushDaily(state.calSelDay, this.value);
      if (!item) { toast('先写点什么再加'); this.focus(); return; }
      renderAll();
      const nd = $('#calDailyAdd');
      if (nd) nd.focus();
      toast('已添加 · ' + dailyDateLabel(state.calSelDay).replace(/ · .*$/, '') + '的日常待办');
    });

    // 当日清单：勾选完成 / 打开详情 / 日常待办操作
    const panel = $('#calDayPanel');
    if (panel) panel.addEventListener('click', e => {
      const row = e.target.closest('.cal-task');
      if (!row) return;
      const btn = e.target.closest('[data-act]');
      const act = btn ? btn.getAttribute('data-act') : null;

      if (row.classList.contains('cal-daily-row')) {
        const id = row.getAttribute('data-daily-id');
        if (act === 'dtoggle') { toggleDailyDone(id); return; }
        if (act === 'ddel') { deleteDaily(id); return; }
        if (act === 'dtext') {
          const item = state.daily.find(x => x.id === id);
          const el = row.querySelector('.t-title');
          if (item && el && el.getAttribute('contenteditable') !== 'true') editDailyText(el, item);
        }
        return;
      }

      const id = row.getAttribute('data-id');
      const virtual = row.getAttribute('data-virtual') === '1';
      if (act === 'toggle') {
        if (virtual) { toast('预览期不能直接勾选，完成的是本期任务'); return; }
        toggleDone(id);
        return;
      }
      if (virtual) toast('这是重复任务的预览期，打开的是本期任务');
      openTask(id);
    });

    // 拖拽改期：任务改 due，日常待办改 date（dragId 前缀 D| 区分）
    grid.addEventListener('dragstart', e => {
      const dchip = e.target.closest('.cal-event.cal-daily');
      if (dchip) {
        dragId = 'D|' + dchip.getAttribute('data-daily-id');
        dchip.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', dragId); } catch (err) {}
        return;
      }
      const chip = e.target.closest('.cal-event');
      if (!chip || chip.getAttribute('data-virtual') === '1') return;
      dragId = chip.getAttribute('data-id');
      chip.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch (err) {}
    });
    grid.addEventListener('dragend', e => {
      const chip = e.target.closest('.cal-event');
      if (chip) chip.classList.remove('dragging');
      $$('.cal-day').forEach(d => d.classList.remove('drag-over'));
      dragId = null;
    });
    grid.addEventListener('dragover', e => {
      if (!dragId) return;
      const day = e.target.closest('.cal-day');
      if (!day) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      $$('.cal-day').forEach(d => d.classList.toggle('drag-over', d === day));
    });
    grid.addEventListener('drop', e => {
      const day = e.target.closest('.cal-day');
      const id = dragId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      $$('.cal-day').forEach(d => d.classList.remove('drag-over'));
      dragId = null;
      if (!day || !id) return;
      e.preventDefault();
      const target = day.getAttribute('data-day');

      // 日常待办：拖到某天 = 挪到那天
      if (id.indexOf('D|') === 0) {
        const it = state.daily.find(x => x.id === id.slice(2));
        if (!it || it.date === target) return;
        const oldDate = it.date;
        it.date = target;
        it.updatedAt = Date.now();
        saveDaily();
        state.calSelDay = target;
        renderAll();
        toast('日常待办已挪到 ' + fmtDue(target), {
          label: '撤销',
          onClick: function () { it.date = oldDate; it.updatedAt = Date.now(); saveDaily(); renderAll(); }
        });
        return;
      }

      const t = getTask(id);
      if (!t || t.due === target) return;
      const old = t.due;
      t.due = target;
      touch(t);
      state.calSelDay = target;
      renderAll();
      toast('已改期 ' + fmtDue(old) + ' → ' + fmtDue(target), {
        label: '撤销',
        onClick: function () { t.due = old; touch(t); renderAll(); }
      });
    });
  }

  function scrollDayPanel() {
    const p = $('#calDayPanel');
    if (p) p.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ---------------- 日常待办（独立于任务，不参与导出，但会出现在日历里） ---------------- */
  function dailyItems(q) {
    q = String(q || '').trim().toLowerCase();
    const list = q ? state.daily.filter(x => x.text.toLowerCase().indexOf(q) >= 0) : state.daily.slice();
    // 日期倒序；同一天内未完成在前，其余按记录时间正序
    return list.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      return (a.time || '').localeCompare(b.time || '') || (a.createdAt - b.createdAt);
    });
  }

  function dailyDateLabel(dateStr) {
    const t = todayStr();
    const d = parseYmd(dateStr);
    const md = (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
    const wk = '周' + weekdayCN(dateStr);
    if (dateStr === t) return '今天 · ' + md + ' ' + wk;
    if (dateStr === addDays(t, -1)) return '昨天 · ' + md + ' ' + wk;
    if (d.getFullYear() !== new Date().getFullYear()) return d.getFullYear() + ' 年 ' + md + ' ' + wk;
    return md + ' ' + wk;
  }

  function renderDailyPanel() {
    const list = dailyItems(state.search);
    const groups = [];
    list.forEach(x => {
      const last = groups[groups.length - 1];
      if (!last || last.date !== x.date) groups.push({ date: x.date, items: [x] });
      else last.items.push(x);
    });
    const todayList = state.daily.filter(x => x.date === todayStr());
    const todayOpen = todayList.filter(x => !x.done).length;
    const q = state.search.trim();

    let body;
    if (!list.length) {
      body = q
        ? `<div class="daily-empty"><b>没有匹配的待办</b><p>换个关键词，或者清空搜索框。</p></div>`
        : `<div class="daily-empty">
             <div class="daily-empty-ico"><svg><use href="#i-note"/></svg></div>
             <b>还没有日常待办</b>
             <p>把每天固定要做的小事放这儿——早会、日报、巡检、收拾工位。</p>
             <p class="daily-empty-warn">不占任务列表，不会进入 JSON / CSV 导出；但会显示在日历对应日期上。</p>
           </div>`;
    } else {
      body = groups.map(g => {
        const doneN = g.items.filter(x => x.done).length;
        return `
        <section class="daily-group">
          <div class="daily-ghead">
            <b>${esc(dailyDateLabel(g.date))}</b>
            <span>${doneN ? doneN + '/' : ''}${g.items.length}${doneN === g.items.length ? ' · 全部完成' : ''}</span>
          </div>
          ${g.items.map(x => `
            <div class="daily-item${x.done ? ' done' : ''}" data-id="${esc(x.id)}">
              <button class="daily-check" data-role="toggle" title="${x.done ? '标记未完成' : '标记完成'}"><svg><use href="#i-check"/></svg></button>
              <span class="daily-time">${esc(x.time || '—')}</span>
              <div class="daily-text" data-role="text" title="点击可编辑">${esc(x.text)}</div>
              <button class="daily-del" data-role="del" title="删除这条待办"><svg><use href="#i-close"/></svg></button>
            </div>`).join('')}
        </section>`;
      }).join('');
    }

    return `<div class="daily-wrap">
      <div class="daily-add">
        <div class="daily-add-head">
          <label for="dailyDate">加到</label>
          <input type="date" id="dailyDate" value="${esc(state.dailyDate)}">
          <span class="daily-today-hint">${todayOpen ? '今天还有 ' + todayOpen + ' 项没做' : (todayList.length ? '今天都完成了' : '今天还没有安排')}</span>
        </div>
        <div class="daily-input-row">
          <textarea id="dailyText" rows="1" placeholder="写一条日常待办，回车保存">${esc(state.dailyDraft)}</textarea>
          <button class="btn-primary" id="dailyAdd">添加</button>
        </div>
        <div class="daily-tip">Enter 保存 · Shift+Enter 换行 · 点正文可以就地修改</div>
      </div>
      ${body}
    </div>`;
  }

  function bindDailyPanel() {
    const wrap = $('.daily-wrap');
    if (!wrap) return;

    const ta = $('#dailyText');
    const dateEl = $('#dailyDate');

    function addItem() {
      const text = ta.value;
      const date = (dateEl && dateEl.value) || todayStr();
      const item = pushDaily(date, text);
      if (!item) { toast('先写点什么再加'); ta.focus(); return; }
      state.dailyDate = date;
      state.dailyDraft = '';
      renderAll();
      const nt = $('#dailyText');
      if (nt) nt.focus();
      const n = state.daily.filter(x => x.date === date).length;
      toast(date === todayStr()
        ? '已添加 · 今天第 ' + n + ' 项'
        : '已加到 ' + dailyDateLabel(date).replace(/ · .*$/, '') + ' · 该日 ' + n + ' 项');
    }

    if (dateEl) dateEl.addEventListener('change', function () { state.dailyDate = this.value || todayStr(); });
    if (ta) {
      ta.addEventListener('keydown', function (e) {
        if (e.isComposing) return; // 中文输入法组词时的回车不提交
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); addItem(); }
      });
      ta.addEventListener('input', function () {
        state.dailyDraft = this.value;
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      });
      if (state.dailyDraft) {
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
      }
    }
    const addBtn = $('#dailyAdd');
    if (addBtn) addBtn.addEventListener('click', addItem);

    wrap.addEventListener('click', function (e) {
      const tog = e.target.closest('[data-role="toggle"]');
      if (tog) {
        const row = tog.closest('.daily-item');
        if (row) toggleDailyDone(row.getAttribute('data-id'));
        return;
      }
      const del = e.target.closest('[data-role="del"]');
      if (del) {
        const row = del.closest('.daily-item');
        if (row) deleteDaily(row.getAttribute('data-id'));
        return;
      }
      const txt = e.target.closest('[data-role="text"]');
      if (txt && txt.getAttribute('contenteditable') !== 'true') {
        const row = txt.closest('.daily-item');
        const item = row && state.daily.find(x => x.id === row.getAttribute('data-id'));
        if (item) editDailyText(txt, item);
      }
    });
  }

  /* 点正文就地编辑：Enter 保存，Shift+Enter 换行，Esc 放弃 */
  function editDailyText(el, item) {
    const orig = item.text;
    el.setAttribute('contenteditable', 'true');
    el.classList.add('editing');
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    let done = false;
    function finish(save) {
      if (done) return;
      done = true;
      el.setAttribute('contenteditable', 'false');
      el.classList.remove('editing');
      const text = (el.innerText || el.textContent || '').replace(/\r/g, '').trim();
      if (!save || !text || text === orig) { el.textContent = orig; return; }
      item.text = text;
      item.updatedAt = Date.now();
      saveDaily();
      // 日历视图里格子里的色条也显示这条文字，需要整体重绘；日常视图只改了这一行，不重绘保住滚动位置
      if (state.view === 'calendar') renderAll();
      toast('已更新这条日常待办');
    }
    el.addEventListener('blur', function () { finish(true); }, { once: true });
    el.addEventListener('keydown', function (e) {
      if (e.isComposing) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); el.blur(); }
    });
  }

  function deleteDaily(id) {
    const idx = state.daily.findIndex(x => x.id === id);
    if (idx < 0) return;
    const item = state.daily.splice(idx, 1)[0];
    state.dailyPurged[id] = Date.now(); // 墓碑：别的标签页不会把它复活
    saveDaily();
    renderAll();
    toast('已删除一条日常待办', {
      label: '撤销',
      onClick: function () {
        // 撤销要压过墓碑：否则合并时会被当成「已删除」再删一次
        const ts = Number(state.dailyPurged[id] || 0);
        delete state.dailyPurged[id];
        item.updatedAt = Math.max(Date.now(), ts + 1);
        state.daily.push(item);
        saveDaily();
        renderAll();
        toast('已恢复');
      }
    });
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
    if (state.view === 'daily') {
      const q = state.search.trim();
      const todayOpen = state.daily.filter(x => x.date === todayStr() && !x.done).length;
      const doneAll = state.daily.filter(x => x.done).length;
      sub = '共 ' + state.daily.length + ' 项 · 今天 ' + todayOpen + ' 项未完成' +
        (doneAll ? ' · 累计完成 ' + doneAll + ' 项' : '') +
        (q ? ' · 搜索「' + q + '」命中 ' + dailyItems(q).length + ' 项' : '');
    } else if (state.search.trim()) {
      sub = '搜索「' + state.search.trim() + '」· 命中 ' + list.length + ' 条';
    } else if (state.view === 'stats') {
      sub = meta.sub;
    } else if (state.view === 'calendar') {
      const b = calMonthBounds(state.calMonth);
      const mOpen = aliveOpen().filter(x => x.due && x.due >= b.from && x.due <= b.to).length +
        state.daily.filter(x => !x.done && x.date >= b.from && x.date <= b.to).length;
      const mOver = aliveOpen().filter(x => x.due && x.due < todayStr()).length;
      sub = state.calMonth.replace('-', ' 年 ') + ' 月 · 本月 ' + mOpen + ' 项待办' + (mOver ? '，已逾期 ' + mOver + ' 项' : '');
    } else if (state.view === 'archive') {
      sub = meta.sub + ' · 共 ' + list.length + ' 条';
    } else {
      sub = sub + ' · 待办 ' + openN + ' 项' + (doneN ? '，已完成 ' + doneN + ' 项' : '');
    }
    $('#viewSub').textContent = sub;

    $$('#filters .chip').forEach(b => b.classList.toggle('on', b.getAttribute('data-status') === state.status));
    $$('#layoutSeg button').forEach(b => b.classList.toggle('on', b.getAttribute('data-layout') === state.layout));
    $('#sortBy').value = state.sort;
  }

  function renderAll() {
    if (quietOps) return; // 批量操作期间压住逐条重绘，结束后统一刷一次
    const isStats = state.view === 'stats';
    const isCal = state.view === 'calendar';
    const isDaily = state.view === 'daily';
    const liveCount = state.tasks.filter(t => !t.archived).length;
    // 统计面板自己就是统计；归档清单不再按状态筛选；没有数据时也不必摆一堆 0
    const hideToolbar = isStats || isCal || isDaily || state.view === 'archive' || liveCount === 0;
    const hideStatsBar = isStats || isCal || isDaily || liveCount === 0;

    const toolbar = $('.toolbar'), statsBar = $('#stats');
    if (toolbar) toolbar.style.display = hideToolbar ? 'none' : '';
    if (statsBar) statsBar.style.display = hideStatsBar ? 'none' : '';

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
      due: state.view === 'today' ? todayStr() : (state.view === 'calendar' ? state.calSelDay : null)
    }, patch || {}));
    ensureNewVisible(t);
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

  /* 新建的任务如果当前视图看不到，就切到能看到的视图，避免"加了却找不到" */
  function ensureNewVisible(t) {
    let switched = false;

    // 搜索中且新任务不命中当前关键词 -> 也会"加了看不见"，清掉搜索
    const q = state.search.trim().toLowerCase();
    if (q) {
      const hay = (t.title + ' ' + t.note + ' ' + t.tags.join(' ') + ' ' +
        t.subs.map(s => s.title).join(' ')).toLowerCase();
      if (hay.indexOf(q) < 0) {
        state.search = '';
        const s = $('#search');
        if (s) s.value = '';
      }
    }

    const v = state.view;
    if (v === 'calendar') {
      // 日历：切到任务日期所在月并选中它；没日期的任务去「今天」列表
      if (!t.due) {
        state.view = 'today';
        state.status = 'all';
        switched = true;
      } else {
        state.calMonth = t.due.slice(0, 7);
        state.calSelDay = t.due;
      }
      return switched;
    }

    const hidden = v === 'stats' || v === 'archive' || v === 'daily' || (v === 'done' && t.status !== 'done');
    if (hidden) {
      state.view = 'today';
      state.status = 'all';
      switched = true;
    }
    return switched;
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
        <label class="field-label">重复 <span style="color:var(--placeholder);font-weight:400">完成后自动生成下一期</span></label>
        <div class="opt-row" id="dRepeat">
          ${Object.keys(REPEATS).map(k => `<button class="opt ${t.repeat === k ? 'on' : ''}" data-r="${k}"${k === 'none' ? '' : ' style="--oc-bg:#EAF2FA;--oc-bd:#BFD8EE;--oc-fg:#2C6B9F"'}>${REPEATS[k].name}</button>`).join('')}
        </div>
      </div>

      <div class="field">
        <label class="field-label">标签</label>
        <input class="field-input" id="dTags" placeholder="用逗号分隔，例如：国网, 紧急" value="${esc(t.tags.join(', '))}">
      </div>

      <div class="field">
        <label class="field-label">实际耗时 <span style="color:#b0b6c0;font-weight:400">用于分类统计</span></label>
        <div class="hours-row">
          <input class="field-input" id="dHours" type="number" min="0" step="0.5"
                 value="${t.hours != null ? t.hours : ''}" placeholder="例如 2.5">
          <span class="hours-unit">小时</span>
        </div>
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

    $('#btnDelete').innerHTML = t.archived
      ? '<svg><use href="#i-trash"/></svg>彻底删除'
      : '<svg><use href="#i-archive"/></svg>归档';
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
    // 输入类改动只影响列表里的一行，没必要每个字符都重建整个列表
    // （任务多的时候逐字重绘会明显卡顿，这里合并到 180ms 一次）
    const refreshSoon = debounce(function () {
      renderContent();
      renderHeader();
    }, 180);

    const title = $('#dTitle');
    title.addEventListener('input', function () {
      t.title = title.value;
      autoGrow(title);
      touch(t);
      refreshSoon();
    });

    $('#dStatus').addEventListener('click', e => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      const s = b.getAttribute('data-s');
      setStatus(t.id, s);
      $$('#dStatus .opt').forEach(x => x.classList.toggle('on', x === b));
      $('#drawerCrumb').innerHTML = '<span style="color:' + CATS[t.cat].color + '">●</span> ' + CATS[t.cat].name + (s === 'done' ? ' · 已完成' : '');
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

    $('#dRepeat').addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      t.repeat = b.getAttribute('data-r');
      if (t.repeat !== 'none') t.nextId = null; // 换周期后重新计算下一期
      touch(t);
      $$('#dRepeat .opt').forEach(x => x.classList.toggle('on', x === b));
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
      refreshSoon();
    });

    $('#dHours').addEventListener('input', function () {
      const v = this.value.trim();
      t.hours = v === '' ? null : Math.max(0, Number(v) || 0);
      touch(t);
      refreshSoon();
    });

    $('#dNote').addEventListener('input', function () {
      t.note = this.value;
      touch(t);
      refreshSoon();
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

  /* 快速添加里的 #标签 */
  function extractTags(text) {
    const tags = [];
    const rest = text.replace(/(^|\s)#([^\s#]+)/g, function (m, pre, tag) {
      tags.push(tag);
      return pre;
    }).replace(/\s+/g, ' ').trim();
    return { tags: tags, rest: rest };
  }

  /* 解析并创建一行快速添加；返回 null=空行，false=只有标记没有标题 */
  function quickAddOne(raw) {
    const text = (raw || '').trim();
    if (!text) return null;
    const tg = extractTags(text);
    const r = extractDate(tg.rest);
    const pr = extractPriority(r.rest);
    const title = pr.rest.replace(/^[\s,，、]+|[\s,，、]+$/g, '');
    if (!title) return false;

    const fromView = state.view;
    const cat = fromView.indexOf('cat:') === 0 ? fromView.slice(4) : 'other';
    let due = r.due;
    if (!due && fromView === 'today') due = todayStr();
    if (!due && fromView === 'calendar') due = state.calSelDay;

    return addTask({ title: title, cat: cat, due: due, priority: pr.p, tags: tg.tags });
  }

  function quickAdd(raw) {
    const lines = String(raw || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return;
    const results = lines.map(quickAddOne);
    const added = results.filter(t => t);
    if (!added.length) { toast('请输入任务内容'); clearQuickAdd(); return; }

    clearQuickAdd();
    const first = added[0];
    const switched = ensureNewVisible(first);

    renderAll();
    toast((added.length > 1 ? '已批量添加 ' + added.length + ' 条任务'
      : '已添加' + (first.due ? ' · 截止 ' + fmtDue(first.due) : '') +
        (first.priority ? ' · 优先级 ' + PRIOS[first.priority].name : '')) +
      (switched ? ' · 已切到「今天」' : ''));
  }

  function clearQuickAdd() {
    const q = $('#quickAdd');
    if (!q) return;
    q.value = '';
    q.style.height = 'auto';
    const box = q.closest('.quick-add');
    if (box) box.classList.remove('multiline');
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
    const data = { version: APP_VER, exportedAt: new Date().toISOString(), tasks: state.tasks, purged: state.purged };
    download('任务清单备份-' + todayStr() + '.json', JSON.stringify(data, null, 2), 'application/json');
    toast('已导出 ' + state.tasks.length + ' 条任务');
  }

  /* ---------------- CSV 导出：时间范围 ---------------- */
  function csvRangeBounds(dlg) {
    const t = todayStr();
    if (dlg.range === 'week') {
      const f = startOfWeek(t);
      return { from: f, to: addDays(f, 6), label: '本周' };
    }
    if (dlg.range === 'month') {
      const d = parseYmd(t);
      return { from: ymd(new Date(d.getFullYear(), d.getMonth(), 1)),
               to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)), label: '本月' };
    }
    if (dlg.range === 'lastmonth') {
      const d = parseYmd(t);
      return { from: ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)),
               to: ymd(new Date(d.getFullYear(), d.getMonth(), 0)), label: '上月' };
    }
    if (dlg.range === 'custom') {
      let from = dlg.from || null, to = dlg.to || null;
      if (from && to && from > to) { const s = from; from = to; to = s; }
      if (!from && !to) return { from: null, to: null, label: '全部' };
      return { from: from, to: to, label: (from || '不限') + '~' + (to || '不限') };
    }
    return { from: null, to: null, label: '全部' };
  }

  /* 筛选口径：completed/due 没有该时间的任务不导出；smart 与分类统计一致 */
  function csvRefDate(t, field) {
    if (field === 'completed') return t.completedAt ? ymd(new Date(t.completedAt)) : null;
    if (field === 'due') return t.due || null;
    if (field === 'created') return ymd(new Date(t.createdAt));
    if (t.status === 'done' && t.completedAt) return ymd(new Date(t.completedAt));
    return t.due || ymd(new Date(t.createdAt));
  }

  function filterTasksForExport(dlg) {
    const b = csvRangeBounds(dlg);
    if (!b.from && !b.to) return state.tasks.filter(t => dlg.archived || !t.archived);
    return state.tasks.filter(t => {
      if (!dlg.archived && t.archived) return false;
      const ref = csvRefDate(t, dlg.field);
      if (!ref) return false;
      if (b.from && ref < b.from) return false;
      if (b.to && ref > b.to) return false;
      return true;
    });
  }

  function exportCSV(dlg) {
    dlg = dlg || { range: 'all', field: 'smart', archived: true };
    const b = csvRangeBounds(dlg);
    const list = filterTasksForExport(dlg);
    if (!list.length) { toast('这个范围内没有任务'); return false; }

    const head = ['标题', '分类', '状态', '优先级', '截止日期', '截止时间', '重复', '实际耗时(小时)', '标签', '子任务', '备注', '创建时间', '完成时间', '是否归档'];
    const rows = list.map(t => [
      t.title,
      CATS[t.cat].name,
      STATUS_NAME[t.status],
      PRIOS[t.priority].name,
      t.due || '',
      t.dueTime || '',
      t.repeat && t.repeat !== 'none' ? REPEATS[t.repeat].name : '',
      t.hours != null ? t.hours : '',
      t.tags.join(' / '),
      t.subs.map(s => (s.done ? '✓' : '○') + s.title).join(' | '),
      t.note.replace(/\r?\n/g, ' '),
      fmtDateTime(t.createdAt),
      t.completedAt ? fmtDateTime(t.completedAt) : '',
      t.archived ? '是' : ''
    ]);
    const csv = '\ufeff' + [head].concat(rows).map(r =>
      r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')
    ).join('\r\n');
    const suffix = dlg.range === 'all' ? todayStr() : b.label;
    download('任务清单-' + suffix + '.csv', csv, 'text/csv;charset=utf-8');
    toast('已导出 ' + list.length + ' 条任务（' + b.label + '）');
    return true;
  }

  /* 导出弹窗 */
  function readCsvDialog() {
    const on = $('#csvRange .opt.on');
    return {
      range: on ? on.getAttribute('data-range') : 'all',
      from: $('#csvFrom').value || null,
      to: $('#csvTo').value || null,
      field: $('#csvField').value || 'smart',
      archived: $('#csvArchived').checked
    };
  }

  function updateCsvCount() {
    const n = filterTasksForExport(readCsvDialog()).length;
    const el = $('#csvCount');
    el.innerHTML = n ? '将导出 <b>' + n + '</b> 条任务'
      : '<span class="csv-warn">这个范围内没有任务，换个范围或时间字段试试</span>';
    $('#csvGo').disabled = !n;
  }

  function openCsvDialog() {
    $$('#csvRange .opt').forEach(x => x.classList.toggle('on', x.getAttribute('data-range') === 'all'));
    $('#csvCustom').style.display = 'none';
    $('#csvFrom').value = '';
    $('#csvTo').value = '';
    $('#csvField').value = 'smart';
    $('#csvArchived').checked = true;
    updateCsvCount();
    $('#csvMask').classList.add('show');
  }

  function closeCsvDialog() { $('#csvMask').classList.remove('show'); }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(reader.result);
        const list = Array.isArray(data) ? data : (data && data.tasks) || [];
        const incoming = list.map(normalizeTask).filter(Boolean);
        if (!incoming.length) { toast('文件里没有可导入的任务'); return; }

        // 导入文件的墓碑（彻底删除记录）：晚于它的同名任务不会被"复活"
        const purge = (data && data.purged && typeof data.purged === 'object') ? data.purged : {};
        Object.keys(purge).forEach(id => {
          const ts = Number(purge[id]) || 0;
          if (!(id in state.purged) || Number(state.purged[id]) < ts) state.purged[id] = ts;
        });
        const cur = {};
        state.tasks.forEach(t => { cur[t.id] = t; });
        Object.keys(purge).forEach(id => {
          const t = cur[id];
          if (t && (purge[id] || 0) >= (t.updatedAt || 0)) state.tasks.splice(state.tasks.indexOf(t), 1);
        });

        let added = 0, updated = 0, skipped = 0;
        const map = {};
        state.tasks.forEach(t => { map[t.id] = t; });
        incoming.forEach(t => {
          if (t.id in state.purged && state.purged[t.id] >= (t.updatedAt || 0)) { skipped++; return; }
          const exist = map[t.id];
          if (!exist) { state.tasks.push(t); map[t.id] = t; added++; }
          else if ((t.updatedAt || 0) > (exist.updatedAt || 0)) {
            Object.keys(t).forEach(k => { exist[k] = t[k]; }); // 新者胜
            updated++;
          } else skipped++;
        });
        save();
        renderAll();
        toast('导入完成：新增 ' + added + ' 条' +
          (updated ? '，更新 ' + updated + ' 条' : '') +
          (skipped ? '，跳过 ' + skipped + ' 条（本地更新或已删除）' : ''));
      } catch (e) {
        toast('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  /* ---------------- 每日提醒 ---------------- */
  const REMIND_KEY = 'work-tasks.remind.v1';

  function loadRemind() {
    try {
      return Object.assign({ enabled: false, last: null }, JSON.parse(localStorage.getItem(REMIND_KEY) || '{}'));
    } catch (e) {
      return { enabled: false, last: null };
    }
  }

  function saveRemind(r) {
    try { localStorage.setItem(REMIND_KEY, JSON.stringify(r)); } catch (e) { /* 忽略 */ }
  }

  let remind = loadRemind();

  function updateRemindBtn() {
    const btn = $('#btnRemind');
    if (!btn) return;
    const supported = 'Notification' in window;
    const on = remind.enabled && supported && Notification.permission === 'granted';
    btn.classList.toggle('active', on);
    btn.title = !supported
      ? '当前浏览器不支持桌面通知'
      : on ? '每日 9 点提醒已开启（点击关闭）' : '开启每日 9 点提醒';
  }

  function toggleRemind() {
    if (!('Notification' in window)) {
      toast('当前浏览器不支持桌面通知');
      return;
    }
    if (remind.enabled) {
      remind.enabled = false;
      saveRemind(remind);
      updateRemindBtn();
      toast('已关闭每日提醒');
      return;
    }
    Notification.requestPermission().then(function (p) {
      if (p === 'granted') {
        remind.enabled = true;
        remind.last = null;
        saveRemind(remind);
        updateRemindBtn();
        toast('已开启：每天 9 点后打开页面会提醒今日待办');
        checkRemind(true);
      } else {
        toast('通知权限被拒绝，可在地址栏左侧的站点设置里重新允许');
      }
    }).catch(function () {
      toast('无法请求通知权限');
    });
  }

  function checkRemind(force) {
    if (!remind.enabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const now = new Date();
    if (now.getHours() < 9 && !force) return;   // 9 点前不打扰

    const t = todayStr();
    if (remind.last === t && !force) return;    // 一天只提醒一次

    const alive = state.tasks.filter(x => !x.archived && x.status !== 'done');
    const dueToday = alive.filter(x => x.due === t);
    const overdue = alive.filter(x => x.due && x.due < t);
    if (!dueToday.length && !overdue.length) return;

    const parts = [];
    if (dueToday.length) parts.push('今天 ' + dueToday.length + ' 项待办');
    if (overdue.length) parts.push(overdue.length + ' 项已逾期');
    const body = parts.join('，') + '\n' +
      dueToday.concat(overdue).slice(0, 5).map(x => '· ' + x.title).join('\n');

    try {
      const n = new Notification('今日工作提醒', { body: body, tag: 'work-tasks-daily' });
      n.onclick = function () { window.focus(); };
    } catch (e) { /* 某些环境需要 service worker，忽略 */ }

    remind.last = t;
    saveRemind(remind);
  }

  /* ---------------- 打印：A4 周计划 ---------------- */
  function printWeek() {
    const t = todayStr();
    const ws = startOfWeek(t);
    const dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const alive = state.tasks.filter(x => !x.archived);

    const rows = dayNames.map(function (name, i) {
      const d = addDays(ws, i);
      const items = alive.filter(x => x.due === d).sort(function (a, b) {
        if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
        return (a.dueTime || '99:99') < (b.dueTime || '99:99') ? -1 : 1;
      });
      return `
        <div class="ps-day ${d === t ? 'ps-today' : ''}">
          <div class="ps-day-head">
            <b>${name}</b>
            <span>${d.slice(5).replace('-', '/')}</span>
            <em>${items.length ? items.length + ' 项' : ''}</em>
          </div>
          <div class="ps-day-body">
            ${items.length ? items.map(x => `
              <div class="ps-item ${x.status === 'done' ? 'ps-done' : ''}">
                <i class="ps-box"></i>
                <span class="ps-time">${x.dueTime || ''}</span>
                <span class="ps-title">${esc(x.title)}</span>
                <span class="ps-cat" style="color:${CATS[x.cat].color}">${CATS[x.cat].name}</span>
              </div>`).join('') : '<div class="ps-empty">—</div>'}
          </div>
        </div>`;
    }).join('');

    const undated = alive.filter(x => !x.due && x.status !== 'done');
    const openN = alive.filter(x => x.status !== 'done').length;

    $('#printSheet').innerHTML = `
      <div class="ps-page">
        <div class="ps-head">
          <div>
            <h1>本周工作计划</h1>
            <p>${ws.replace(/-/g, '/')} — ${addDays(ws, 6).replace(/-/g, '/')}</p>
          </div>
          <div class="ps-meta">
            <span>待办 ${openN} 项</span>
            <span>打印于 ${fmtDateTime(Date.now())}</span>
          </div>
        </div>
        <div class="ps-grid">${rows}</div>
        ${undated.length ? `
          <div class="ps-undated">
            <b>未排期（${undated.length} 项）</b>
            ${undated.map(x => `<span>· ${esc(x.title)}</span>`).join('')}
          </div>` : ''}
      </div>`;

    window.print();
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

  /* ---------------- 键盘导航 ---------------- */
  function navList() {
    return currentList().map(t => t.id);
  }

  function navMove(delta) {
    const ids = navList();
    if (!ids.length) return;
    let i = state.navId ? ids.indexOf(state.navId) : -1;
    if (i < 0) i = delta > 0 ? -1 : ids.length;
    i = Math.max(0, Math.min(ids.length - 1, i + delta));
    state.navId = ids[i];
    renderContent();
    const el = $('.task[data-id="' + state.navId + '"], .kcard[data-id="' + state.navId + '"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function navAction(key) {
    if (!state.navId) return false;
    const t = getTask(state.navId);
    if (!t) { state.navId = null; return false; }
    if (key === 'enter') { state.navId && openTask(state.navId); return true; }
    if (key === 'space') { toggleDone(state.navId); return true; }
    if (key === 's') { toggleSelect(state.navId, false); return true; }
    if (key === 'delete' || key === 'backspace') {
      if (state.view === 'archive') deleteForever(state.navId);
      else archiveTask(state.navId);
      state.navId = null;
      return true;
    }
    return false;
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
      state.sel.clear();
      state.selAnchor = null;
      state.navId = null;
      $('#search').value = '';
      renderAll();
      $('#content').scrollTop = 0;
      $('#sidebar').classList.remove('show');
      $('#sidebarMask').classList.remove('show');
      // 进日常记录就把光标放进输入框，省一次点击（放在这里而不是渲染里，避免抢搜索框焦点）
      if (state.view === 'daily') { const dt = $('#dailyText'); if (dt) dt.focus(); }
    });

    // 快速添加（textarea：Enter 提交，Shift+Enter / 粘贴多行 = 批量添加）
    const qa = $('#quickAdd');
    qa.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        // 粘贴产生的多行内容，回车 = 批量提交；手动 Shift+Enter 换行后回车同样提交全部
        e.preventDefault();
        quickAdd(qa.value);
      }
    });
    qa.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 160) + 'px';
      this.closest('.quick-add').classList.toggle('multiline', this.value.indexOf('\n') >= 0);
    });
    qa.addEventListener('paste', function () {
      const v = this.value;
      setTimeout(() => {
        if (this.value.indexOf('\n') >= 0 || this.value !== v) {
          this.style.height = 'auto';
          this.style.height = Math.min(this.scrollHeight, 160) + 'px';
          this.closest('.quick-add').classList.add('multiline');
        }
      }, 0);
    });
    $('#quickAddBtn').addEventListener('click', () => quickAdd(qa.value));

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
      if (act === 'sel') { toggleSelect(id, e.shiftKey); return; }
      if (act === 'archive') { archiveTask(id); return; }
      if (act === 'delete') { deleteForever(id); return; }
      if (act === 'restore') { restoreTask(id); return; }
      if (act === 'doing') { setStatus(id, 'doing'); return; }
      if (act === 'add-to') {
        openNew({ status: btn.getAttribute('data-status'), cat: state.view.indexOf('cat:') === 0 ? state.view.slice(4) : 'other' });
        return;
      }
      state.navId = id;
      openTask(id);
    });

    // 拖拽：看板换状态 / 手动排序调整顺序
    const content = $('#content');

    content.addEventListener('dragstart', e => {
      const card = e.target.closest('.kcard');
      if (card) {
        dragId = card.getAttribute('data-id');
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', dragId); } catch (err) {}
        return;
      }
      const row = e.target.closest('.task[draggable="true"]');
      if (row) {
        dragId = row.getAttribute('data-id');
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', dragId); } catch (err) {}
      }
    });

    content.addEventListener('dragend', e => {
      const card = e.target.closest('.kcard');
      if (card) card.classList.remove('dragging');
      const row = e.target.closest('.task');
      if (row) row.classList.remove('dragging');
      $$('.board-col').forEach(c => c.classList.remove('drag-over'));
      $$('.task').forEach(el => el.classList.remove('drop-before', 'drop-after'));
      dragId = null;
    });

    content.addEventListener('dragover', e => {
      if (!dragId) return;

      // 看板列
      const col = e.target.closest('.board-col');
      if (col) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        $$('.board-col').forEach(c => c.classList.toggle('drag-over', c === col));
        return;
      }

      // 手动排序：在目标行上标出插入位置
      const row = e.target.closest('.task');
      if (row && state.sort === 'manual' && state.layout === 'list') {
        if (row.getAttribute('data-id') === dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = row.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        $$('.task').forEach(el => el.classList.remove('drop-before', 'drop-after'));
        row.classList.add(after ? 'drop-after' : 'drop-before');
      }
    });

    content.addEventListener('dragleave', e => {
      const col = e.target.closest('.board-col');
      if (col && !col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });

    content.addEventListener('drop', e => {
      const id = dragId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      const col = e.target.closest('.board-col');

      // 看板：换状态
      if (col) {
        e.preventDefault();
        col.classList.remove('drag-over');
        dragId = null;
        if (!id) return;
        const t = getTask(id);
        if (!t) return;
        const s = col.getAttribute('data-status');
        if (t.status !== s) {
          setStatus(id, s);
          toast('已移到「' + STATUS_NAME[s] + '」');
        }
        return;
      }

      // 列表：手动排序
      const row = e.target.closest('.task');
      if (!row || !id || state.sort !== 'manual') { dragId = null; return; }
      e.preventDefault();
      const after = row.classList.contains('drop-after');
      const targetId = row.getAttribute('data-id');
      dragId = null;
      $$('.task').forEach(el => el.classList.remove('drop-before', 'drop-after'));
      if (targetId && targetId !== id) reorderTasks(id, targetId, after);
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
        subs: src.subs.map(s => ({ id: uid(), title: s.title, done: false })),
        repeat: src.repeat
      });
      state.isNew = false;
      state.editingId = copy.id;
      renderAll();
      renderDrawer(copy);
      toast('已复制为新任务');
    });
    $('#btnDelete').addEventListener('click', () => {
      const t = getTask(state.editingId);
      if (!t) return;
      const wasArchived = t.archived;
      state.editingId = null;
      state.isNew = false;
      $('#drawerMask').classList.remove('show');
      $('#drawer').classList.remove('show');
      if (wasArchived) deleteForever(t.id);
      else archiveTask(t.id);
    });

    // 导出导入
    $('#btnExport').addEventListener('click', exportJSON);
    $('#btnExportCsv').addEventListener('click', openCsvDialog);

    // CSV 导出弹窗
    $('#csvClose').addEventListener('click', closeCsvDialog);
    $('#csvCancel').addEventListener('click', closeCsvDialog);
    $('#csvMask').addEventListener('click', e => {
      if (e.target === $('#csvMask')) closeCsvDialog();
    });
    $('#csvRange').addEventListener('click', e => {
      const b = e.target.closest('[data-range]');
      if (!b) return;
      $$('#csvRange .opt').forEach(x => x.classList.toggle('on', x === b));
      $('#csvCustom').style.display = b.getAttribute('data-range') === 'custom' ? '' : 'none';
      updateCsvCount();
    });
    ['#csvFrom', '#csvTo', '#csvField', '#csvArchived'].forEach(sel => {
      $(sel).addEventListener('change', updateCsvCount);
    });
    $('#csvGo').addEventListener('click', function () {
      if (exportCSV(readCsvDialog())) closeCsvDialog();
    });
    $('#btnPrint').addEventListener('click', printWeek);
    $('#btnRemind').addEventListener('click', toggleRemind);
    $('#btnTheme').addEventListener('click', cycleTheme);
    if (darkQuery) {
      const onThemeMedia = () => { if (state.theme === 'auto') applyTheme(); };
      if (darkQuery.addEventListener) darkQuery.addEventListener('change', onThemeMedia);
      else if (darkQuery.addListener) darkQuery.addListener(onThemeMedia);
    }
    $('#btnImport').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', function () {
      if (this.files && this.files[0]) importJSON(this.files[0]);
      this.value = '';
    });

    // 帮助
    $('#btnHelp').addEventListener('click', () => {
      renderBackupInfo();
      $('#helpMask').classList.add('show');
    });
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
        if ($('#csvMask').classList.contains('show')) { closeCsvDialog(); return; }
        if (state.editingId) { closeDrawer(); return; }
        if (state.sel.size) { clearSel(); return; }
        if (document.activeElement === $('#quickAdd')) { $('#quickAdd').blur(); return; }
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
            setStatus(t.id, map[e.key]);
            renderDrawer(t);
          }
          return;
        }
        return;
      }

      if (typing) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); $('#quickAdd').focus(); }
      else if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); navMove(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); navMove(-1); }
      else if (state.navId && (e.key === 'Enter' || e.key === ' ' || e.key.toLowerCase() === 's' ||
               e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        navAction(e.key === ' ' ? 'space' : e.key.toLowerCase() === 'enter' ? 'enter' : e.key.toLowerCase());
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  let inited = false;
  function init() {
    if (inited) return;
    inited = true;

    const store = load();
    state.tasks = store.tasks;
    state.purged = store.purged;

    const daily = loadDaily();
    state.daily = daily.items;
    state.dailyPurged = daily.purged;

    Object.assign(state, loadPrefs());
    state.sel.clear();
    remind = loadRemind();
    bindEvents();
    applyTheme();
    renderAll();
    saveBackup();
    updateRemindBtn();
    checkRemind();

    // 每分钟检查一次：跨零点刷新「今天」，到点发提醒
    let lastDay = todayStr();
    setInterval(() => {
      const d = todayStr();
      if (d !== lastDay) { lastDay = d; renderAll(); }
      checkRemind();
    }, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
