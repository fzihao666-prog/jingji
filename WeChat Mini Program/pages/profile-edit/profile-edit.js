const api = require('../../services/api');
const { loadContext } = require('../../utils/context');
const { personalProfilePayload } = require('../../utils/profile-payload');
const { todayBeijing } = require('../../utils/date');
const { projectLabel, projectOptions } = require('../../utils/project-label');

const { provinces = [] } = require('../../data/register-data');
const MANAGER_ROLES = ['SCC', 'REG', 'TD', 'DMD'];

const BODY_FIELDS = [
  'heightCm', 'weightKg', 'bodyFatPct', 'skeletalMuscleKg', 'muscleMassKg',
  'upperLimbMuscleKg', 'lowerLimbMuscleKg', 'trunkMuscleKg', 'subcutaneousFatMm',
  'tricepsSkinfoldMm', 'abdominalSkinfoldMm', 'thighSkinfoldMm', 'calfSkinfoldMm',
  'visceralFatLevel', 'basalMetabolismKcal', 'totalBodyWaterKg', 'ecwTbwRatio',
  'phaseAngleDeg', 'visceralFatAreaCm2', 'leftArmLeanKg', 'rightArmLeanKg',
  'trunkLeanKg', 'leftLegLeanKg', 'rightLegLeanKg'
];

function text(value) { return value === null || value === undefined ? '' : String(value); }

function currentDate() {
  return todayBeijing();
}

function profileForm(athlete) {
  const fields = [
    'name', 'project', 'team', 'gender', 'region', 'city', 'county', 'birthDate',
    'ethnicity', 'phone', 'bloodType', 'emergencyContact',
    'emergencyPhone', 'education', 'technicalLevel', 'athletePosition', 'healthStatus',
    'bestResult', 'nativePlace', 'homeAddress', 'athleteStatus', 'startSportDate',
    'trainingVenue', 'currentEvent', 'trainingPhase', 'campPeriod', 'originPlace',
    'originUnit', 'originCoach', 'specialties', 'notes'
  ];
  const form = {};
  fields.forEach((key) => { form[key] = text(athlete[key]); });
  return form;
}

function bodyForm(athlete) {
  const body = { measurementDate: text(athlete.bodyMeasurementDate) || currentDate(), note: text(athlete.bodyMeasurementNote) };
  BODY_FIELDS.forEach((key) => { body[key] = text(athlete[key]); });
  return body;
}

Page({
  data: {
    loading: true,
    saving: false,
    loaded: false,
    saved: false,
    editingManaged: false,
    projectItems: [], projectIndex: 0, teamItems: [], teamIndex: 0,
    error: '',
    athleteId: 0,
    form: {},
    body: {},
    genderOptions: ['暂不填写', '男', '女'],
    genderIndex: 0,
    today: '',
    healthOptions: ['健康', '观察', '训练受限', '康复中'],
    healthIndex: 0,
    statusOptions: ['在训', '集训', '休整', '离队'],
    statusIndex: 0,
    photoUrl: '',
    photoFile: '',
    showPrivacyAuthorization: false,
    bodyTouched: false,
    showBodyMore: false
  },

  onLoad(options = {}) {
    this._requestedId = Number(options.athleteId) || 0;
    this.setData({ today: currentDate() });
    if (wx.onNeedPrivacyAuthorization) {
      this._privacyListener = (resolve) => {
        this._resolvePrivacyAuthorization = resolve;
        this.setData({ showPrivacyAuthorization: true });
        resolve({ event: 'exposureAuthorization' });
      };
      wx.onNeedPrivacyAuthorization(this._privacyListener);
    }
    this.loadPage();
  },

  retryLoad() { this.loadPage(); },

  onUnload() {
    if (this._resolvePrivacyAuthorization) this._resolvePrivacyAuthorization({ event: 'disagree' });
    if (this._privacyListener && wx.offNeedPrivacyAuthorization) wx.offNeedPrivacyAuthorization(this._privacyListener);
  },

  onPrivacyAgree() {
    if (this._resolvePrivacyAuthorization) this._resolvePrivacyAuthorization({ event: 'agree', buttonId: 'agree-privacy' });
    this._resolvePrivacyAuthorization = null;
    this.setData({ showPrivacyAuthorization: false });
  },

  onPrivacyDisagree() {
    if (this._resolvePrivacyAuthorization) this._resolvePrivacyAuthorization({ event: 'disagree' });
    this._resolvePrivacyAuthorization = null;
    this.setData({ showPrivacyAuthorization: false });
  },

  blockPrivacyTouch() {},

  async loadPage() {
    this.setData({ loading: true, error: '', loaded: false });
    try {
      const context = await loadContext({ refreshUser: true });
      const editingManaged = MANAGER_ROLES.includes(context.user.role);
      if (!editingManaged && context.user.role !== 'ATL') throw new Error('当前账号无权编辑运动员资料。');
      const athleteId = editingManaged ? this._requestedId || context.selectedAthleteId : context.user.athleteId;
      if (!editingManaged && this._requestedId && this._requestedId !== Number(context.user.athleteId)) {
        throw new Error('运动员只能编辑本人的资料。');
      }
      const athlete = context.athletes.find((item) => Number(item.id) === Number(athleteId));
      if (!athlete) throw new Error('运动员不存在或不在可管理范围内。');
      let projectItems = [];
      if (editingManaged) {
        const options = await api.athleteCreateOptions();
        this._teams = options.teams || [];
        this._areas = options.areas || [];
        this._managerRole = context.user.role;
        projectItems = projectOptions([...new Set(this._teams.map((team) => team.project))]);
        if (!this._teams.some((team) => team.project === athlete.project && team.name === athlete.team)) {
          throw new Error('当前账号无权维护该运动员所属队伍。');
        }
      }
      const form = profileForm(athlete);
      const photoUrl = athlete.photoUrl ? await api.downloadAthletePhoto(athlete.id) : '';
      this.setData({
        athleteId: athlete.id, form, editingManaged, projectItems,
        projectIndex: Math.max(0, projectItems.findIndex((item) => item.code === athlete.project)),
        projectLabel: projectLabel(athlete.project), body: bodyForm(athlete),
        genderIndex: Math.max(0, ['暂不填写', '男', '女'].indexOf(athlete.gender || '暂不填写')),
        healthIndex: Math.max(0, ['健康', '观察', '训练受限', '康复中'].indexOf(athlete.healthStatus || '健康')),
        statusIndex: Math.max(0, ['在训', '集训', '休整', '离队'].indexOf(athlete.athleteStatus || '在训')),
        photoUrl, loaded: true,
      });
      if (editingManaged) this.updateTeamItems(athlete.team);
    } catch (error) {
      this.setData({ error: error.message || '运动员资料加载失败。' });
    } finally { this.setData({ loading: false }); }
  },

  updateTeamItems(preferredTeam) {
    const teamItems = [{ id: 0, name: '请选择队伍' }].concat((this._teams || []).filter((team) => team.project === this.data.form.project));
    const teamIndex = Math.max(0, teamItems.findIndex((team) => team.name === preferredTeam));
    this.setData({ teamItems, teamIndex, 'form.team': teamIndex > 0 ? teamItems[teamIndex].name : '' });
  },

  onManagedProjectChange(event) {
    if (!this.data.editingManaged || this.data.saving || this.data.saved) return;
    const projectIndex = Number(event.detail.value);
    const item = this.data.projectItems[projectIndex];
    if (!item || item.code === this.data.form.project) return;
    this.setData({ projectIndex, 'form.project': item.code, projectLabel: item.label });
    this.updateTeamItems('');
    this.markDirty();
  },

  onManagedTeamChange(event) {
    if (!this.data.editingManaged || this.data.saving || this.data.saved) return;
    const teamIndex = Number(event.detail.value);
    const team = this.data.teamItems[teamIndex];
    if (!team) return;
    this.setData({ teamIndex, 'form.team': team.name });
    this.markDirty();
  },

  onManagedAreaChange(event) {
    if (!this.data.editingManaged || this.data.saving || this.data.saved) return;
    const [rawRegion, rawCity, county] = event.detail.value || [];
    if (!rawRegion || !rawCity || !county) return;
    const region = provinces.find((province) => rawRegion.startsWith(province)) || rawRegion;
    const city = ['北京', '天津', '上海', '重庆'].includes(region) ? `${region}市` : rawCity;
    const allowed = this._managerRole === 'SCC' || (this._areas || []).some((area) =>
      area.areaLevel === 'national' || (area.province === region &&
        (area.areaLevel === 'province' || (area.city === city &&
          (area.areaLevel === 'city' || area.county === county))))
    );
    if (!allowed) { this.setData({ error: '档案行政归属不能超出当前账号权限。' }); return; }
    this.setData({ 'form.region': region, 'form.city': city, 'form.county': county, error: '' });
    this.markDirty();
  },

  markDirty() {
    if (!this._dirty && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '运动员资料尚未保存，确定离开吗？' });
    this._dirty = true;
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    if (this.data.saving || this.data.saved || !Object.prototype.hasOwnProperty.call(this.data.form, field) || ['project', 'team', 'region', 'city', 'county'].includes(field)) return;
    this.setData({ [`form.${field}`]: event.detail.value });
    this.markDirty();
  },

  onBodyInput(event) {
    const field = event.currentTarget.dataset.field;
    if (this.data.saving || this.data.saved || !Object.prototype.hasOwnProperty.call(this.data.body, field)) return;
    this.setData({ [`body.${field}`]: event.detail.value, bodyTouched: true });
    this.markDirty();
  },

  onBirthDateChange(event) {
    if (this.data.saving || this.data.saved) return;
    this.markDirty();
    this.setData({ 'form.birthDate': event.detail.value });
  },

  onGenderChange(event) {
    if (this.data.saving || this.data.saved) return;
    this.markDirty();
    const genderIndex = Number(event.detail.value) || 0;
    const value = this.data.genderOptions[genderIndex];
    this.setData({ genderIndex, 'form.gender': value === '暂不填写' ? '' : value });
  },

  onHealthChange(event) {
    if (this.data.saving || this.data.saved) return;
    this.markDirty();
    const healthIndex = Number(event.detail.value) || 0;
    this.setData({ healthIndex, 'form.healthStatus': this.data.healthOptions[healthIndex] });
  },

  onStatusChange(event) {
    if (this.data.saving || this.data.saved) return;
    this.markDirty();
    const statusIndex = Number(event.detail.value) || 0;
    this.setData({ statusIndex, 'form.athleteStatus': this.data.statusOptions[statusIndex] });
  },

  toggleBodyMore() { this.setData({ showBodyMore: !this.data.showBodyMore }); },

  choosePhoto() {
    if (this.data.saving || this.data.saved) return;
    const openMedia = () => wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (file) { this.setData({ photoFile: file.tempFilePath, photoUrl: file.tempFilePath }); this.markDirty(); }
      }
    });
    if (wx.requirePrivacyAuthorize) {
      wx.requirePrivacyAuthorize({ success: openMedia, fail: () => {} });
    } else openMedia();
  },

  async save() {
    if (this.data.saving || this.data.saved || !this.data.loaded) return;
    if (!this.data.form.name) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }
    this.setData({ saving: true, error: '' });
    let profileSaved = false;
    try {
      const payload = personalProfilePayload(this.data.form);
      if (this.data.editingManaged) {
        if (!(this._teams || []).some((team) => team.project === this.data.form.project && team.name === this.data.form.team)) {
          throw new Error('请选择有权管理的项目和队伍。');
        }
        await api.updateAthlete(this.data.athleteId, {
          ...payload, project: this.data.form.project, team: this.data.form.team,
          region: this.data.form.region, city: this.data.form.city, county: this.data.form.county,
        });
      } else await api.updateMyAthleteProfile(payload);
      profileSaved = true;
      const app = getApp();
      // 主档案已保存时立即使缓存失效，即使后续照片或测量保存失败也能读到最新资料。
      app.globalData.homeNeedsRefresh = true;
      app.globalData.dataVersion = (app.globalData.dataVersion || 0) + 1;
      app.globalData.selectedAthleteId = this.data.athleteId;
      app.setProject(this.data.form.project);
      if (this.data.editingManaged) app.globalData.pendingProject = this.data.form.project;
      else app.globalData.user = Object.assign({}, app.globalData.user, { displayName: payload.name });
      if (this.data.bodyTouched) {
        const body = Object.assign({}, this.data.body);
        BODY_FIELDS.forEach((key) => { body[key] = body[key] === '' ? null : Number(body[key]); });
        await api.updateBodyComposition(this.data.athleteId, body);
        this.setData({ bodyTouched: false });
      }
      if (this.data.photoFile) {
        await api.uploadAthletePhoto(this.data.athleteId, this.data.photoFile);
        this.setData({ photoFile: '' });
      }
      this.setData({ saved: true });
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      wx.showToast({ title: '运动员资料已更新', icon: 'success' });
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/profile/profile' }) }), 700);
    } catch (error) {
      const message = error.message || '保存失败，请重试。';
      this.setData({ error: profileSaved ? `基本资料已保存，照片或身体成分未完成保存：${message}` : message });
    } finally {
      this.setData({ saving: false });
    }
  }
});
