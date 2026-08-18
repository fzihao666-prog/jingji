import { Check, Link2, MapPin, Save, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Athlete, User } from '../types';
import { PROVINCES } from '../../shared/regions';
import { ROLE_META } from '../../shared/access';
import { EditableName } from '../components/EditableName';

type AssignmentAthlete = Athlete & { coachIds: string };

export function RosterPage({ user, athletes: visibleAthletes, onChanged }: { user: User; athletes: Athlete[]; onChanged: () => void }) {
  const [athletes, setAthletes] = useState<AssignmentAthlete[]>([]);
  const [coaches, setCoaches] = useState<Array<{ id: number; displayName: string }>>([]);
  const [editing, setEditing] = useState<Record<number, number[]>>({});
  const [regionEditing, setRegionEditing] = useState<Record<number, string>>({});
  const [cityEditing, setCityEditing] = useState<Record<number, string>>({});
  const [countyEditing, setCountyEditing] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  const loadAssignments = async () => {
    const result = await api.assignments();
    setAthletes(result.athletes);
    setCoaches(result.coaches);
    setEditing(Object.fromEntries(result.athletes.map((athlete) => [athlete.id, athlete.coachIds ? athlete.coachIds.split(',').map(Number) : []])));
    setRegionEditing(Object.fromEntries(result.athletes.map((athlete) => [athlete.id, athlete.region])));
    setCityEditing(Object.fromEntries(result.athletes.map((athlete) => [athlete.id, athlete.city])));
    setCountyEditing(Object.fromEntries(result.athletes.map((athlete) => [athlete.id, athlete.county])));
  };

  useEffect(() => {
    void loadAssignments();
  }, [user.role]);

  const canManage = ROLE_META[user.role].level >= 3;
  const shown = athletes.length ? athletes : visibleAthletes;
  const toggleCoach = (athleteId: number, coachId: number) => {
    const current = editing[athleteId] || [];
    setEditing({ ...editing, [athleteId]: current.includes(coachId) ? current.filter((id) => id !== coachId) : [...current, coachId] });
  };
  const save = async (athleteId: number) => {
    setSaving(athleteId);
    try {
      await api.updateAssignment(
        athleteId,
        editing[athleteId] || [],
        regionEditing[athleteId],
        cityEditing[athleteId],
        countyEditing[athleteId]
      );
      setMessage('人员关系和所属地区已更新。');
      await loadAssignments();
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setSaving(null);
    }
  };

  const renameAthlete = async (athleteId: number, name: string) => {
    await api.renameAthlete(athleteId, name);
    await loadAssignments();
    setMessage('运动员姓名已修改。');
    onChanged();
  };

  const renameCoach = async (coachId: number, name: string) => {
    await api.renameUser(coachId, name);
    await loadAssignments();
    setMessage('教练姓名已修改。');
    onChanged();
  };

  return (
    <div className="page-content roster-page">
      <header className="page-heading compact-heading"><h1>人员关系</h1><span className="count-chip large"><UsersRound size={17} />{shown.length}名运动员</span></header>
      {message && <div className="message-banner success"><Check />{message}</div>}
      <section className="roster-grid">
        {shown.map((athlete) => {
          const assigned = editing[athlete.id] || [];
          return (
            <article className="athlete-card" key={athlete.id}>
              <div className="athlete-card-top"><div className="record-avatar large">{athlete.name.slice(0, 1)}</div><div><h2><EditableName value={athlete.name} canEdit={canManage || user.role === 'SCC'} onSave={(name) => renameAthlete(athlete.id, name)} label="运动员姓名" /></h2><p>{athlete.project} · {athlete.team}</p></div><span>{athlete.gender}</span></div>
              <div className="athlete-region-row">
                <span><MapPin size={15} />所属地区</span>
                {canManage ? (
                  <div className="roster-area-fields">
                    <select value={regionEditing[athlete.id] || ''} onChange={(event) => setRegionEditing({ ...regionEditing, [athlete.id]: event.target.value })}>
                      <option value="">省份</option>
                      {PROVINCES.map((region) => <option key={region}>{region}</option>)}
                    </select>
                    <input value={cityEditing[athlete.id] || ''} onChange={(event) => setCityEditing({ ...cityEditing, [athlete.id]: event.target.value })} placeholder="城市" />
                    <input value={countyEditing[athlete.id] || ''} onChange={(event) => setCountyEditing({ ...countyEditing, [athlete.id]: event.target.value })} placeholder="区县" />
                  </div>
                ) : <strong>{[athlete.region, athlete.city, athlete.county].filter(Boolean).join(' / ') || '未设置'}</strong>}
              </div>
              <div className="assignment-heading"><span><Link2 size={15} />负责教练</span>{canManage && <small>可多选</small>}</div>
              {canManage ? (
                <div className="coach-options">
                  {coaches.map((coach) => (
                    <div key={coach.id} className={`coach-option-item ${assigned.includes(coach.id) ? 'checked' : ''}`}>
                      <label aria-label={`选择${coach.displayName}`}>
                        <input type="checkbox" checked={assigned.includes(coach.id)} onChange={() => toggleCoach(athlete.id, coach.id)} />
                        <i>{assigned.includes(coach.id) && <Check size={13} />}</i>
                      </label>
                      <EditableName value={coach.displayName} canEdit={ROLE_META[user.role].level > ROLE_META.SCC.level} onSave={(name) => renameCoach(coach.id, name)} label="教练姓名" />
                    </div>
                  ))}
                </div>
              ) : <div className="coach-readonly">{athlete.coaches || '尚未绑定教练'}</div>}
              {canManage && <button className="save-assignment" disabled={saving === athlete.id} onClick={() => save(athlete.id)}><Save size={15} />{saving === athlete.id ? '保存中…' : '保存关系'}</button>}
            </article>
          );
        })}
      </section>
    </div>
  );
}
