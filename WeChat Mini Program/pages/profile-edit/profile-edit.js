const api = require('../../services/api');
const { loadContext } = require('../../utils/context');
const { personalProfilePayload } = require('../../utils/profile-payload');

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
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function profileForm(athlete) {
  const fields = [
    'name', 'project', 'team', 'gender', 'region', 'city', 'county', 'birthDate',
    'identityNumber', 'ethnicity', 'phone', 'bloodType', 'emergencyContact',
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
    error: '',
    athleteId: 0,
    form: {},
    body: {},
    genderOptions: ['暂不填写', '男', '女'],
    genderIndex: 0,
    healthOptions: ['健康', '观察', '训练受限', '康复中'],
    healthIndex: 0,
    statusOptions: ['在训', '集训', '休整', '离队'],
    statusIndex: 0,
    photoUrl: '',
    photoFile: '',
    bodyTouched: false,
    showBodyMore: false
  },

  onLoad() { this.loadPage(); },

  async loadPage() {
    try {
      const context = await loadContext({ refreshUser: true });
      if (context.user.role !== 'ATL' || !context.user.athleteId) throw new Error('只有运动员本人可以编辑个人资料。');
      const athlete = context.athletes.find((item) => Number(item.id) === Number(context.user.athleteId));
      if (!athlete) throw new Error('未找到当前账号绑定的运动员档案。');
      const form = profileForm(athlete);
      this.setData({
        athleteId: athlete.id,
        form,
        body: bodyForm(athlete),
        genderIndex: Math.max(0, ['暂不填写', '男', '女'].indexOf(athlete.gender || '暂不填写')),
        healthIndex: Math.max(0, ['健康', '观察', '训练受限', '康复中'].indexOf(athlete.healthStatus || '健康')),
        statusIndex: Math.max(0, ['在训', '集训', '休整', '离队'].indexOf(athlete.athleteStatus || '在训')),
        photoUrl: api.assetUrl(athlete.photoUrl),
        loading: false
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '个人资料加载失败。' });
    }
  },

  onFieldInput(event) {
    this.setData({ [`form.${event.currentTarget.dataset.field}`]: event.detail.value });
  },

  onBodyInput(event) {
    this.setData({ [`body.${event.currentTarget.dataset.field}`]: event.detail.value, bodyTouched: true });
  },

  onGenderChange(event) {
    const genderIndex = Number(event.detail.value) || 0;
    const value = this.data.genderOptions[genderIndex];
    this.setData({ genderIndex, 'form.gender': value === '暂不填写' ? '' : value });
  },

  onHealthChange(event) {
    const healthIndex = Number(event.detail.value) || 0;
    this.setData({ healthIndex, 'form.healthStatus': this.data.healthOptions[healthIndex] });
  },

  onStatusChange(event) {
    const statusIndex = Number(event.detail.value) || 0;
    this.setData({ statusIndex, 'form.athleteStatus': this.data.statusOptions[statusIndex] });
  },

  toggleBodyMore() { this.setData({ showBodyMore: !this.data.showBodyMore }); },

  choosePhoto() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (file) this.setData({ photoFile: file.tempFilePath, photoUrl: file.tempFilePath });
      }
    });
  },

  async save() {
    if (this.data.saving) return;
    if (!this.data.form.name) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }
    this.setData({ saving: true, error: '' });
    try {
      const payload = personalProfilePayload(this.data.form);
      await api.updateMyAthleteProfile(payload);
      if (this.data.bodyTouched) {
        const body = Object.assign({}, this.data.body);
        BODY_FIELDS.forEach((key) => { body[key] = body[key] === '' ? null : Number(body[key]); });
        await api.updateBodyComposition(this.data.athleteId, body);
      }
      if (this.data.photoFile) await api.uploadAthletePhoto(this.data.athleteId, this.data.photoFile);
      const app = getApp();
      app.setProject(this.data.form.project);
      app.globalData.user = Object.assign({}, app.globalData.user, { displayName: payload.name });
      await loadContext({ refreshUser: true });
      wx.showToast({ title: '已同步到网页端', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 700);
    } catch (error) {
      this.setData({ error: error.message || '个人资料保存失败。' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
