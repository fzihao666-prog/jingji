import { CalendarRange, CheckCircle2, Gauge, Route, Save } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { analyzeRowingPeriod } from '../../shared/rowing-model';
import { analyzeCanoePeriod } from '../../shared/canoe-model';
import { analyzeSlalomPeriod } from '../../shared/slalom-model';
import { DateToolbar } from '../components/DateToolbar';
import { InjuryRecoveryModule } from '../components/InjuryRecoveryModule';
import { StrengthProfileModule } from '../components/StrengthProfileModule';
import { BodyCompositionModelOverview, type BodyCompositionProfile } from '../components/AthleteProfileCharts';
import { api } from '../api';
import type { Athlete, BodyCompositionRecord, Project, TrainingRecord, User } from '../types';
import { addDays, formatNumber } from '../utils';

type Props = {
  user: User;
  records: TrainingRecord[];
  athletes: Athlete[];
  from: string;
  to: string;
  athleteId: number | null;
  loading: boolean;
  onRangeChange: (from: string, to: string) => void;
  onAthleteChange: (athleteId: number | null) => void;
  project: Project;
  projects: Project[];
  onProjectChange: (project: Project) => void;
  onChanged: () => void;
};

type BodyCompositionForm = {
  measurementDate: string;
  heightCm: string;
  weightKg: string;
  bodyFatPct: string;
  skeletalMuscleKg: string;
  muscleMassKg: string;
  upperLimbMuscleKg: string;
  lowerLimbMuscleKg: string;
  trunkMuscleKg: string;
  subcutaneousFatMm: string;
  tricepsSkinfoldMm: string;
  abdominalSkinfoldMm: string;
  thighSkinfoldMm: string;
  calfSkinfoldMm: string;
  visceralFatLevel: string;
  basalMetabolismKcal: string;
  totalBodyWaterKg: string;
  ecwTbwRatio: string;
  phaseAngleDeg: string;
  visceralFatAreaCm2: string;
  leftArmLeanKg: string;
  rightArmLeanKg: string;
  trunkLeanKg: string;
  leftLegLeanKg: string;
  rightLegLeanKg: string;
  note: string;
};

const bodyCompositionFields: Array<{ key: keyof BodyCompositionForm; label: string; unit: string; group: '基础' | '肌肉' | '脂肪' | '节段' | '水合' }> = [
  { key: 'heightCm', label: '身高', unit: 'cm', group: '基础' },
  { key: 'weightKg', label: '体重', unit: 'kg', group: '基础' },
  { key: 'bodyFatPct', label: '体脂率', unit: '%', group: '基础' },
  { key: 'skeletalMuscleKg', label: '骨骼肌量', unit: 'kg', group: '肌肉' },
  { key: 'muscleMassKg', label: '肌肉总量', unit: 'kg', group: '肌肉' },
  { key: 'upperLimbMuscleKg', label: '上肢肌量', unit: 'kg', group: '肌肉' },
  { key: 'lowerLimbMuscleKg', label: '下肢肌量', unit: 'kg', group: '肌肉' },
  { key: 'trunkMuscleKg', label: '躯干肌量', unit: 'kg', group: '肌肉' },
  { key: 'subcutaneousFatMm', label: '皮下脂肪', unit: 'mm', group: '脂肪' },
  { key: 'tricepsSkinfoldMm', label: '肱三头肌皮褶', unit: 'mm', group: '脂肪' },
  { key: 'abdominalSkinfoldMm', label: '腹部皮褶', unit: 'mm', group: '脂肪' },
  { key: 'thighSkinfoldMm', label: '大腿皮褶', unit: 'mm', group: '脂肪' },
  { key: 'calfSkinfoldMm', label: '小腿皮褶', unit: 'mm', group: '脂肪' },
  { key: 'visceralFatLevel', label: '内脏脂肪等级', unit: '级', group: '脂肪' },
  { key: 'visceralFatAreaCm2', label: '内脏脂肪面积', unit: 'cm²', group: '脂肪' },
  { key: 'basalMetabolismKcal', label: '基础代谢', unit: 'kcal', group: '基础' },
  { key: 'totalBodyWaterKg', label: '总体水', unit: 'kg', group: '水合' },
  { key: 'ecwTbwRatio', label: '细胞外水比', unit: '比值', group: '水合' },
  { key: 'phaseAngleDeg', label: '全身相位角', unit: '°', group: '水合' },
  { key: 'leftArmLeanKg', label: '左上肢去脂量', unit: 'kg', group: '节段' },
  { key: 'rightArmLeanKg', label: '右上肢去脂量', unit: 'kg', group: '节段' },
  { key: 'trunkLeanKg', label: '躯干去脂量', unit: 'kg', group: '节段' },
  { key: 'leftLegLeanKg', label: '左下肢去脂量', unit: 'kg', group: '节段' },
  { key: 'rightLegLeanKg', label: '右下肢去脂量', unit: 'kg', group: '节段' }
];

function bodyValue(value: number | null | undefined) {
  return value === null || value === undefined ? '' : String(value);
}

function ageAtDate(birthDate: string | null, date: string) {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T12:00:00`);
  const target = new Date(`${date}T12:00:00`);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(target.getTime())) return null;
  let age = target.getFullYear() - birth.getFullYear();
  if (target.getMonth() < birth.getMonth() || (target.getMonth() === birth.getMonth() && target.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

export function PersonalPage(props: Props) {
  const selectedAthlete = useMemo(
    () => props.athletes.find((athlete) => athlete.id === (props.athleteId || props.user.athleteId)) || null,
    [props.athletes, props.athleteId, props.user.athleteId]
  );
  const selectedRecords = useMemo(
    () => selectedAthlete ? props.records.filter((record) => record.athleteId === selectedAthlete.id) : [],
    [props.records, selectedAthlete]
  );
  const [positionDraft, setPositionDraft] = useState('');
  const [positionSaving, setPositionSaving] = useState(false);
  const [positionMessage, setPositionMessage] = useState('');
  const canEditOwnPosition = props.user.role === 'ATL' && selectedAthlete?.id === props.user.athleteId;
  const canEditBodyComposition = Boolean(selectedAthlete && (props.user.role !== 'ATL' || selectedAthlete.id === props.user.athleteId));
  const [bodyForm, setBodyForm] = useState<BodyCompositionForm>({
    measurementDate: props.to,
    heightCm: '',
    weightKg: '',
    bodyFatPct: '',
    skeletalMuscleKg: '',
    muscleMassKg: '',
    upperLimbMuscleKg: '',
    lowerLimbMuscleKg: '',
    trunkMuscleKg: '',
    subcutaneousFatMm: '',
    tricepsSkinfoldMm: '',
    abdominalSkinfoldMm: '',
    thighSkinfoldMm: '',
    calfSkinfoldMm: '',
    visceralFatLevel: '',
    basalMetabolismKcal: '',
    totalBodyWaterKg: '',
    ecwTbwRatio: '',
    phaseAngleDeg: '',
    visceralFatAreaCm2: '',
    leftArmLeanKg: '',
    rightArmLeanKg: '',
    trunkLeanKg: '',
    leftLegLeanKg: '',
    rightLegLeanKg: '',
    note: ''
  });
  const [bodySaving, setBodySaving] = useState(false);
  const [bodyMessage, setBodyMessage] = useState('');
  const [bodyHistory, setBodyHistory] = useState<BodyCompositionRecord[]>([]);
  const [bodyHistoryLoading, setBodyHistoryLoading] = useState(false);
  const [bodyHistoryRevision, setBodyHistoryRevision] = useState(0);

  useEffect(() => {
    let ignored = false;
    if (!selectedAthlete) {
      setBodyHistory([]);
      return;
    }
    setBodyHistoryLoading(true);
    api.getBodyCompositionHistory(selectedAthlete.id)
      .then((result) => { if (!ignored) setBodyHistory(result.history); })
      .catch(() => { if (!ignored) setBodyHistory([]); })
      .finally(() => { if (!ignored) setBodyHistoryLoading(false); });
    return () => { ignored = true; };
  }, [selectedAthlete?.id, bodyHistoryRevision]);

  const bodyCompositionProfile = useMemo<BodyCompositionProfile | null>(() => {
    if (!selectedAthlete) return null;
    const latest = bodyHistory[0];
    return {
      athleteId: selectedAthlete.id,
      athleteName: selectedAthlete.name,
      project: selectedAthlete.project,
      team: selectedAthlete.team,
      gender: selectedAthlete.gender,
      age: ageAtDate(selectedAthlete.birthDate, props.to),
      bodyMeasurementDate: latest?.measurementDate || selectedAthlete.bodyMeasurementDate,
      heightCm: latest?.heightCm ?? selectedAthlete.heightCm,
      weightKg: latest?.weightKg ?? selectedAthlete.weightKg,
      bodyFatPct: latest?.bodyFatPct ?? selectedAthlete.bodyFatPct,
      skeletalMuscleKg: latest?.skeletalMuscleKg ?? selectedAthlete.skeletalMuscleKg,
      upperLimbMuscleKg: latest?.upperLimbMuscleKg ?? selectedAthlete.upperLimbMuscleKg,
      lowerLimbMuscleKg: latest?.lowerLimbMuscleKg ?? selectedAthlete.lowerLimbMuscleKg,
      trunkMuscleKg: latest?.trunkMuscleKg ?? selectedAthlete.trunkMuscleKg,
      tricepsSkinfoldMm: latest?.tricepsSkinfoldMm ?? selectedAthlete.tricepsSkinfoldMm,
      abdominalSkinfoldMm: latest?.abdominalSkinfoldMm ?? selectedAthlete.abdominalSkinfoldMm,
      thighSkinfoldMm: latest?.thighSkinfoldMm ?? selectedAthlete.thighSkinfoldMm,
      calfSkinfoldMm: latest?.calfSkinfoldMm ?? selectedAthlete.calfSkinfoldMm,
      visceralFatLevel: latest?.visceralFatLevel ?? selectedAthlete.visceralFatLevel,
      basalMetabolismKcal: latest?.basalMetabolismKcal ?? selectedAthlete.basalMetabolismKcal,
      totalBodyWaterKg: latest?.totalBodyWaterKg ?? selectedAthlete.totalBodyWaterKg,
      ecwTbwRatio: latest?.ecwTbwRatio ?? selectedAthlete.ecwTbwRatio,
      phaseAngleDeg: latest?.phaseAngleDeg ?? selectedAthlete.phaseAngleDeg,
      visceralFatAreaCm2: latest?.visceralFatAreaCm2 ?? selectedAthlete.visceralFatAreaCm2,
      leftArmLeanKg: latest?.leftArmLeanKg ?? selectedAthlete.leftArmLeanKg,
      rightArmLeanKg: latest?.rightArmLeanKg ?? selectedAthlete.rightArmLeanKg,
      trunkLeanKg: latest?.trunkLeanKg ?? selectedAthlete.trunkLeanKg,
      leftLegLeanKg: latest?.leftLegLeanKg ?? selectedAthlete.leftLegLeanKg,
      rightLegLeanKg: latest?.rightLegLeanKg ?? selectedAthlete.rightLegLeanKg,
      bodyCompositionHistory: bodyHistory
    };
  }, [selectedAthlete, bodyHistory, props.to]);

  useEffect(() => {
    setPositionDraft(selectedAthlete?.athletePosition || '');
    setPositionMessage('');
  }, [selectedAthlete?.id, selectedAthlete?.athletePosition]);

  useEffect(() => {
    setBodyForm({
      measurementDate: selectedAthlete?.bodyMeasurementDate || props.to,
      heightCm: bodyValue(selectedAthlete?.heightCm),
      weightKg: bodyValue(selectedAthlete?.weightKg),
      bodyFatPct: bodyValue(selectedAthlete?.bodyFatPct),
      skeletalMuscleKg: bodyValue(selectedAthlete?.skeletalMuscleKg),
      muscleMassKg: bodyValue(selectedAthlete?.muscleMassKg),
      upperLimbMuscleKg: bodyValue(selectedAthlete?.upperLimbMuscleKg),
      lowerLimbMuscleKg: bodyValue(selectedAthlete?.lowerLimbMuscleKg),
      trunkMuscleKg: bodyValue(selectedAthlete?.trunkMuscleKg),
      subcutaneousFatMm: bodyValue(selectedAthlete?.subcutaneousFatMm),
      tricepsSkinfoldMm: bodyValue(selectedAthlete?.tricepsSkinfoldMm),
      abdominalSkinfoldMm: bodyValue(selectedAthlete?.abdominalSkinfoldMm),
      thighSkinfoldMm: bodyValue(selectedAthlete?.thighSkinfoldMm),
      calfSkinfoldMm: bodyValue(selectedAthlete?.calfSkinfoldMm),
      visceralFatLevel: bodyValue(selectedAthlete?.visceralFatLevel),
      basalMetabolismKcal: bodyValue(selectedAthlete?.basalMetabolismKcal),
      totalBodyWaterKg: bodyValue(selectedAthlete?.totalBodyWaterKg),
      ecwTbwRatio: bodyValue(selectedAthlete?.ecwTbwRatio),
      phaseAngleDeg: bodyValue(selectedAthlete?.phaseAngleDeg),
      visceralFatAreaCm2: bodyValue(selectedAthlete?.visceralFatAreaCm2),
      leftArmLeanKg: bodyValue(selectedAthlete?.leftArmLeanKg),
      rightArmLeanKg: bodyValue(selectedAthlete?.rightArmLeanKg),
      trunkLeanKg: bodyValue(selectedAthlete?.trunkLeanKg),
      leftLegLeanKg: bodyValue(selectedAthlete?.leftLegLeanKg),
      rightLegLeanKg: bodyValue(selectedAthlete?.rightLegLeanKg),
      note: selectedAthlete?.bodyMeasurementNote || ''
    });
    setBodyMessage('');
  }, [selectedAthlete, props.to]);

  const savePosition = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedAthlete || !canEditOwnPosition) return;
    setPositionSaving(true);
    setPositionMessage('');
    try {
      await api.updateAthletePosition(selectedAthlete.id, positionDraft);
      props.onChanged();
      setPositionMessage('位置/号位已保存。');
    } catch (error) {
      setPositionMessage(error instanceof Error ? error.message : '位置/号位保存失败。');
    } finally {
      setPositionSaving(false);
    }
  };

  const saveBodyComposition = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedAthlete || !canEditBodyComposition) return;
    setBodySaving(true);
    setBodyMessage('');
    const payload = Object.fromEntries(Object.entries(bodyForm).map(([key, value]) => [
      key,
      key === 'measurementDate' || key === 'note' || value === '' ? value : Number(value)
    ]));
    try {
      await api.saveBodyComposition(selectedAthlete.id, payload);
      props.onChanged();
      setBodyHistoryRevision((current) => current + 1);
      setBodyMessage('身体成分记录已保存。');
    } catch (error) {
      setBodyMessage(error instanceof Error ? error.message : '身体成分保存失败。');
    } finally {
      setBodySaving(false);
    }
  };
  const analyzePeriod = analyzerForProject(selectedAthlete?.project || props.project);
  const rangeAnalysis = useMemo(() => analyzePeriod(selectedRecords), [selectedRecords, analyzePeriod]);
  const rangeMode = useMemo(() => {
    if (props.from === props.to) return { label: '日' } as const;
    if (props.from === addDays(props.to, -6)) return { label: '周' } as const;
    if (props.from === addDays(props.to, -29)) return { label: '月' } as const;
    return { label: '所选周期' } as const;
  }, [props.from, props.to]);

  return (
    <div className="page-content personal-page">
      <header className="page-heading">
        <div>
          <h1>个人档案</h1>
          <p>查看运动员基础信息、训练表现、伤病恢复与体能测试档案</p>
        </div>
        <DateToolbar {...props} presetMode="period" />
      </header>

      {!selectedAthlete ? (
        <section className="personal-empty">
          <CalendarRange size={34} />
          <strong>先选择一名运动员</strong>
          <p>在右上角选择运动员后，可查看完整个人档案。</p>
        </section>
      ) : (
        <>
          <section className="personal-identity-card">
            <div className={`personal-avatar ${selectedAthlete.photoUrl ? 'has-photo' : ''}`}>
              {selectedAthlete.photoUrl
                ? <img src={selectedAthlete.photoUrl} alt={`${selectedAthlete.name}证件照`} />
                : selectedAthlete.name.slice(0, 1)}
            </div>
            <div className="personal-identity-copy">
              <span>{selectedAthlete.project} · {selectedAthlete.team}</span>
              <h2>{selectedAthlete.name}</h2>
              <p>{selectedAthlete.province}{selectedAthlete.city}{selectedAthlete.county} · 位置/号位 {selectedAthlete.athletePosition || '未填写'} · 教练 {selectedAthlete.coaches || '未绑定'}</p>
              {canEditOwnPosition && <form className="personal-position-editor" onSubmit={savePosition}>
                <label><span>位置/号位</span><input value={positionDraft} onChange={(event) => setPositionDraft(event.target.value)} maxLength={40} placeholder="例如：舵手、1号位、左桨" /></label>
                <button disabled={positionSaving || positionDraft === (selectedAthlete.athletePosition || '')}><Save size={14} />{positionSaving ? '保存中' : '保存'}</button>
                {positionMessage && <small>{positionMessage}</small>}
              </form>}
            </div>
            <div className="personal-grade" style={{ '--grade-color': rangeAnalysis.status.color } as CSSProperties}>
              <span>{rangeMode.label}分级</span>
              <strong>{rangeAnalysis.status.label}</strong>
              <small>{rangeAnalysis.status.basis}</small>
            </div>
          </section>

          <section className="personal-metric-grid">
            <PersonalMetric icon={Gauge} label={`${rangeMode.label}负荷`} value={formatNumber(rangeAnalysis.totalSrpe)} unit="SRPE" />
            <PersonalMetric icon={Route} label="专项距离" value={formatNumber(rangeAnalysis.totalDistanceKm, 1)} unit="km" />
            <PersonalMetric icon={CalendarRange} label="训练课次" value={String(rangeAnalysis.sessions)} unit="课" />
            <PersonalMetric icon={CheckCircle2} label="数据完整率" value={formatNumber(rangeAnalysis.dataCoverage, 1)} unit="%" />
          </section>

          <section className="panel professional-panel body-composition-card personal-body-assessment-card">
            <header className="personal-body-assessment-heading">
              <div><span>PHYSIQUE ASSESSMENT</span><h2>运动员身体成分评估</h2><p>节段去脂、肌脂平衡、水合状态与复测趋势</p></div>
              <small>{bodyHistoryLoading ? '正在读取身体成分历史…' : `已读取 ${bodyHistory.length} 次实测记录`}</small>
            </header>
            <BodyCompositionModelOverview profiles={bodyCompositionProfile ? [bodyCompositionProfile] : []} records={selectedRecords} individual />
            <p className="analysis-method-note">身体成分用于训练适应、营养干预和控重阶段观察；模拟项仅用于展示，录入实测值后自动替换。</p>
          </section>

          <section className="personal-body-composition-card">
            <header>
              <div>
                <span>BODY COMPOSITION</span>
                <h2>身体成分记录</h2>
                <p>按测量日期记录身体成分、节段去脂、水合相位角与关键皮褶厚度。</p>
              </div>
              <strong>{selectedAthlete.bodyMeasurementDate || '暂无记录'}</strong>
            </header>
            <form onSubmit={saveBodyComposition}>
              <div className="personal-body-date-row">
                <label><span>测量日期</span><input type="date" value={bodyForm.measurementDate} onChange={(event) => setBodyForm({ ...bodyForm, measurementDate: event.target.value })} required disabled={!canEditBodyComposition || bodySaving} /></label>
                {bodyMessage && <small>{bodyMessage}</small>}
              </div>
              {(['基础', '肌肉', '节段', '脂肪', '水合'] as const).map((group) => (
                <fieldset key={group}>
                  <legend>{group}指标</legend>
                  <div className="personal-body-grid">
                    {bodyCompositionFields.filter((field) => field.group === group).map((field) => (
                      <label key={field.key}>
                        <span>{field.label}</span>
                        <input type="number" step="0.1" value={bodyForm[field.key]} onChange={(event) => setBodyForm({ ...bodyForm, [field.key]: event.target.value })} disabled={!canEditBodyComposition || bodySaving} />
                        <em>{field.unit}</em>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <label className="personal-body-note"><span>备注</span><textarea value={bodyForm.note} onChange={(event) => setBodyForm({ ...bodyForm, note: event.target.value })} rows={2} maxLength={300} disabled={!canEditBodyComposition || bodySaving} placeholder="例如：晨起空腹测量、赛前减脂期、恢复周复测" /></label>
              <footer><button className="primary-button" disabled={!canEditBodyComposition || bodySaving}><Save size={14} />{bodySaving ? '保存中' : '保存身体成分'}</button></footer>
            </form>
          </section>

          <InjuryRecoveryModule athlete={selectedAthlete} user={props.user} />
          <StrengthProfileModule athlete={selectedAthlete} user={props.user} />
        </>
      )}
    </div>
  );
}

function PersonalMetric({ icon: Icon, label, value, unit }: { icon: typeof Gauge; label: string; value: string; unit: string }) {
  return <article><Icon size={19} /><span>{label}</span><strong>{value}<small>{unit}</small></strong></article>;
}

function analyzerForProject(project: string) {
  return project === '激流' ? analyzeSlalomPeriod : project === '皮划艇' ? analyzeCanoePeriod : analyzeRowingPeriod;
}
