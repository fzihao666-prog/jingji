const { projectOptions } = require('../../utils/project-label');

Component({
  properties: {
    projects: { type: Array, value: [] },
    project: { type: String, value: '' },
    athletes: { type: Array, value: [] },
    athleteId: { type: Number, value: 0 },
    showAthlete: { type: Boolean, value: true },
    allowAll: { type: Boolean, value: true },
    range: { type: String, value: 'month' },
    teams: { type: Array, value: [] },
    teamId: { type: Number, value: 0 },
    showTeam: { type: Boolean, value: false },
    keyword: { type: String, value: '' }
  },

  data: {
    projectIndex: 0,
    projectItems: [],
    athleteIndex: 0,
    athleteItems: [{ id: 0, name: '全部运动员（整体分析）' }],
    teamIndex: 0,
    teamItems: [{ id: 0, name: '全部队伍' }],
    rangeOptions: [
      { value: 'day', label: '日' },
      { value: 'week', label: '周' },
      { value: 'month', label: '月' }
    ]
  },

  observers: {
    'projects, project': function updateProjectIndex(projects, project) {
      const index = Array.isArray(projects) ? projects.indexOf(project) : -1;
      this.setData({ projectItems: projectOptions(projects), projectIndex: index < 0 ? 0 : index });
    },
    'athletes, athleteId, allowAll, keyword': function updateAthleteIndex(athletes, athleteId, allowAll, keyword) {
      const kw = (keyword || '').trim().toLowerCase();
      const filtered = kw
        ? (athletes || []).filter((item) =>
            (item.name || '').toLowerCase().includes(kw) || (item.team || '').toLowerCase().includes(kw)
          )
        : (athletes || []);
      const athleteItems = (allowAll ? [{ id: 0, name: '全部运动员（整体分析）' }] : []).concat(filtered);
      const index = athleteItems.findIndex((item) => Number(item.id) === Number(athleteId));
      this.setData({ athleteItems, athleteIndex: index < 0 ? 0 : index });
    },
    'teams, teamId': function updateTeamIndex(teams, teamId) {
      const teamItems = [{ id: 0, name: '全部队伍' }].concat(teams || []);
      const index = teamItems.findIndex((item) => Number(item.id) === Number(teamId));
      this.setData({ teamItems, teamIndex: index < 0 ? 0 : index });
    }
  },

  methods: {
    onProjectChange(event) {
      const index = Number(event.detail.value);
      const item = this.data.projectItems[index] || this.data.projectItems[0];
      this.triggerEvent('projectchange', { value: item ? item.code : '' });
    },
    onAthleteChange(event) {
      const index = Number(event.detail.value);
      const item = this.data.athleteItems[index] || this.data.athleteItems[0] || { id: 0 };
      this.triggerEvent('athletechange', { value: Number(item.id) || 0 });
    },
    onTeamChange(event) {
      const index = Number(event.detail.value);
      const item = this.data.teamItems[index] || this.data.teamItems[0] || { id: 0 };
      this.triggerEvent('teamchange', { value: Number(item.id) || 0 });
    },
    onKeywordInput(event) {
      this.triggerEvent('keywordchange', { value: event.detail.value || '' });
    },
    onRangeChange(event) {
      this.triggerEvent('rangechange', { value: event.currentTarget.dataset.value });
    }
  }
});
