import {
  Activity, AlertCircle, Archive, Check, ChevronLeft, ChevronRight, ClipboardPlus,
  Eye, Filter, HeartPulse, PencilLine, Plus, RefreshCw, Search, Trash2, Upload, UserRound, X
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ROLE_META } from '../../shared/access';
import { PROJECTS } from '../../shared/projects';
import { PROVINCES, PROVINCE_CITIES } from '../../shared/regions';
import { api } from '../api';
import type { Athlete, InjuryRecord, InjuryStatus, ProjectTeam, User } from '../types';

const PAGE_SIZE = 6;
const HEALTH_OPTIONS = ['健康', '观察', '训练受限', '康复中'];
const ATHLETE_STATUS_OPTIONS = ['在训', '集训', '休整', '离队'];
const TECHNICAL_LEVELS = ['国际级运动健将', '运动健将', '一级运动员', '二级运动员', '三级运动员'];

type CoachOption = { id: number; displayName: string };
type AthleteForm = {
  name: string; gender: string; birthDate: string; identityNumber: string; ethnicity: string;
  phone: string; bloodType: string; emergencyContact: string; emergencyPhone: string;
  education: string; technicalLevel: string; healthStatus: string; bestResult: string;
  nativePlace: string; homeAddress: string; project: string; team: string; region: string;
  city: string; county: string; athleteStatus: string; startSportDate: string;
  trainingVenue: string; currentEvent: string; trainingPhase: string; campPeriod: string;
  originPlace: string; originUnit: string; originCoach: string; specialties: string; notes: string;
  coachId: string; username: string; password: string;
};

const blankForm: AthleteForm = {
  name: '', gender: '男', birthDate: '', identityNumber: '', ethnicity: '汉族', phone: '', bloodType: '',
  emergencyContact: '', emergencyPhone: '', education: '', technicalLevel: '', healthStatus: '健康',
  bestResult: '', nativePlace: '', homeAddress: '', project: '赛艇', team: '', region: '', city: '', county: '',
  athleteStatus: '在训', startSportDate: '', trainingVenue: '', currentEvent: '', trainingPhase: '', campPeriod: '',
  originPlace: '', originUnit: '', originCoach: '', specialties: '', notes: '', coachId: '', username: '', password: ''
};

function formFromAthlete(athlete: Athlete): AthleteForm {
  return {
    ...blankForm,
    ...Object.fromEntries(Object.keys(blankForm).map((key) => [key, String(athlete[key as keyof Athlete] ?? '')])),
    coachId: String(athlete.coachUsers?.[0]?.id || ''), username: '', password: ''
  } as AthleteForm;
}

function ageFromBirthDate(value: string | null) {
  if (!value) return '—';
  const birth = new Date(value);
  if (Number.isNaN(birth.getTime())) return '—';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? String(age) : '—';
}

function monthKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function AthleteManagementPage({
  user,
  initialAthletes,
  onChanged,
  onOpenProfile
}: {
  user: User;
  initialAthletes: Athlete[];
  onChanged: () => void;
  onOpenProfile: (athlete: Athlete) => void;
}) {
  const [athletes, setAthletes] = useState(initialAthletes);
  const [teams, setTeams] = useState<ProjectTeam[]>([]);
  const [coaches, setCoaches] = useState<CoachOption[]>([]);
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [healthFilter, setHealthFilter] = useState('');
  const [eventFilter, setEventFilter] = useState('');
  const [advanced, setAdvanced] = useState({ venue: '', technicalLevel: '', athleteStatus: '', createdFrom: '', createdTo: '' });
  const [monthlyOnly, setMonthlyOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAthlete, setEditingAthlete] = useState<Athlete | null>(null);
  const [form, setForm] = useState<AthleteForm>(blankForm);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkForm, setBulkForm] = useState({ technicalLevel: '', healthStatus: '', currentEvent: '', athleteStatus: '', trainingPhase: '' });
  const [injuryAthlete, setInjuryAthlete] = useState<Athlete | null>(null);
  const [injuryForm, setInjuryForm] = useState({ injuryName: '', bodyPart: '', side: 'unspecified' as InjuryRecord['side'], status: 'observation' as InjuryStatus, painScore: 0, onsetDate: '', restrictions: '', rehabPlan: '', reviewDate: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');

  const canManage = ROLE_META[user.role].level >= ROLE_META.PRJ.level;

  const load = async () => {
    setLoading(true);
    try {
      const [athleteResult, teamResult, assignmentResult] = await Promise.all([api.athletes(), api.teams(), api.assignments()]);
      setAthletes(athleteResult.athletes);
      setTeams(teamResult.teams);
      setCoaches(assignmentResult.coaches);
    } catch (error) {
      setMessageTone('error'); setMessage(error instanceof Error ? error.message : '运动员名册加载失败。');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [user.id]);
  useEffect(() => { setAthletes(initialAthletes); }, [initialAthletes]);

  const projects = useMemo(() => [...new Set([...PROJECTS, ...athletes.map((athlete) => athlete.project)])], [athletes]);
  const visibleTeams = useMemo(() => teams.filter((team) => !projectFilter || team.project === projectFilter), [teams, projectFilter]);
  const formTeams = useMemo(() => teams.filter((team) => team.project === form.project), [teams, form.project]);
  const events = useMemo(() => [...new Set(athletes.map((athlete) => athlete.currentEvent).filter(Boolean))], [athletes]);
  const currentMonth = monthKey(new Date().toISOString());

  const stats = useMemo(() => ({
    total: athletes.length,
    training: athletes.filter((athlete) => ['在训', '集训'].includes(athlete.athleteStatus)).length,
    recovery: athletes.filter((athlete) => athlete.healthStatus !== '健康').length,
    newThisMonth: athletes.filter((athlete) => monthKey(athlete.createdAt) === currentMonth).length
  }), [athletes, currentMonth]);

  const filtered = useMemo(() => athletes.filter((athlete) => {
    const query = search.trim().toLocaleLowerCase();
    if (projectFilter && athlete.project !== projectFilter) return false;
    if (teamFilter && athlete.team !== teamFilter) return false;
    if (healthFilter === '__risk' && athlete.healthStatus === '健康') return false;
    if (healthFilter && healthFilter !== '__risk' && athlete.healthStatus !== healthFilter) return false;
    if (eventFilter && athlete.currentEvent !== eventFilter) return false;
    if (advanced.venue && !athlete.trainingVenue.toLocaleLowerCase().includes(advanced.venue.toLocaleLowerCase())) return false;
    if (advanced.technicalLevel && athlete.technicalLevel !== advanced.technicalLevel) return false;
    if (advanced.athleteStatus && athlete.athleteStatus !== advanced.athleteStatus) return false;
    if (advanced.createdFrom && athlete.createdAt.slice(0, 10) < advanced.createdFrom) return false;
    if (advanced.createdTo && athlete.createdAt.slice(0, 10) > advanced.createdTo) return false;
    if (monthlyOnly && monthKey(athlete.createdAt) !== currentMonth) return false;
    if (!query) return true;
    return [athlete.name, athlete.project, athlete.team, athlete.coaches, athlete.technicalLevel, athlete.currentEvent, athlete.region, athlete.city]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query));
  }), [athletes, search, projectFilter, teamFilter, healthFilter, eventFilter, advanced, monthlyOnly, currentMonth]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  const resetFilters = () => {
    setSearch(''); setProjectFilter(''); setTeamFilter(''); setHealthFilter(''); setEventFilter('');
    setAdvanced({ venue: '', technicalLevel: '', athleteStatus: '', createdFrom: '', createdTo: '' });
    setMonthlyOnly(false); setPage(1);
  };

  const openCreate = () => {
    const first = athletes[0];
    setEditingAthlete(null);
    setForm({ ...blankForm, project: first?.project || '赛艇', team: first?.team || '', region: first?.region || '', city: first?.city || '', county: first?.county || '' });
    setPhotoFile(null); setPhotoPreview(''); setEditorOpen(true);
  };

  const openEdit = (athlete: Athlete) => {
    setEditingAthlete(athlete); setForm(formFromAthlete(athlete)); setPhotoFile(null); setPhotoPreview(athlete.photoUrl || ''); setEditorOpen(true);
  };

  const choosePhoto = (file: File | null) => {
    setPhotoFile(file);
    if (photoPreview.startsWith('blob:')) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(file ? URL.createObjectURL(file) : editingAthlete?.photoUrl || '');
  };

  const saveAthlete = async (event: FormEvent, requestedOpenProfile = false) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const openProfileAfter = requestedOpenProfile || submitter?.value === 'profile';
    setSaving(true); setMessage('');
    try {
      let athleteId = editingAthlete?.id || 0;
      if (editingAthlete) await api.updateAthlete(editingAthlete.id, form);
      else athleteId = (await api.createAthlete(form)).id;
      if (photoFile) await api.uploadAthletePhoto(athleteId, photoFile);
      await load(); onChanged(); setEditorOpen(false); setMessageTone('success'); setMessage(editingAthlete ? '运动员资料已更新。' : '运动员及登录账号已创建。');
      if (openProfileAfter) {
        const result = await api.athletes();
        const target = result.athletes.find((athlete) => athlete.id === athleteId);
        if (target) onOpenProfile(target);
      }
    } catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : '运动员资料保存失败。'); }
    finally { setSaving(false); }
  };

  const deleteOne = async (athlete: Athlete) => {
    if (!window.confirm(`确认删除运动员“${athlete.name}”？账号将同步停用，历史数据继续保留。`)) return;
    try { const result = await api.deleteAthlete(athlete.id); setMessageTone('success'); setMessage(result.message); await load(); onChanged(); }
    catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : '删除失败。'); }
  };

  const deleteSelected = async () => {
    const ids = [...selectedIds];
    if (!ids.length || !window.confirm(`确认删除选中的 ${ids.length} 名运动员？`)) return;
    try { const result = await api.bulkDeleteAthletes(ids); setMessageTone('success'); setMessage(result.message); setSelectedIds(new Set()); await load(); onChanged(); }
    catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : '批量删除失败。'); }
  };

  const saveBulk = async () => {
    setSaving(true);
    try { const result = await api.bulkUpdateAthletes([...selectedIds], bulkForm); setMessageTone('success'); setMessage(result.message); setBulkOpen(false); setSelectedIds(new Set()); await load(); onChanged(); }
    catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : '批量修改失败。'); }
    finally { setSaving(false); }
  };

  const saveInjury = async (event: FormEvent) => {
    event.preventDefault(); if (!injuryAthlete) return; setSaving(true);
    try { const result = await api.createInjuryRecord(injuryAthlete.id, injuryForm); setMessageTone('success'); setMessage(result.message); setInjuryAthlete(null); await load(); onChanged(); }
    catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : '伤病记录保存失败。'); }
    finally { setSaving(false); }
  };

  const toggleSelected = (id: number) => setSelectedIds((current) => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const pageAllSelected = paged.length > 0 && paged.every((athlete) => selectedIds.has(athlete.id));
  const setPageSelection = () => setSelectedIds((current) => {
    const next = new Set(current); for (const athlete of paged) pageAllSelected ? next.delete(athlete.id) : next.add(athlete.id); return next;
  });

  return (
    <div className="page-content athlete-management-page">
      <header className="athlete-management-heading"><div><span>ATHLETE OPERATIONS</span><h1>运动员管理</h1><p>集中维护运动员账号、队伍归属、健康状态与完整档案。</p></div>{canManage && <button className="athlete-primary-action" onClick={openCreate}><Plus size={17} />新增运动员</button>}</header>
      {message && <div className={`message-banner ${messageTone}`}><Check size={16} />{message}</div>}

      <section className="athlete-pulse-rail" aria-label="运动员状态统计">
        <button className={!monthlyOnly && !healthFilter && !advanced.athleteStatus ? 'active' : ''} onClick={resetFilters}><small>全部在档</small><strong>{stats.total}</strong><span>查看全部人员</span></button>
        <button className={advanced.athleteStatus === '在训' ? 'active' : ''} onClick={() => { resetFilters(); setAdvanced((value) => ({ ...value, athleteStatus: '在训' })); }}><small>在训运动员</small><strong>{stats.training}</strong><span>当前训练状态</span></button>
        <button className={healthFilter === '__risk' ? 'active risk' : 'risk'} onClick={() => { resetFilters(); setHealthFilter('__risk'); }}><small>健康关注</small><strong>{stats.recovery}</strong><span>观察、受限或康复</span></button>
        <button className={monthlyOnly ? 'active' : ''} onClick={() => { resetFilters(); setMonthlyOnly(true); }}><small>本月新增</small><strong>{stats.newThisMonth}</strong><span>新建运动员档案</span></button>
      </section>

      <section className="athlete-directory-toolbar">
        <label className="athlete-search"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索姓名、队伍、教练、赛事或地区" aria-label="搜索运动员" /></label>
        <select value={projectFilter} onChange={(event) => { setProjectFilter(event.target.value); setTeamFilter(''); setPage(1); }} aria-label="筛选运动项目"><option value="">全部项目</option>{projects.map((project) => <option key={project}>{project}</option>)}</select>
        <select value={teamFilter} onChange={(event) => { setTeamFilter(event.target.value); setPage(1); }} aria-label="筛选所属队伍"><option value="">全部队伍</option>{visibleTeams.map((team) => <option key={team.id}>{team.name}</option>)}</select>
        <select value={healthFilter} onChange={(event) => { setHealthFilter(event.target.value); setPage(1); }} aria-label="筛选身体状态"><option value="">全部身体状态</option>{HEALTH_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select>
        <select value={eventFilter} onChange={(event) => { setEventFilter(event.target.value); setPage(1); }} aria-label="筛选备战赛事"><option value="">全部备战赛事</option>{events.map((event) => <option key={event}>{event}</option>)}</select>
        <button className="athlete-filter-button" onClick={() => setAdvancedOpen(true)}><Filter size={16} />高级筛选</button>
        <button className="athlete-refresh-button" onClick={() => void load()} disabled={loading} aria-label="刷新运动员名册"><RefreshCw size={16} /></button>
        {(search || projectFilter || teamFilter || healthFilter || eventFilter || monthlyOnly || Object.values(advanced).some(Boolean)) && <button className="athlete-reset-button" onClick={resetFilters}>重置</button>}
      </section>

      {canManage && <section className={`athlete-batch-bar ${selectedIds.size ? 'visible' : ''}`}><span>已选择 <strong>{selectedIds.size}</strong> 名运动员</span><button onClick={() => { setBulkForm({ technicalLevel: '', healthStatus: '', currentEvent: '', athleteStatus: '', trainingPhase: '' }); setBulkOpen(true); }} disabled={!selectedIds.size}><PencilLine size={15} />批量修改</button><button className="danger" onClick={() => void deleteSelected()} disabled={!selectedIds.size}><Trash2 size={15} />批量删除</button></section>}

      <section className="athlete-directory-card">
        <header><div><strong>运动员名册</strong><span>当前 {filtered.length} 条</span></div><small>每页显示 {PAGE_SIZE} 人，档案与伤病记录直接关联个人数据。</small></header>
        <div className="athlete-table-wrap"><table className="athlete-directory-table"><thead><tr>{canManage && <th><button className={`athlete-checkbox ${pageAllSelected ? 'checked' : ''}`} onClick={setPageSelection} aria-label="选择本页运动员">{pageAllSelected && <Check size={13} />}</button></th>}<th>运动员</th><th>项目与队伍</th><th>等级</th><th>身体状态</th><th>负责教练</th><th>备战赛事</th><th>训练状态</th><th>操作</th></tr></thead><tbody>
          {paged.map((athlete) => <tr key={athlete.id}>{canManage && <td><button className={`athlete-checkbox ${selectedIds.has(athlete.id) ? 'checked' : ''}`} onClick={() => toggleSelected(athlete.id)} aria-label={`选择${athlete.name}`}>{selectedIds.has(athlete.id) && <Check size={13} />}</button></td>}<td><div className="athlete-person-cell">{athlete.photoUrl ? <img src={athlete.photoUrl} alt="" /> : <span>{athlete.name.slice(0, 1)}</span>}<div><strong>{athlete.name}</strong><small>{athlete.gender} · {ageFromBirthDate(athlete.birthDate)} 岁</small></div></div></td><td><div className="athlete-team-cell"><strong>{athlete.project}</strong><small>{athlete.team || '未分队'}</small></div></td><td><span className="athlete-level-tag">{athlete.technicalLevel || '未定级'}</span></td><td><span className={`athlete-health-tag ${athlete.healthStatus === '健康' ? 'healthy' : 'attention'}`}><i />{athlete.healthStatus}</span></td><td><span className="athlete-coach-copy">{athlete.coaches || '未关联'}</span></td><td><span className="athlete-event-copy">{athlete.currentEvent || '暂无赛事'}</span></td><td><span className="athlete-training-status">{athlete.athleteStatus}</span></td><td><div className="athlete-row-actions"><button onClick={() => onOpenProfile(athlete)}><Eye size={14} />档案</button><button onClick={() => { setInjuryAthlete(athlete); setInjuryForm({ injuryName: '', bodyPart: '', side: 'unspecified', status: 'observation', painScore: 0, onsetDate: new Date().toISOString().slice(0, 10), restrictions: '', rehabPlan: '', reviewDate: '', note: '' }); }}><HeartPulse size={14} />伤病</button>{canManage && <><button onClick={() => openEdit(athlete)}><PencilLine size={14} />编辑</button><button className="danger" onClick={() => void deleteOne(athlete)}><Trash2 size={14} />删除</button></>}</div></td></tr>)}
        </tbody></table>{loading && <div className="athlete-table-state">正在刷新运动员名册…</div>}{!loading && !paged.length && <div className="athlete-table-state empty"><Search size={28} /><strong>没有符合条件的运动员</strong><p>调整筛选条件后再试。</p><button onClick={resetFilters}>查看全部运动员</button></div>}</div>
        <footer><span>显示 {filtered.length ? (safePage - 1) * PAGE_SIZE + 1 : 0}–{Math.min(safePage * PAGE_SIZE, filtered.length)}，共 {filtered.length} 人</span><nav aria-label="运动员分页"><button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft size={16} /></button><span>{safePage} / {pageCount}</span><button disabled={safePage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}><ChevronRight size={16} /></button></nav></footer>
      </section>

      {advancedOpen && <div className="modal-backdrop athlete-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdvancedOpen(false); }}><section className="athlete-compact-modal" role="dialog" aria-modal="true" aria-labelledby="athlete-filter-title"><header><div><span>ADVANCED FILTER</span><h2 id="athlete-filter-title">高级筛选</h2><p>进一步按训练属性和建档时间缩小范围。</p></div><button className="icon-button" onClick={() => setAdvancedOpen(false)} aria-label="关闭"><X size={18} /></button></header><div className="athlete-filter-grid"><label><span>训练场地</span><input value={advanced.venue} onChange={(event) => setAdvanced({ ...advanced, venue: event.target.value })} placeholder="例如：水上基地" /></label><label><span>技术等级</span><select value={advanced.technicalLevel} onChange={(event) => setAdvanced({ ...advanced, technicalLevel: event.target.value })}><option value="">全部等级</option>{TECHNICAL_LEVELS.map((level) => <option key={level}>{level}</option>)}</select></label><label><span>运动员状态</span><select value={advanced.athleteStatus} onChange={(event) => setAdvanced({ ...advanced, athleteStatus: event.target.value })}><option value="">全部状态</option>{ATHLETE_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label><label><span>建档开始日期</span><input type="date" value={advanced.createdFrom} onChange={(event) => setAdvanced({ ...advanced, createdFrom: event.target.value })} /></label><label><span>建档结束日期</span><input type="date" value={advanced.createdTo} onChange={(event) => setAdvanced({ ...advanced, createdTo: event.target.value })} /></label></div><footer><button className="secondary-button" onClick={() => setAdvanced({ venue: '', technicalLevel: '', athleteStatus: '', createdFrom: '', createdTo: '' })}>重置</button><button className="primary-button" onClick={() => { setPage(1); setAdvancedOpen(false); }}>应用筛选</button></footer></section></div>}

      {editorOpen && <div className="modal-backdrop athlete-editor-backdrop" role="presentation"><section className="athlete-editor-modal" role="dialog" aria-modal="true" aria-labelledby="athlete-editor-title"><header><div><span>{editingAthlete ? 'EDIT ATHLETE' : 'NEW ATHLETE'}</span><h2 id="athlete-editor-title">{editingAthlete ? '编辑运动员资料' : '新增运动员'}</h2><p>身份、账号与训练归属一次维护，档案数据自动联动。</p></div><button className="icon-button" onClick={() => setEditorOpen(false)} disabled={saving} aria-label="关闭"><X size={19} /></button></header><form onSubmit={(event) => void saveAthlete(event)}><div className="athlete-editor-scroll"><aside className="athlete-photo-field"><div>{photoPreview ? <img src={photoPreview} alt="运动员照片预览" /> : <UserRound size={34} />}</div><label><Upload size={15} />选择照片<input type="file" accept="image/jpeg,image/png" onChange={(event) => choosePhoto(event.target.files?.[0] || null)} /></label><small>支持 JPG/PNG，建议使用正方形证件照。</small></aside><div className="athlete-editor-sections"><section><h3><b>01</b>基础身份</h3><div className="athlete-form-grid"><label><span>姓名*</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><label><span>性别*</span><select value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value })}><option>男</option><option>女</option></select></label><label><span>出生日期</span><input type="date" value={form.birthDate} onChange={(event) => setForm({ ...form, birthDate: event.target.value })} /></label><label><span>身份证号</span><input value={form.identityNumber} onChange={(event) => setForm({ ...form, identityNumber: event.target.value.toUpperCase() })} maxLength={18} /></label><label><span>民族</span><input value={form.ethnicity} onChange={(event) => setForm({ ...form, ethnicity: event.target.value })} /></label><label><span>手机号</span><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} maxLength={11} /></label><label><span>血型</span><input value={form.bloodType} onChange={(event) => setForm({ ...form, bloodType: event.target.value })} placeholder="例如 A型" /></label><label><span>学历</span><input value={form.education} onChange={(event) => setForm({ ...form, education: event.target.value })} /></label><label><span>紧急联系人</span><input value={form.emergencyContact} onChange={(event) => setForm({ ...form, emergencyContact: event.target.value })} /></label><label><span>紧急联系电话</span><input value={form.emergencyPhone} onChange={(event) => setForm({ ...form, emergencyPhone: event.target.value })} maxLength={11} /></label><label><span>籍贯</span><input value={form.nativePlace} onChange={(event) => setForm({ ...form, nativePlace: event.target.value })} /></label><label className="wide"><span>家庭住址</span><input value={form.homeAddress} onChange={(event) => setForm({ ...form, homeAddress: event.target.value })} /></label></div></section><section><h3><b>02</b>训练归属</h3><div className="athlete-form-grid"><label><span>运动项目*</span><select value={form.project} onChange={(event) => setForm({ ...form, project: event.target.value, team: '' })}>{PROJECTS.map((project) => <option key={project}>{project}</option>)}</select></label><label><span>所属队伍*</span><select value={form.team} onChange={(event) => setForm({ ...form, team: event.target.value })} required><option value="">请选择队伍</option>{formTeams.map((team) => <option key={team.id}>{team.name}</option>)}</select></label><label><span>负责教练</span><select value={form.coachId} onChange={(event) => setForm({ ...form, coachId: event.target.value })}><option value="">暂不关联</option>{coaches.map((coach) => <option key={coach.id} value={coach.id}>{coach.displayName}</option>)}</select></label><label><span>技术等级</span><select value={form.technicalLevel} onChange={(event) => setForm({ ...form, technicalLevel: event.target.value })}><option value="">未定级</option>{TECHNICAL_LEVELS.map((level) => <option key={level}>{level}</option>)}</select></label><label><span>身体状态</span><select value={form.healthStatus} onChange={(event) => setForm({ ...form, healthStatus: event.target.value })}>{HEALTH_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label><label><span>训练状态</span><select value={form.athleteStatus} onChange={(event) => setForm({ ...form, athleteStatus: event.target.value })}>{ATHLETE_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label><label><span>开始运动日期</span><input type="date" value={form.startSportDate} onChange={(event) => setForm({ ...form, startSportDate: event.target.value })} /></label><label><span>训练场地</span><input value={form.trainingVenue} onChange={(event) => setForm({ ...form, trainingVenue: event.target.value })} /></label><label><span>备战赛事</span><input value={form.currentEvent} onChange={(event) => setForm({ ...form, currentEvent: event.target.value })} /></label><label><span>备战阶段</span><input value={form.trainingPhase} onChange={(event) => setForm({ ...form, trainingPhase: event.target.value })} /></label><label><span>集训时间</span><input value={form.campPeriod} onChange={(event) => setForm({ ...form, campPeriod: event.target.value })} /></label><label><span>优势项</span><input value={form.specialties} onChange={(event) => setForm({ ...form, specialties: event.target.value })} /></label><label><span>最好成绩</span><input value={form.bestResult} onChange={(event) => setForm({ ...form, bestResult: event.target.value })} /></label><label><span>输送地</span><input value={form.originPlace} onChange={(event) => setForm({ ...form, originPlace: event.target.value })} /></label><label><span>输送单位</span><input value={form.originUnit} onChange={(event) => setForm({ ...form, originUnit: event.target.value })} /></label><label><span>输送教练</span><input value={form.originCoach} onChange={(event) => setForm({ ...form, originCoach: event.target.value })} /></label></div></section><section><h3><b>03</b>地区与账号</h3><div className="athlete-form-grid"><label><span>省份*</span><select value={form.region} onChange={(event) => setForm({ ...form, region: event.target.value, city: '', county: '' })} required><option value="">请选择省份</option>{PROVINCES.map((province) => <option key={province}>{province}</option>)}</select></label><label><span>城市*</span><select value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value, county: '' })} required><option value="">请选择城市</option>{(PROVINCE_CITIES[form.region] || []).map((city) => <option key={city}>{city}</option>)}</select></label><label><span>区县*</span><input value={form.county} onChange={(event) => setForm({ ...form, county: event.target.value })} required /></label>{!editingAthlete && <><label><span>登录账号*</span><input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase() })} placeholder="字母、数字或下划线" required /></label><label><span>初始密码*</span><input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="至少8位，含字母和数字" required /></label></>}<label className="wide"><span>备注</span><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} /></label></div></section></div></div><footer><button type="button" className="secondary-button" onClick={() => setEditorOpen(false)} disabled={saving}>取消</button><button type="submit" className="secondary-button" disabled={saving}>{saving ? '保存中…' : '保存资料'}</button><button type="button" className="primary-button" disabled={saving} onClick={(event) => void saveAthlete(event as unknown as FormEvent, true)}>{saving ? '保存中…' : '保存并进入档案'}</button></footer></form></section></div>}

      {bulkOpen && <div className="modal-backdrop athlete-modal-backdrop" role="presentation"><section className="athlete-compact-modal" role="dialog" aria-modal="true" aria-labelledby="athlete-bulk-title"><header><div><span>BATCH UPDATE</span><h2 id="athlete-bulk-title">批量修改 {selectedIds.size} 人</h2><p>只会覆盖已填写的项目，留空内容保持不变。</p></div><button className="icon-button" onClick={() => setBulkOpen(false)} aria-label="关闭"><X size={18} /></button></header><div className="athlete-filter-grid"><label><span>技术等级</span><select value={bulkForm.technicalLevel} onChange={(event) => setBulkForm({ ...bulkForm, technicalLevel: event.target.value })}><option value="">保持不变</option>{TECHNICAL_LEVELS.map((level) => <option key={level}>{level}</option>)}</select></label><label><span>身体状态</span><select value={bulkForm.healthStatus} onChange={(event) => setBulkForm({ ...bulkForm, healthStatus: event.target.value })}><option value="">保持不变</option>{HEALTH_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label><label><span>训练状态</span><select value={bulkForm.athleteStatus} onChange={(event) => setBulkForm({ ...bulkForm, athleteStatus: event.target.value })}><option value="">保持不变</option>{ATHLETE_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}</select></label><label><span>备战赛事</span><input value={bulkForm.currentEvent} onChange={(event) => setBulkForm({ ...bulkForm, currentEvent: event.target.value })} /></label><label><span>备战阶段</span><input value={bulkForm.trainingPhase} onChange={(event) => setBulkForm({ ...bulkForm, trainingPhase: event.target.value })} /></label></div><footer><button className="secondary-button" onClick={() => setBulkOpen(false)}>取消</button><button className="primary-button" onClick={() => void saveBulk()} disabled={saving}>{saving ? '保存中…' : '保存批量修改'}</button></footer></section></div>}

      {injuryAthlete && <div className="modal-backdrop athlete-modal-backdrop" role="presentation"><section className="athlete-injury-modal" role="dialog" aria-modal="true" aria-labelledby="athlete-injury-title"><header><div><span>INJURY RECORD</span><h2 id="athlete-injury-title">新增伤病记录</h2><p>{injuryAthlete.name} · {injuryAthlete.project} · {injuryAthlete.team}</p></div><button className="icon-button" onClick={() => setInjuryAthlete(null)} disabled={saving} aria-label="关闭"><X size={18} /></button></header><form onSubmit={saveInjury}><div className="athlete-injury-grid"><label><span>问题名称或诊断*</span><input value={injuryForm.injuryName} onChange={(event) => setInjuryForm({ ...injuryForm, injuryName: event.target.value })} required /></label><label><span>身体部位*</span><input value={injuryForm.bodyPart} onChange={(event) => setInjuryForm({ ...injuryForm, bodyPart: event.target.value })} required /></label><label><span>身体侧别</span><select value={injuryForm.side} onChange={(event) => setInjuryForm({ ...injuryForm, side: event.target.value as InjuryRecord['side'] })}><option value="unspecified">未指定</option><option value="left">左侧</option><option value="right">右侧</option><option value="bilateral">双侧</option><option value="center">中央</option></select></label><label><span>当前状态</span><select value={injuryForm.status} onChange={(event) => setInjuryForm({ ...injuryForm, status: event.target.value as InjuryStatus })}><option value="observation">观察</option><option value="restricted">训练受限</option><option value="rehab">康复中</option><option value="suspended">暂停训练</option><option value="healthy">已恢复</option></select></label><label><span>疼痛评分 0–10</span><input type="number" min={0} max={10} value={injuryForm.painScore} onChange={(event) => setInjuryForm({ ...injuryForm, painScore: Number(event.target.value) })} /></label><label><span>发生日期</span><input type="date" value={injuryForm.onsetDate} onChange={(event) => setInjuryForm({ ...injuryForm, onsetDate: event.target.value })} /></label><label className="wide"><span>训练限制</span><textarea rows={2} value={injuryForm.restrictions} onChange={(event) => setInjuryForm({ ...injuryForm, restrictions: event.target.value })} /></label><label className="wide"><span>康复计划</span><textarea rows={2} value={injuryForm.rehabPlan} onChange={(event) => setInjuryForm({ ...injuryForm, rehabPlan: event.target.value })} /></label><label><span>复查日期</span><input type="date" value={injuryForm.reviewDate} onChange={(event) => setInjuryForm({ ...injuryForm, reviewDate: event.target.value })} /></label><label><span>备注</span><input value={injuryForm.note} onChange={(event) => setInjuryForm({ ...injuryForm, note: event.target.value })} /></label></div><footer><button type="button" className="secondary-button" onClick={() => setInjuryAthlete(null)} disabled={saving}>取消</button><button className="primary-button" disabled={saving}><ClipboardPlus size={15} />{saving ? '保存中…' : '保存伤病记录'}</button></footer></form></section></div>}
    </div>
  );
}
