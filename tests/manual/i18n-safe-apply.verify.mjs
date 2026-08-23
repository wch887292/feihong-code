/**
 * 飞虹 Code (Muse Code 参照复刻)
 * 晋江市飞虹智科技企业管理有限公司 · 飞扬企源研发中心 · 负责人：吴赐虹
 *
 * 回归验证：applyI18nToEl 不得摧毁子元素。
 *
 * 背景（真实线上故障）：早期 switchLang 对所有 [data-i18n] 元素无条件写
 * textContent，导致：
 *   1. <select id="modelSelect"> 的全部 <option> 被清空 —— 表现为「大模型
 *      下拉打不开、无法切换模型」；
 *   2. 侧边栏 .sidebar-icon 内的图标 span 与标签 span 被一起擦掉。
 * 本脚本用极简假 DOM 复现这两类高危结构，断言多次中英切换后子元素完好。
 *
 * 运行：node tests/manual/i18n-safe-apply.verify.mjs
 */
const I18N = {
  zh: {
    'footbar.model': '大模型',
    'title.modelSelect': '切换当前使用的大模型',
    'ph.goalInput': '输入指令…',
    'sidebar.chat': '对话任务',
  },
  en: {
    'footbar.model': 'Model',
    'title.modelSelect': 'Switch the active LLM',
    'ph.goalInput': 'Type an instruction…',
    'sidebar.chat': 'Chat Tasks',
  },
};
let currentLang = 'zh';
const t = (k) => (I18N[currentLang] || I18N.zh)[k] || k;

/** 极简元素：textContent 的 setter 故意会清空 childNodes，用于暴露旧实现的破坏性 */
function mkEl(tag, attrs = {}, children = []) {
  return {
    tagName: tag.toUpperCase(),
    _attrs: { ...attrs },
    childNodes: [...children],
    get firstElementChild() {
      return this.childNodes.find((n) => n.nodeType !== 3) || null;
    },
    getAttribute(n) {
      return this._attrs[n] ?? null;
    },
    hasAttribute(n) {
      return n in this._attrs;
    },
    get placeholder() {
      return this._attrs.placeholder;
    },
    set placeholder(v) {
      this._attrs.placeholder = v;
    },
    get title() {
      return this._attrs.title;
    },
    set title(v) {
      this._attrs.title = v;
    },
    get id() {
      return this._attrs.id || '';
    },
    set textContent(v) {
      this.childNodes = [{ nodeType: 3, nodeValue: v }];
    },
  };
}
const txt = (v) => ({ nodeType: 3, nodeValue: v });

/** 被测实现，与 src/web/public/index.html 内的 applyI18nToEl 保持一致 */
function applyI18nToEl(el) {
  const key = el.getAttribute('data-i18n');
  if (!key) return;
  const dict = I18N[currentLang] || I18N.zh;
  const tag = el.tagName;

  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    if (el._i18nPhZh === undefined) el._i18nPhZh = el.getAttribute('placeholder') || '';
    const phKey = 'ph.' + (el.id || '');
    el.placeholder = dict[phKey] != null ? dict[phKey] : el._i18nPhZh;
    return;
  }
  if (tag === 'SELECT') {
    if (el._i18nTitleZh === undefined) el._i18nTitleZh = el.getAttribute('title') || '';
    const tiKey = 'title.' + (el.id || '');
    el.title = dict[tiKey] != null ? dict[tiKey] : el._i18nTitleZh;
    return;
  }
  if (el.firstElementChild) {
    if (el.hasAttribute('title')) el.title = t(key);
    let done = false;
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3 && n.nodeValue.trim()) {
        n.nodeValue = done ? '' : t(key);
        done = true;
      }
    });
    return;
  }
  el.textContent = t(key);
}

// —— 构造三类高危元素 ——
const opts = [
  mkEl('option', { value: '' }),
  mkEl('option', { value: 'agnes-2.5-pro' }),
  mkEl('option', { value: 'hy3-free' }),
];
const sel = mkEl(
  'select',
  { id: 'modelSelect', 'data-i18n': 'footbar.model', title: '切换当前使用的大模型' },
  opts,
);
const ta = mkEl('textarea', {
  id: 'goalInput',
  'data-i18n': 'footbar.model',
  placeholder: '输入指令…',
});
const icon = mkEl('div', { 'data-i18n': 'sidebar.chat', title: '对话任务' }, [
  mkEl('span', { class: 'icon' }, [txt('💬')]),
  mkEl('span', { class: 'label' }, [txt('对话任务')]),
]);
const plain = mkEl('div', { 'data-i18n': 'footbar.model' }, [txt('大模型')]);

const optCount = () => sel.childNodes.filter((n) => n.nodeType !== 3).length;
const iconKids = () => icon.childNodes.filter((n) => n.nodeType !== 3).length;
const all = [sel, ta, icon, plain];

console.log('初始       option 数: %d | 图标子元素: %d', optCount(), iconKids());
currentLang = 'en';
all.forEach(applyI18nToEl);
console.log('切到英文   option 数: %d | 图标子元素: %d', optCount(), iconKids());
console.log('  select.title =', sel.title);
console.log('  textarea.placeholder =', ta.placeholder);
currentLang = 'zh';
all.forEach(applyI18nToEl);
console.log('切回中文   option 数: %d | 图标子元素: %d', optCount(), iconKids());
console.log('  select.title =', sel.title);
console.log('  textarea.placeholder =', ta.placeholder);
console.log('  纯文本 div =', plain.childNodes[0].nodeValue);

const pass = optCount() === 3 && iconKids() === 2;
console.log('');
console.log(pass ? '通过：option 与图标子元素在多次切换后完好无损' : '失败：子元素被摧毁');
process.exit(pass ? 0 : 1);
