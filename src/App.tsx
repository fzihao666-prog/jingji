import { BluetoothConnectPage } from './pages/BluetoothConnectPage';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api';
import { AppShell, type PageKey, type SpecialPageKey } from './components/AppShell';
import { BrandLogo } from './components/BrandLogo';
import { LoginPage } from './pages/LoginPage';
import type { Athlete, Project, TrainingRecord, User } from './types';
import { addDays, toIsoDate } from './utils';
import { isProject, PROJECTS } from '../shared/projects';

const OverviewPage = lazy(() => import('./pages/OverviewPage').then((module) => ({ default: module.OverviewPage })));
const SpecialTestsPage = lazy(() => import('./pages/SpecialTestsPage').then((module) => ({ default: module.SpecialTestsPage })));
const TrainingPlanPage = lazy(() => import('./pages/TrainingPlanPage').then((module) => ({ default: module.TrainingPlanPage })));
const PersonalPage = lazy(() => import('./pages/PersonalPage').then((module) => ({ default: module.PersonalPage })));
const AthleteManagementPage = lazy(() => import('./pages/AthleteManagementPage').then((module) => ({ default: module.AthleteManagementPage })));
const CoachManagementPage = lazy(() => import('./pages/CoachManagementPage').then((module) => ({ default: module.CoachManagementPage })));
const TeamsPage = lazy(() => import('./pages/TeamsPage').then((module) => ({ default: module.TeamsPage })));
const AccountsPage = lazy(() => import('./pages/AccountsPage').then((module) => ({ default: module.AccountsPage })));
const RegionAccessPage = lazy(() => import('./pages/RegionAccessPage').then((module) => ({ default: module.RegionAccessPage })));

const today = toIsoDate(new Date());

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(getToken()));
  const [page, setPage] = useState<PageKey>('overview');
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [from, setFrom] = useState(addDays(today, -27));
  const [to, setTo] = useState(today);
  const [athleteId, setAthleteId] = useState<number | null>(null);
  const [project, setProject] = useState<Project>('赛艇');
  const [athletesReady, setAthletesReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [globalError, setGlobalError] = useState('');

  useEffect(() => {
    if (!getToken()) return;
    api.me().then(({ user: current }) => setUser(current)).catch(() => setToken(null)).finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    setAthletesReady(false);
    api.athletes()
      .then(({ athletes: nextAthletes }) => {
        setAthletes(nextAthletes);
        const ownProject = user.athleteId ? nextAthletes.find((athlete) => athlete.id === user.athleteId)?.project : '';
        const available = [...new Set(nextAthletes.map((athlete) => athlete.project))].filter(isProject);
        if (isProject(ownProject)) setProject(ownProject);
        else if (!available.includes(project) && available[0]) setProject(available[0]);
        if (user.role === 'ATL' && user.athleteId) setAthleteId(user.athleteId);
      })
      .catch((error) => setGlobalError(error instanceof Error ? error.message : '运动员数据加载失败。'))
      .finally(() => setAthletesReady(true));
  }, [user, refreshKey]);

  useEffect(() => {
    if (!user || !athletesReady) return;
    const selected = athleteId ? athletes.find((athlete) => athlete.id === athleteId) : null;
    if (selected && selected.project !== project) {
      setAthleteId(user.role === 'ATL' ? user.athleteId : null);
      return;
    }
    setLoading(true);
    setGlobalError('');
    api.records(from, to, athleteId, project)
      .then(({ records: nextRecords }) => setRecords(nextRecords))
      .catch((error) => setGlobalError(error instanceof Error ? error.message : '训练数据加载失败。'))
      .finally(() => setLoading(false));
  }, [user, athletesReady, athletes, from, to, athleteId, project, refreshKey]);

  const projects = useMemo(() => {
    if (user?.role === 'DMD' || user?.role === 'TD') return [...PROJECTS];
    return [...new Set(athletes.map((athlete) => athlete.project))].filter(isProject);
  }, [athletes, user?.role]);
  const projectAthletes = useMemo(() => athletes.filter((athlete) => athlete.project === project), [athletes, project]);

  const login = (token: string, current: User) => {
    setToken(token);
    setUser(current);
    setAthleteId(current.role === 'ATL' ? current.athleteId : null);
    setPage('overview');
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    setAthletes([]);
    setRecords([]);
    setAthleteId(null);
    setAthletesReady(false);
  };

  const renameOwnProfile = async (name: string) => {
    const result = await api.updateProfileName(name);
    setUser(result.user);
    if (result.user.athleteId) {
      setAthletes((current) => current.map((athlete) => athlete.id === result.user.athleteId ? { ...athlete, name } : athlete));
      setRecords((current) => current.map((record) => record.athleteId === result.user.athleteId ? { ...record, athleteName: name } : record));
    }
    setRefreshKey((key) => key + 1);
  };

  const renameAthlete = async (id: number, name: string) => {
    await api.renameAthlete(id, name);
    setAthletes((current) => current.map((athlete) => athlete.id === id ? { ...athlete, name } : athlete));
    setRecords((current) => current.map((record) => record.athleteId === id ? { ...record, athleteName: name } : record));
    setRefreshKey((key) => key + 1);
  };

  const renameVisibleUser = async (id: number, name: string) => {
    await api.renameUser(id, name);
    setAthletes((current) => current.map((athlete) => {
      if (!athlete.coachUsers?.some((coach) => coach.id === id)) return athlete;
      const coachUsers = athlete.coachUsers.map((coach) => coach.id === id ? { ...coach, displayName: name } : coach);
      return { ...athlete, coachUsers, coaches: coachUsers.map((coach) => coach.displayName).join('、') };
    }));
    setRefreshKey((key) => key + 1);
  };

  if (authLoading) return <div className="boot-screen"><BrandLogo className="large" /><strong>竞迹</strong><p>正在恢复训练数据会话…</p></div>;
  if (!user) return <LoginPage onLogin={login} />;

  const shared = {
    records,
    athletes: projectAthletes,
    project,
    projects: projects.length ? projects : [project],
    from,
    to,
    athleteId,
    loading,
    onRangeChange: (nextFrom: string, nextTo: string) => { setFrom(nextFrom); setTo(nextTo); },
    onAthleteChange: setAthleteId,
    onProjectChange: (nextProject: Project) => { setProject(nextProject); setAthleteId(null); }
  };

  return (
    <AppShell user={user} page={page} onPageChange={setPage} onLogout={logout} onProfileNameChange={renameOwnProfile} project={project} projects={projects.length ? projects : [project]} onProjectChange={(nextProject) => { setProject(nextProject); setAthleteId(null); }}>
      {globalError && <div className="global-error">{globalError}</div>}
      <Suspense fallback={<div className="route-loading"><BrandLogo /><p>正在打开页面…</p></div>}>
        {page === 'overview' && <OverviewPage {...shared} user={user} onAthleteNameChange={renameAthlete} onUserNameChange={renameVisibleUser} />}
        {page.startsWith('special-') && <SpecialTestsPage {...shared} user={user} section={page as SpecialPageKey} onSectionChange={setPage} onChanged={() => setRefreshKey((key) => key + 1)} />}
        {page === 'plans' && <TrainingPlanPage user={user} athletes={projectAthletes} athleteId={athleteId} onAthleteChange={setAthleteId} onChanged={() => setRefreshKey((key) => key + 1)} />}
        {page === 'bluetooth' && <BluetoothConnectPage user={user} />}
        {page === 'athletes' && user.role !== 'ATL' && <AthleteManagementPage user={user} initialAthletes={athletes} onChanged={() => setRefreshKey((key) => key + 1)} onOpenProfile={(athlete) => { if (isProject(athlete.project)) setProject(athlete.project); setAthleteId(athlete.id); setPage('personal'); }} />}
        {page === 'personal' && <PersonalPage {...shared} user={user} />}
        {page === 'coaches' && user.role !== 'ATL' && <CoachManagementPage user={user} athletes={projectAthletes} onChanged={() => setRefreshKey((key) => key + 1)} />}
        {page === 'teams' && user.role !== 'ATL' && <TeamsPage />}
        {page === 'regions' && user.role !== 'ATL' && <RegionAccessPage user={user} />}
        {page === 'accounts' && user.role !== 'ATL' && <AccountsPage />}
      </Suspense>
    </AppShell>
  );
}
