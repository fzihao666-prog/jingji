import { BluetoothConnectPage } from './pages/BluetoothConnectPage';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api';
import { AppShell, type PageKey, type SpecialPageKey, type StrengthPageKey } from './components/AppShell';
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
const DataImportPage = lazy(() => import('./pages/DataImportPage').then((module) => ({ default: module.DataImportPage })));

const today = toIsoDate(new Date());

function orderedProjects(values: string[]) {
  const available = new Set(values.filter(isProject));
  return PROJECTS.filter((project) => available.has(project));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(getToken()));
  const [page, setPage] = useState<PageKey>('overview');
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [athleteId, setAthleteId] = useState<number | null>(null);
  const [project, setProject] = useState<Project | null>(null);
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
        const available = orderedProjects(nextAthletes.map((athlete) => athlete.project));
        const fallback = user.role === 'DMD' || user.role === 'TD' ? PROJECTS[0] : null;
        if (isProject(ownProject)) setProject(ownProject);
        else if (available[0]) setProject(available[0]);
        else setProject(fallback);
        if (user.role === 'ATL' && user.athleteId) setAthleteId(user.athleteId);
      })
      .catch((error) => {
        setGlobalError(error instanceof Error ? error.message : '运动员数据加载失败。');
        setProject(user.role === 'DMD' || user.role === 'TD' ? PROJECTS[0] : null);
      })
      .finally(() => setAthletesReady(true));
  }, [user, refreshKey]);

  useEffect(() => {
    if (!user || !athletesReady || !project) return;
    const selected = athleteId ? athletes.find((athlete) => athlete.id === athleteId) : null;
    if (selected && selected.project !== project) {
      setAthleteId(user.role === 'ATL' ? user.athleteId : null);
      return;
    }
    setLoading(true);
    setGlobalError('');
    const recordAthleteId = page === 'special-athletes' && user.role !== 'ATL' ? null : athleteId;
    api.records(from, to, recordAthleteId, project)
      .then(({ records: nextRecords }) => setRecords(nextRecords))
      .catch((error) => setGlobalError(error instanceof Error ? error.message : '训练数据加载失败。'))
      .finally(() => setLoading(false));
  }, [user, athletesReady, athletes, from, to, athleteId, project, page, refreshKey]);

  const projects = useMemo(() => {
    if (user?.role === 'DMD' || user?.role === 'TD') return [...PROJECTS];
    return orderedProjects(athletes.map((athlete) => athlete.project));
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
    setProject(null);
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
  if (!athletesReady) return <div className="boot-screen"><BrandLogo className="large" /><strong>竞迹</strong><p>正在加载项目信息…</p></div>;
  if (!project) return <div className="boot-screen"><BrandLogo className="large" /><strong>竞迹</strong><p>当前账号暂无可访问项目。</p></div>;

  const shared = {
    records,
    athletes: projectAthletes,
    project,
    projects: projects.length ? projects : project ? [project] : [],
    from,
    to,
    athleteId,
    loading,
    onRangeChange: (nextFrom: string, nextTo: string) => { setFrom(nextFrom); setTo(nextTo); },
    onAthleteChange: setAthleteId,
    onProjectChange: (nextProject: Project) => { setProject(nextProject); setAthleteId(null); }
  };

  return (
    <AppShell user={user} page={page} onPageChange={setPage} onLogout={logout} onProfileNameChange={renameOwnProfile}>
      {globalError && <div className="global-error">{globalError}</div>}
      <Suspense fallback={<div className="route-loading"><BrandLogo /><p>正在打开页面…</p></div>}>
        {page === 'overview' && <OverviewPage {...shared} user={user} onAthleteNameChange={renameAthlete} onUserNameChange={renameVisibleUser} />}
        {page.startsWith('special-') && <SpecialTestsPage {...shared} user={user} section={page as SpecialPageKey} onSectionChange={setPage} onChanged={() => setRefreshKey((key) => key + 1)} />}
        {page.startsWith('strength-') && <TrainingPlanPage section={page as StrengthPageKey} user={user} athletes={projectAthletes} athleteId={athleteId} onAthleteChange={setAthleteId} onChanged={() => setRefreshKey((key) => key + 1)} />}
        {page === 'bluetooth' && <BluetoothConnectPage user={user} />}
        {page === 'data-import' && user.role !== 'ATL' && <DataImportPage user={user} project={project} athletes={projectAthletes} onChanged={() => setRefreshKey((key) => key + 1)} />}
        {page === 'athletes' && user.role !== 'ATL' && <AthleteManagementPage user={user} initialAthletes={athletes} onChanged={() => setRefreshKey((key) => key + 1)} onOpenProfile={(athlete) => { if (isProject(athlete.project)) setProject(athlete.project); setAthleteId(athlete.id); setPage('personal'); }} />}
        {page === 'personal' && <PersonalPage {...shared} user={user} onChanged={() => setRefreshKey((key) => key + 1)} />}
        {page === 'coaches' && user.role !== 'ATL' && <CoachManagementPage user={user} athletes={projectAthletes} onChanged={() => setRefreshKey((key) => key + 1)} />}
        {page === 'teams' && user.role !== 'ATL' && <TeamsPage />}
        {page === 'regions' && user.role !== 'ATL' && <RegionAccessPage user={user} />}
        {page === 'accounts' && user.role !== 'ATL' && <AccountsPage />}
      </Suspense>
    </AppShell>
  );
}
