Component({
  properties: {
    projects: { type: Array, value: [] },
    project: { type: String, value: '' },
    athletes: { type: Array, value: [] },
    athleteId: { type: Number, value: 0 },
    showAthlete: { type: Boolean, value: true },
    allowAll: { type: Boolean, value: true },
    range: { type: String, value: 'month' }
  },

  data: {
    projectIndex: 0,
    athleteIndex: 0,
    athleteItems: [{ id: 0, name: '全部运动员（整体分析）' }],
    rangeOptions: [
      { value: 'day', label: '日' },
      { value: 'week', label: '周' },
      { value: 'month', label: '月' }
    ]
  },

  observers: {
    'projects, project': function updateProjectIndex(projects, project) {
      const index = Array.isArray(projects) ? projects.indexOf(project) : -1;
      this.setData({ projectIndex: index < 0 ? 0 : index });
    },
    'athletes, athleteId, allowAll': function updateAthleteIndex(athletes, athleteId, allowAll) {
      const athleteItems = (allowAll ? [{ id: 0, name: '全部运动员（整体分析）' }] : []).concat(athletes || []);
      const index = athleteItems.findIndex((item) => Number(item.id) === Number(athleteId));
      this.setData({ athleteItems, athleteIndex: index < 0 ? 0 : index });
    }
  },

  methods: {
    onProjectChange(event) {
      const index = Number(event.detail.value);
      this.triggerEvent('projectchange', { value: this.properties.projects[index] });
    },
    onAthleteChange(event) {
      const index = Number(event.detail.value);
      const item = this.data.athleteItems[index] || this.data.athleteItems[0] || { id: 0 };
      this.triggerEvent('athletechange', { value: Number(item.id) || 0 });
    },
    onRangeChange(event) {
      this.triggerEvent('rangechange', { value: event.currentTarget.dataset.value });
    }
  }
});
