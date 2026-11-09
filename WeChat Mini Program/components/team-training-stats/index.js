const api = require('../../services/api');
const { teams: readTeams } = require('../../services/data-import');
const { sportRules = {} } = require('../../data/register-data');
const { projectLabel } = require('../../utils/project-label');
const { buildView, annualTrend, rawMetrics, rawTrend } = require('./view');

const PERIODS = [{ id: 'week', label: '周' }, { id: 'month', label: '月' }, { id: 'year', label: '年' }];
const RAW_PAGE_SIZE = 31;
const DATE_FIELDS = {
  week: { fields: 'day', label: '周内日期', length: 10, suffix: '' },
  month: { fields: 'month', label: '月份', length: 7, suffix: '-01' },
  year: { fields: 'year', label: '年份', length: 4, suffix: '-01-01' }
};

Component({
  properties: { scope: { type: Object, value: null, observer: 'applyScope' } },
  data: {
    periods: PERIODS, period: 'week', dateFields: DATE_FIELDS.week, dateText: '', pickerDate: '',
    projectLabel: '', teams: [], teamOptions: [], teamIndex: -1, teamName: '', loading: false, error: '', view: null,
    showDetail: false, showSpecial: false, annualIndex: 0, annualChart: null,
    rawOptions: [], rawIndex: 0, rawPage: 0, rawPages: 0, rawTotal: 0, rawChart: null
  },
  lifetimes: {
    detached() { this._request = (this._request || 0) + 1; }
  },
  methods: {
    applyScope(scope) {
      if (!scope || !scope.project) return;
      const previous = this._scope;
      this._scope = scope;
      const reset = !previous || previous.project !== scope.project || previous.teamId !== scope.teamId || scope.open;
      if (reset) {
        this._anchor = scope.date || '';
        this._teamId = scope.teamId || 0;
        this.setData({ period: scope.open ? 'week' : this.data.period, projectLabel: projectLabel(scope.project) });
      }
      return this.loadTeams();
    },

    async loadTeams() {
      const scope = this._scope;
      if (!scope) return;
      const request = this._request = (this._request || 0) + 1;
      this.setData({ loading: true, error: '', teams: [], teamOptions: [], teamIndex: -1, teamName: '', view: null });
      try {
        const result = await readTeams();
        if (this._request !== request) return;
        const teams = result.teams.filter((team) => team.project === scope.project);
        const preferred = teams.findIndex(({ id }) => id === this._teamId);
        const teamIndex = preferred >= 0 ? preferred : teams.length === 1 && !scope.open ? 0 : -1;
        this.setData({ teams, teamOptions: ['请选择', ...teams.map(({ name }) => name)], teamIndex, teamName: teamIndex < 0 ? '' : teams[teamIndex].name });
        if (teamIndex >= 0) return this.loadStats();
        this._teamId = 0;
        this._anchor = '';
        this.setData({ loading: false, error: scope.open ? '本次导入的队伍已不在可查看范围内。' : '' });
      } catch (error) {
        if (this._request === request) this.setData({ loading: false, error: error.message || '授权队伍读取失败。' });
      }
    },

    async loadStats() {
      const request = this._request = (this._request || 0) + 1;
      const { project } = this._scope;
      const { period, teams, teamIndex } = this.data;
      const team = teams[teamIndex];
      if (!team) return;
      this._teamId = team.id;
      const dateFields = DATE_FIELDS[period];
      this.setData({
        dateFields, pickerDate: this._anchor, dateText: this._anchor.slice(0, dateFields.length),
        loading: true, error: '', view: null, showDetail: false, showSpecial: false,
        annualIndex: 0, annualChart: null, rawOptions: [], rawIndex: 0, rawPage: 0, rawPages: 0, rawTotal: 0, rawChart: null
      });
      try {
        const stats = await api.teamTrainingStats(project, team.id, period, this._anchor);
        if (this._request !== request) return;
        this._stats = stats;
        this._anchor = stats.anchorDate;
        this._raw = rawMetrics(stats.otherMeasures);
        const water = ((sportRules[project] || {}).activities || []).includes('on_water');
        this.setData({
          loading: false, pickerDate: this._anchor, dateText: this._anchor.slice(0, dateFields.length),
          view: buildView(stats, period, water),
          rawOptions: this._raw.map(({ title, unit }) => `${title}（${unit}）`)
        });
      } catch (error) {
        if (this._request === request) this.setData({ loading: false, error: error.message || '队伍训练统计读取失败。' });
      }
    },

    onTeamChange(event) {
      const teamIndex = Number(event.detail.value) - 1;
      const team = this.data.teams[teamIndex];
      if (!team) {
        this._request += 1;
        this._anchor = '';
        this._teamId = 0;
        this.setData({ teamIndex: -1, teamName: '', loading: false, error: '', view: null });
        return;
      }
      this._anchor = '';
      this.setData({ teamIndex, teamName: team.name });
      return this.loadStats();
    },

    onPeriodChange(event) {
      const period = event.currentTarget.dataset.period;
      if (!DATE_FIELDS[period] || this.data.period === period) return;
      this.setData({ period });
      return this.loadStats();
    },

    onDateChange(event) {
      const { period } = this.data;
      const field = DATE_FIELDS[period];
      this._anchor = event.detail.value.slice(0, field.length) + field.suffix;
      return this.loadStats();
    },

    onRetry() { return this.data.teamIndex >= 0 ? this.loadStats() : this.loadTeams(); },
    onToggleDetail() { this.setData({ showDetail: !this.data.showDetail }); },
    onToggleSpecial() {
      const showSpecial = !this.data.showSpecial;
      this.setData({ showSpecial });
      if (showSpecial && this.data.view.annual.length) this.showAnnual(this.data.annualIndex);
      if (showSpecial && this._raw.length) this.showRaw(this.data.rawIndex, 0);
    },
    onAnnualChange(event) { this.showAnnual(Number(event.detail.value)); },
    showAnnual(index) { this.setData({ annualIndex: index, annualChart: annualTrend(this._stats, index) }); },
    onRawChange(event) { this.showRaw(Number(event.detail.value), 0); },
    onRawPage(event) { this.showRaw(this.data.rawIndex, event.detail.page); },
    showRaw(index, page) {
      const metric = this._raw[index];
      this.setData({
        rawIndex: index, rawPage: page, rawPages: Math.ceil(metric.rows.length / RAW_PAGE_SIZE), rawTotal: metric.rows.length,
        rawChart: rawTrend(metric, page, RAW_PAGE_SIZE)
      });
    },

    onPoint(event) {
      const { title, date, value, unit } = event.currentTarget.dataset;
      wx.showModal({ title: date, content: `${title}：${value === '—' ? '未填报' : `${value} ${unit}`}`, showCancel: false });
    }
  }
});
