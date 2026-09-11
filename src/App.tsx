import { BluetoothConnectPage } from './pages/BluetoothConnectPage';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api';
import { AppShell, type PageKey, type SpecialPageKey, type StrengthPageKey } from './components/AppShell';
import { BrandLogo } from './components/BrandLogo';
import { DateToolbar } from './components/DateToolbar';
import { LoginPage } from './pages/LoginPage';
import { PhysiologyBiochemistryPage } from './pages/PhysiologyBiochemistryPage';
import { StrengthTrainingDashboard } from './pages/TrainingDashboards';
import type { Athlete, Project, TrainingRecord, User } from './types';
import { addDays, toIsoDate } from './utils';
import { DEFAULT_PROJECT, isProject, normalizeProject, PROJECTS } from '../shared/projects';

const OverviewPage = lazy(() => import('./pages/OverviewPage').then((module) => ({ default: module.OverviewPage })));
const SpecialTrainingDashboard = lazy(() => import('./pages/SpecialTrainingDashboard').then((module) => ({ default: module.SpecialTrainingDashboard })));
const SpecialTestsPage = lazy(() => import('./pages/SpecialTestsPage').then((module) => ({ default: module.SpecialTestsPage })));
const TrainingPlanPage = lazy(() => import('./pages/TrainingPlanPage').then((module) => ({ default: module.TrainingPlanPage })));
const PersonalPage = lazy(() => import('./pages/PersonalPage').then((module) => ({ default: module.PersonalPage })));
const AthleteManagementPage = lazy(() => import('./pages/AthleteManagementPage').then((module) => ({ default: module.AthleteManagementPage })));
const CoachManagementPage = lazy(() => import('./pages/CoachManagementPage').then((module) => ({ default: module.CoachManagementPage })));
const TeamsPage = lazy(() => import('./pages/TeamsPage').then((module) => ({ default: module.TeamsPage })));
const AccountsPage = lazy(() => import('./pages/AccountsPage').then((module) => ({ default: module.AccountsPage })));
const RegionAccessPage = lazy(() => import('./pages/RegionAccessPage').then((module) => ({ default: module.RegionAccessPage })));
const DataImportPage = lazy(() => import('./pages/DataImportPage').then((module) => ({ default: module.DataImportPage })));
const DataManagementPage = lazy(() => import('./pages/DataManagementPage').then((module) => ({ default: module.DataManagementPage })));

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
  const [from, setFrom] = useState(addDays(today, -6));
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
    Promise.all([api.athletes(), api.currentProject()])
      .then(([{ athletes: nextAthletes }, saved]) => {
        setAthletes(nextAthletes);
        const ownProject = user.athleteId ? nextAthletes.find((athlete) => athlete.id === user.athleteId)?.project : '';
        const available = saved.projects.length ? saved.projects : orderedProjects(nextAthletes.map((athlete) => athlete.project));
        const fallback = user.role === 'DMD' || user.role === 'TD' ? DEFAULT_PROJECT : null;
        const normalizedOwnProject = normalizeProject(ownProject);
        if (saved.project && available.includes(saved.project)) setProject(saved.project);
        else if (available.length === 1) setProject(available[0]);
        else if (normalizedOwnProject && available.includes(normalizedOwnProject)) setProject(normalizedOwnProject);
        else if (available[0]) setProject(available[0]);
        else setProject(fallback);
        if (user.role === 'ATL' && user.athleteId) setAthleteId(user.athleteId);
      })
      .catch((error) => {
        setGlobalError(error instanceof Error ? error.message : '运动员数据加载失败。');
        setProject(user.role === 'DMD' || user.role === 'TD' ? DEFAULT_PROJECT : null);
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
    if (page === 'overview' || page === 'special-overview') {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setGlobalError('');
    api.records(from, to, null, project)
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
    onProjectChange: (nextProject: Project) => { setProject(nextProject); setAthleteId(null); void api.saveCurrentProject(nextProject).catch(() => undefined); }
  };
  const usesGlobalTrainingFilter = page === 'overview' || page === 'physiology-biochemistry' || page === 'personal' || page.startsWith('special-') || page.startsWith('strength-');

  return (
    <AppShell user={user} page={page} onPageChange={setPage} onLogout={logout} onProfileNameChange={renameOwnProfile}>
      {globalError && <div className="global-error">{globalError}</div>}
      {usesGlobalTrainingFilter && <div className="global-training-filter">
        <DateToolbar
          {...shared}
          presetMode="period"
        />
      </div>}
      <Suspense fallback={<div className="route-loading"><BrandLogo /><p>正在打开页面…</p></div>}>
        {page === 'overview' && <OverviewPage {...shared} user={user} />}
        {page === 'special-overview' && <SpecialTrainingDashboard athletes={projectAthletes} athleteId={athleteId} project={project} from={from} to={to} onAthleteChange={setAthleteId} onRecordsOpen={() => setPage('special-records')} />}
        {page.startsWith('special-') && page !== 'special-overview' && <SpecialTestsPage {...shared} section={page as Exclude<SpecialPageKey, 'special-overview'>} onSectionChange={setPage} />}
        {page === 'strength-overview' && <StrengthTrainingDashboard athletes={projectAthletes} athleteId={athleteId} project={project} from={from} to={to} onNavigate={setPage} onAthleteChange={setAthleteId} />}
        {page.startsWith('strength-') && page !== 'strength-overview' && <TrainingPlanPage section={page as Exclude<StrengthPageKey, 'strength-overview'>} user={user} athletes={projectAthletes} athleteId={athleteId} from={from} to={to} onSectionChange={setPage} onChanged={() => setRefreshKey((key) => key + 1)} />}
        {page === 'physiology-biochemistry' && <PhysiologyBiochemistryPage project={project} from={from} to={to} />}
        {page === 'bluetooth' && <BluetoothConnectPage user={user} />}
        {page === 'data-import' && user.role !== 'ATL' && <DataImportPage user={user} project={project} athletes={projectAthletes} mode="import" onChanged={() => setRefreshKey((key) => key + 1)} />}
        {page === 'data-import-history' && user.role !== 'ATL' && <DataImportPage user={user} project={project} athletes={projectAthletes} mode="history" onChanged={() => setRefreshKey((key) => key + 1)} />}
        {page === 'data-management' && user.role !== 'ATL' && <DataManagementPage user={user} />}
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
