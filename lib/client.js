/**
 * dsh-token-calendar — browser half.
 *
 * Registers one Settings section that renders the host ledger as a month
 * calendar: every day shows its token total and the models it used, and the
 * selected day expands into a per-model breakdown.
 *
 * Shipped in the `window.__ModuleLoader__.load({ id, factory })` CJS closure
 * form DSH's client module system consumes, so no build step is involved.
 */
window.__ModuleLoader__.load({
  id: 'dsh-token-calendar',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const h = React.createElement;

    const DATA_URL = '/plugins/dsh-token-calendar/data';
    const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
    const MODEL_COLORS = ['#5b8def', '#2bb3a3', '#f0a12c', '#a06cf0', '#e2645f', '#3fa9d6', '#8fa93f', '#d96bb0'];

    const C = {
      text: 'var(--dsw-alias-label-primary, var(--dsh-boot-label-primary, #1f2328))',
      sub: 'var(--dsw-alias-label-secondary, var(--dsh-boot-label-secondary, #5b6470))',
      tertiary: 'var(--dsw-alias-label-tertiary, var(--dsh-boot-label-tertiary, #8b949e))',
      border: 'var(--dsw-alias-border-l2, var(--dsh-boot-border, rgba(128, 128, 128, 0.26)))',
      card: 'var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, 0.07))',
      hover: 'var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.14))',
      accent: 'var(--dsw-alias-brand-primary, var(--dsh-boot-brand, #4f7cff))',
    };

    /** Compact zh-CN token count: 万 / 亿. */
    function compact(value) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return '0';
      if (n >= 1e8) return trimZero((n / 1e8).toFixed(2)) + ' 亿';
      if (n >= 1e4) return trimZero((n / 1e4).toFixed(1)) + ' 万';
      return String(Math.round(n));
    }

    function trimZero(text) {
      return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
    }

    /** Exact count with thousands separators. */
    function full(value) {
      const n = Number(value);
      return Number.isFinite(n) ? Math.round(n).toLocaleString('zh-CN') : '0';
    }

    function pad2(value) {
      return String(value).padStart(2, '0');
    }

    function dayKeyOf(year, month, day) {
      return year + '-' + pad2(month + 1) + '-' + pad2(day);
    }

    function monthPrefix(year, month) {
      return year + '-' + pad2(month + 1) + '-';
    }

    function bucketTotal(bucket) {
      if (bucket === undefined || bucket === null) return 0;
      return Number(bucket.total) || 0;
    }

    /** Weekday index with Monday as 0. */
    function mondayIndex(date) {
      return (date.getDay() + 6) % 7;
    }

    function monthGrid(year, month) {
      const first = new Date(year, month, 1);
      const leading = mondayIndex(first);
      const length = new Date(year, month + 1, 0).getDate();
      const cells = [];
      for (let i = 0; i < leading; i += 1) cells.push(null);
      for (let day = 1; day <= length; day += 1) cells.push(day);
      while (cells.length % 7 !== 0) cells.push(null);
      return cells;
    }

    /** Fetch the ledger from the host route, keeping the last good snapshot. */
    function useLedger() {
      const [state, setState] = React.useState({ data: null, error: null, loading: true });
      const [nonce, setNonce] = React.useState(0);
      React.useEffect(() => {
        let cancelled = false;
        setState((current) => ({ data: current.data, error: null, loading: true }));
        const url = DATA_URL + (nonce > 0 ? '?refresh=1' : '');
        fetch(url, { cache: 'no-store', credentials: 'same-origin' })
          .then((response) => {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
          })
          .then((data) => {
            if (cancelled) return;
            if (data === null || typeof data !== 'object' || typeof data.days !== 'object') {
              throw new Error('返回数据格式不正确');
            }
            setState({ data: data, error: null, loading: false });
          })
          .catch((error) => {
            if (cancelled) return;
            setState((current) => ({
              data: current.data,
              error: String(error && error.message ? error.message : error),
              loading: false,
            }));
          });
        return () => {
          cancelled = true;
        };
      }, [nonce]);
      const refresh = React.useCallback(() => setNonce((value) => value + 1), []);
      return [state, refresh];
    }

    function useModelColors(models) {
      return React.useMemo(() => {
        const map = new Map();
        const list = Array.isArray(models) ? models : [];
        list.forEach((row, index) => {
          if (row && typeof row.model === 'string') map.set(row.model, MODEL_COLORS[index % MODEL_COLORS.length]);
        });
        return map;
      }, [models]);
    }

    function colorOf(map, model) {
      if (map.has(model)) return map.get(model);
      let hash = 0;
      for (let i = 0; i < model.length; i += 1) hash = (hash * 31 + model.charCodeAt(i)) % 997;
      return MODEL_COLORS[hash % MODEL_COLORS.length];
    }

    function Dot(props) {
      return h('span', {
        style: {
          display: 'inline-block',
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: props.color,
          flex: '0 0 auto',
        },
      });
    }

    function SummaryCard(props) {
      const bucket = props.bucket;
      const denominator = bucket === undefined ? 0 : (Number(bucket.cacheRead) || 0) + (Number(bucket.input) || 0);
      const hit = denominator > 0 ? Math.round((bucket.cacheRead / denominator) * 1000) / 10 : 0;
      return h('div', {
        style: {
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: 18,
          padding: '12px 14px',
          border: '1px solid ' + C.border,
          borderRadius: 12,
          background: C.card,
        },
      }, [
        h('div', { key: 'total', style: { display: 'flex', alignItems: 'baseline', gap: 6 } }, [
          h('span', { key: 'label', style: { fontSize: 12, color: C.sub } }, props.label),
          h('span', {
            key: 'value',
            title: full(bucketTotal(bucket)) + ' tokens',
            style: { fontSize: 20, fontWeight: 600, color: C.text, letterSpacing: '-0.01em' },
          }, compact(bucketTotal(bucket))),
          h('span', { key: 'unit', style: { fontSize: 12, color: C.sub } }, 'tokens'),
        ]),
        h('div', { key: 'calls', style: { fontSize: 12, color: C.sub } },
          (bucket ? full(bucket.calls) : '0') + ' 次调用'),
        h('div', { key: 'hit', style: { fontSize: 12, color: C.sub } },
          '缓存命中 ' + hit + '%'),
        h('div', { key: 'in', style: { fontSize: 12, color: C.sub } },
          '输入 ' + compact(bucket ? bucket.input : 0) + ' · 输出 ' + compact(bucket ? bucket.output : 0)),
      ]);
    }

    function DayCell(props) {
      const info = props.info;
      const models = Array.isArray(info && info.models) ? info.models.slice(0, 4) : [];
      const ratio = props.max > 0 ? Math.min(1, Math.sqrt(bucketTotal(info) / props.max)) : 0;
      const background = info === undefined
        ? 'transparent'
        : 'rgba(91, 141, 239, ' + (0.06 + ratio * 0.34).toFixed(3) + ')';
      return h('button', {
        type: 'button',
        onClick: props.onSelect,
        title: info === undefined
          ? props.dateLabel + '：无记录'
          : props.dateLabel + '：' + full(info.total) + ' tokens，' + full(info.calls) + ' 次调用',
        style: {
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 2,
          minHeight: 58,
          padding: '6px 8px',
          border: props.selected
            ? '1.5px solid ' + C.accent
            : props.isToday
              ? '1px dashed ' + C.accent
              : '1px solid ' + C.border,
          borderRadius: 9,
          background: background,
          color: C.text,
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit',
        },
      }, [
        h('span', {
          key: 'day',
          style: { fontSize: 11, color: info === undefined ? C.tertiary : C.sub, lineHeight: '14px' },
        }, String(props.day)),
        info === undefined
          ? null
          : h('span', {
            key: 'total',
            style: { fontSize: 12, fontWeight: 600, lineHeight: '16px', whiteSpace: 'nowrap' },
          }, compact(info.total)),
        models.length === 0
          ? null
          : h('span', {
            key: 'dots',
            style: { display: 'flex', gap: 3, marginTop: 2, flexWrap: 'wrap' },
          }, models.map((row, index) => h(Dot, {
            key: row.model + ':' + index,
            color: colorOf(props.colors, row.model),
          }))),
      ]);
    }

    function SegmentBar(props) {
      const bucket = props.bucket;
      const parts = [
        { key: 'input', value: Number(bucket.input) || 0, color: '#8aa8e8' },
        { key: 'cacheRead', value: Number(bucket.cacheRead) || 0, color: '#5b8def' },
        { key: 'cacheWrite', value: Number(bucket.cacheWrite) || 0, color: '#a06cf0' },
        { key: 'output', value: Number(bucket.output) || 0, color: '#2bb3a3' },
      ];
      const total = parts.reduce((sum, part) => sum + part.value, 0);
      return h('div', {
        style: {
          display: 'flex',
          height: 6,
          width: '100%',
          borderRadius: 999,
          overflow: 'hidden',
          background: 'rgba(128, 128, 128, 0.18)',
        },
      }, parts.map((part) => h('div', {
        key: part.key,
        title: part.key + ' ' + full(part.value),
        style: {
          width: total > 0 ? (part.value / total) * 100 + '%' : '0%',
          background: part.color,
        },
      })));
    }

    function ModelRow(props) {
      const row = props.row;
      return h('div', {
        style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0' },
      }, [
        h('div', {
          key: 'head',
          style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
        }, [
          h(Dot, { key: 'dot', color: props.color }),
          h('span', {
            key: 'name',
            style: { fontSize: 13, color: C.text, fontWeight: 500, wordBreak: 'break-all' },
          }, row.model),
          h('span', { key: 'spacer', style: { flex: 1 } }),
          h('span', {
            key: 'calls',
            style: { fontSize: 12, color: C.sub, whiteSpace: 'nowrap' },
          }, full(row.calls) + ' 次'),
          h('span', {
            key: 'total',
            title: full(row.total) + ' tokens',
            style: { fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: 'nowrap' },
          }, compact(row.total)),
        ]),
        h('div', { key: 'bar' }, h(SegmentBar, { bucket: row })),
        h('div', {
          key: 'breakdown',
          style: { display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: C.sub },
        }, [
          h('span', { key: 'in' }, '输入 ' + full(row.input)),
          h('span', { key: 'cr' }, '缓存读 ' + full(row.cacheRead)),
          row.cacheWrite > 0 ? h('span', { key: 'cw' }, '缓存写 ' + full(row.cacheWrite)) : null,
          h('span', { key: 'out' }, '输出 ' + full(row.output)),
        ]),
      ]);
    }

    function DayPanel(props) {
      const info = props.info;
      if (info === undefined) {
        return h('div', {
          style: {
            padding: '18px 14px',
            border: '1px dashed ' + C.border,
            borderRadius: 12,
            fontSize: 12,
            color: C.sub,
          },
        }, props.label + '：这一天没有记录');
      }
      const denominator = (Number(info.cacheRead) || 0) + (Number(info.input) || 0);
      const hit = denominator > 0 ? Math.round((info.cacheRead / denominator) * 1000) / 10 : 0;
      return h('div', {
        style: {
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid ' + C.border,
          borderRadius: 12,
          background: C.card,
          padding: '12px 14px',
        },
      }, [
        h('div', {
          key: 'head',
          style: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
        }, [
          h('span', { key: 'label', style: { fontSize: 14, fontWeight: 600, color: C.text } }, props.label),
          h('span', { key: 'spacer', style: { flex: 1 } }),
          h('span', {
            key: 'total',
            title: full(info.total) + ' tokens',
            style: { fontSize: 16, fontWeight: 600, color: C.text },
          }, compact(info.total)),
          h('span', { key: 'unit', style: { fontSize: 12, color: C.sub } }, 'tokens'),
          h('span', { key: 'calls', style: { fontSize: 12, color: C.sub } }, '· ' + full(info.calls) + ' 次调用'),
          h('span', { key: 'hit', style: { fontSize: 12, color: C.sub } }, '· 缓存命中 ' + hit + '%'),
        ]),
        h('div', { key: 'rows' }, (info.models || []).map((row, index) => h('div', {
          key: row.model + ':' + index,
          style: index === 0 ? {} : { borderTop: '1px solid ' + C.border },
        }, h(ModelRow, { row: row, color: colorOf(props.colors, row.model) })))),
      ]);
    }

    function Legend(props) {
      return h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: C.sub, flexWrap: 'wrap' },
      }, [
        h('span', { key: 'heat', style: { display: 'flex', alignItems: 'center', gap: 4 } }, [
          h('span', { key: 'l' }, '少'),
          ...[0.06, 0.16, 0.26, 0.36].map((alpha, index) => h('span', {
            key: 'cell' + index,
            style: {
              width: 12,
              height: 12,
              borderRadius: 3,
              background: 'rgba(91, 141, 239, ' + alpha + ')',
              border: '1px solid ' + C.border,
            },
          })),
          h('span', { key: 'r' }, '多'),
        ]),
        h('span', { key: 'sep', style: { flex: 1 } }),
        h('span', { key: 'note' }, props.note),
      ]);
    }

    /** Presentational section: takes one ledger snapshot and a refresh action. */
    function TokenUsageView(props) {
      const ledger = props.ledger;
      const refresh = props.refresh;
      const colors = useModelColors(ledger.data ? ledger.data.models : []);
      const today = React.useMemo(() => new Date(), []);
      const [cursor, setCursor] = React.useState({ year: today.getFullYear(), month: today.getMonth() });
      const [selected, setSelected] = React.useState(dayKeyOf(today.getFullYear(), today.getMonth(), today.getDate()));

      const days = ledger.data && ledger.data.days ? ledger.data.days : {};
      const cells = React.useMemo(() => monthGrid(cursor.year, cursor.month), [cursor.year, cursor.month]);
      const prefix = monthPrefix(cursor.year, cursor.month);

      const monthStats = React.useMemo(() => {
        const summary = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0, days: 0, top: null };
        const perModel = new Map();
        for (const key of Object.keys(days)) {
          if (!key.startsWith(prefix)) continue;
          const info = days[key];
          summary.days += 1;
          summary.calls += Number(info.calls) || 0;
          summary.input += Number(info.input) || 0;
          summary.cacheRead += Number(info.cacheRead) || 0;
          summary.cacheWrite += Number(info.cacheWrite) || 0;
          summary.output += Number(info.output) || 0;
          summary.total += Number(info.total) || 0;
          for (const row of info.models || []) {
            const entry = perModel.get(row.model) || { model: row.model, total: 0 };
            entry.total += Number(row.total) || 0;
            perModel.set(row.model, entry);
          }
        }
        summary.top = [...perModel.values()].sort((a, b) => b.total - a.total)[0] || null;
        return summary;
      }, [days, prefix]);

      const monthMax = React.useMemo(() => {
        let max = 0;
        for (const key of Object.keys(days)) {
          if (!key.startsWith(prefix)) continue;
          max = Math.max(max, bucketTotal(days[key]));
        }
        return max;
      }, [days, prefix]);

      const shiftMonth = (delta) => {
        const next = new Date(cursor.year, cursor.month + delta, 1);
        setCursor({ year: next.getFullYear(), month: next.getMonth() });
      };

      const backToToday = () => {
        const now = new Date();
        setCursor({ year: now.getFullYear(), month: now.getMonth() });
        setSelected(dayKeyOf(now.getFullYear(), now.getMonth(), now.getDate()));
      };

      const selectedInfo = days[selected];
      const [selectedYear, selectedMonth, selectedDay] = selected.split('-').map(Number);
      const selectedDate = new Date(selectedYear, selectedMonth - 1, selectedDay);
      const selectedLabel = selectedYear + ' 年 ' + selectedMonth + ' 月 ' + selectedDay + ' 日 · 周' + WEEKDAYS[mondayIndex(selectedDate)];

      const status = ledger.error !== null
        ? '读取失败：' + ledger.error + (ledger.data ? '（显示上次结果）' : '')
        : ledger.loading
          ? '正在统计会话日志…'
          : '共 ' + full(ledger.data ? ledger.data.sessions : 0) + ' 个会话 · 时区 ' + (ledger.data ? ledger.data.timeZone : '') +
            (ledger.data && ledger.data.generatedAt ? ' · 更新于 ' + new Date(ledger.data.generatedAt).toLocaleTimeString('zh-CN') : '');

      return h('div', {
        style: { display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4, color: C.text },
      }, [
        h('div', {
          key: 'head',
          style: { display: 'flex', alignItems: 'flex-start', gap: 12 },
        }, [
          h('div', { key: 'text', style: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1 } }, [
            h('div', { key: 'title', style: { fontSize: 15, fontWeight: 600 } }, 'Token 用量'),
            h('div', { key: 'status', style: { fontSize: 12, color: ledger.error ? '#cf4a45' : C.sub, lineHeight: '18px' } }, status),
          ]),
          h('button', {
            key: 'refresh',
            type: 'button',
            onClick: refresh,
            disabled: ledger.loading,
            style: {
              padding: '5px 12px',
              borderRadius: 8,
              border: '1px solid ' + C.border,
              background: C.card,
              color: C.text,
              fontSize: 12,
              cursor: ledger.loading ? 'default' : 'pointer',
              opacity: ledger.loading ? 0.6 : 1,
              font: 'inherit',
            },
          }, ledger.loading ? '统计中…' : '刷新'),
        ]),
        h(SummaryCard, {
          key: 'summary',
          label: cursor.year + ' 年 ' + (cursor.month + 1) + ' 月合计',
          bucket: monthStats,
        }),
        h('div', {
          key: 'nav',
          style: { display: 'flex', alignItems: 'center', gap: 8 },
        }, [
          h('button', {
            key: 'prev',
            type: 'button',
            onClick: () => shiftMonth(-1),
            style: navButtonStyle(),
            'aria-label': '上个月',
          }, '‹'),
          h('span', { key: 'label', style: { fontSize: 14, fontWeight: 600, minWidth: 120, textAlign: 'center' } },
            cursor.year + ' 年 ' + (cursor.month + 1) + ' 月'),
          h('button', {
            key: 'next',
            type: 'button',
            onClick: () => shiftMonth(1),
            style: navButtonStyle(),
            'aria-label': '下个月',
          }, '›'),
          h('span', { key: 'spacer', style: { flex: 1 } }),
          monthStats.top !== null
            ? h('span', {
              key: 'top',
              style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.sub },
            }, [
              h(Dot, { key: 'dot', color: colorOf(colors, monthStats.top.model) }),
              h('span', { key: 'text' }, '最多：' + monthStats.top.model + ' ' + compact(monthStats.top.total)),
            ])
            : null,
          h('button', {
            key: 'today',
            type: 'button',
            onClick: backToToday,
            style: Object.assign(navButtonStyle(), { padding: '0 10px', width: 'auto', fontSize: 12 }),
          }, '回到今天'),
        ]),
        h('div', {
          key: 'grid',
          style: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 },
        }, [
          ...WEEKDAYS.map((label) => h('div', {
            key: 'weekday-' + label,
            style: { fontSize: 11, color: C.sub, textAlign: 'center', paddingBottom: 2 },
          }, label)),
          ...cells.map((day, index) => {
            if (day === null) return h('div', { key: 'empty-' + index });
            const key = dayKeyOf(cursor.year, cursor.month, day);
            return h(DayCell, {
              key: key,
              day: day,
              dateLabel: cursor.year + ' 年 ' + (cursor.month + 1) + ' 月 ' + day + ' 日',
              info: days[key],
              max: monthMax,
              colors: colors,
              selected: key === selected,
              isToday: key === dayKeyOf(today.getFullYear(), today.getMonth(), today.getDate()),
              onSelect: () => setSelected(key),
            });
          }),
        ]),
        h(Legend, {
          key: 'legend',
          note: '共 ' + (ledger.data ? full(ledger.data.days ? Object.keys(ledger.data.days).length : 0) : '0') + ' 天有记录',
        }),
        h(DayPanel, { key: 'day', label: selectedLabel, info: selectedInfo, colors: colors }),
      ]);
    }

    /** Section entry: fetch the ledger, then render the view. */
    function TokenUsageSection() {
      const [ledger, refresh] = useLedger();
      return h(TokenUsageView, { ledger: ledger, refresh: refresh });
    }

    function navButtonStyle() {
      return {
        width: 28,
        height: 28,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        border: '1px solid ' + C.border,
        background: C.card,
        color: C.text,
        fontSize: 14,
        lineHeight: '1',
        cursor: 'pointer',
        font: 'inherit',
      };
    }

    const inject = ['slots'];

    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'token-usage',
        order: 20,
        label: () => 'Token 用量',
      }, TokenUsageSection));
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__test = {
      compact: compact,
      full: full,
      monthGrid: monthGrid,
      dayKeyOf: dayKeyOf,
      TokenUsageView: TokenUsageView,
      TokenUsageSection: TokenUsageSection,
    };
    return module.exports;
  },
});