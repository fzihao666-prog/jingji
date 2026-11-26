import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';
import { trainingRecordScope } from './training-record-scope';
import { finishPageLoadRecovery, recoverPageLoad } from './page-load-recovery';
import {
  AppShell,
  type PageKey,
  type SpecialPageKey,
  type StrengthPageKey,
} from './components/AppShell';
import { BrandLogo } from './components/BrandLogo';
import { DateToolbar } from './components/DateToolbar';
import { LoginPage } from './pages/LoginPage';
import type { Athlete, Project, ProjectTeam, TrainingRecord, User } from './types';
import { addDays, toIsoDate } from './utils';
import { SYSTEM_MANAGEMENT_ROLES } from '../shared/access';
import { isProject, PROJECTS } from '../shared/projects';

const BluetoothConnectPage = lazy(() =>
  import('./pages/BluetoothConnectPage').then((module) => ({
    default: module.BluetoothConnectPage,
  }))
);
const PhysiologyBiochemistryPage = lazy(() =>
  import('./pages/PhysiologyBiochemistryPage').then((module) => ({
    default: module.PhysiologyBiochemistryPage,
  }))
);
const EnodePage = lazy(() => import('./pages/EnodePage').then(module => ({ default: module.EnodePage })));
const StrengthTrainingDashboard = lazy(() =>
  import('./pages/TrainingDashboards').then((module) => ({
    default: module.StrengthTrainingDashboard,
  }))
);

const OverviewPage = lazy(() =>
  import('./pages/OverviewPage').then((module) => ({ default: module.OverviewPage }))
);
const SpecialTrainingDashboard = lazy(() =>
  import('./pages/SpecialTrainingDashboard').then((module) => ({
    default: module.SpecialTrainingDashboard,
  }))
);
const SpecialTestsPage = lazy(() =>
  import('./pages/SpecialTestsPage').then((module) => ({ default: module.SpecialTestsPage }))
);
const StrengthTrainingAnalysisPage = lazy(() =>
  import('./pages/StrengthTrainingAnalysisPage').then((module) => ({
    default: module.StrengthTrainingAnalysisPage,
  }))
);
const UnifiedTrainingPlansPage = lazy(() =>
  import('./pages/UnifiedTrainingPlansPage').then((module) => ({
    default: module.UnifiedTrainingPlansPage,
  }))
);
const PersonalPage = lazy(() =>
  import('./pages/PersonalPage').then((module) => ({ default: module.PersonalPage }))
);
const AthleteManagementPage = lazy(() =>
  import('./pages/AthleteManagementPage').then((module) => ({
    default: module.AthleteManagementPage,
  }))
);
const CoachManagementPage = lazy(() =>
  import('./pages/CoachManagementPage').then((module) => ({ default: module.CoachManagementPage }))
);
const TeamsPage = lazy(() =>
  import('./pages/TeamsPage').then((module) => ({ default: module.TeamsPage }))
);
const AiManagementPage = lazy(() =>
  import('./pages/AiManagementPage').then((module) => ({ default: module.AiManagementPage }))
);
const AccountsPage = lazy(() =>
  import('./pages/AccountsPage').then((module) => ({ default: module.AccountsPage }))
);
const RegionAccessPage = lazy(() =>
  import('./pages/RegionAccessPage').then((module) => ({ default: module.RegionAccessPage }))
);
const DataImportPage = lazy(() =>
  import('./pages/DataImportPage').then((module) => ({ default: module.DataImportPage }))
);
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((module) => ({ default: module.ReportsPage }))
);
const DataManagementPage = lazy(() =>
  import('./pages/DataManagementPage').then((module) => ({ default: module.DataManagementPage }))
);


const today = toIsoDate(new Date());
const pageKeys: PageKey[] = [
  'overview',
  'training-plans',
  'special-overview',
  'special-volume',
  'special-time',
  'special-load',
  'special-rate',
  'special-heart',
  'special-power',
  'special-records',
  'special-schedule',
  'strength-overview',
  'strength-plan',
  'strength-records',
  'strength-analysis',
  'strength-assessment',
  'strength-enode',
  'physiology-biochemistry',
  'athletes',
  'personal',
  'coaches',
  'teams',
  'regions',
  'accounts',
  'ai-management',
  'bluetooth',
  'data-import',
  'data-management',
  'reports',
];

function pageFromHash(): PageKey {
  const key =
    window.location.hash.replace(/^#\/?/, '').split('?')[0] ||
    (window.location.pathname === '/training-plans' ? 'training-plans' : '');
  if (key === 'team-training-stats') return 'special-overview';
  if (key === 'data-import-history') return 'data-import';
  if (key === 'special-schedule' || key === 'strength-plan') return 'training-plans';
  return pageKeys.includes(key as PageKey) ? (key as PageKey) : 'overview';
}

function writePageHash(page: PageKey, query = '') {
  const nextHash = `#/${page}${query}`;
  if (window.location.hash !== nextHash) window.history.pushState(null, '', nextHash);
}

function orderedProjects(values: string[]) {
  const available = new Set(values.filter(isProject));
  return PROJECTS.filter((project) => available.has(project));
}

function RouteContent({
  onReady,
  children,
}: {
  onReady: () => void;
  children: ReactNode;
}) {
  useEffect(onReady, [onReady]);
  return children;
}

class RouteErrorBoundary extends Component<{ page: PageKey; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  private hasRenderedRoute = false;

  private markRouteReady = () => {
    if (this.hasRenderedRoute) return;
    this.hasRenderedRoute = true;
    finishPageLoadRecovery();
  };

  componentDidCatch(error: Error) {
    void recoverPageLoad(error, () => this.state.failed && !this.hasRenderedRoute);
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: { page: PageKey }) {
    if (this.state.failed && previous.page !== this.props.page) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed)
      return (
        <Suspense
          fallback={
            <div className="route-loading" role="status">
              <BrandLogo />
              <p>正在打开页面…</p>
            </div>
          }
        >
          <RouteContent onReady={this.markRouteReady}>{this.props.children}</RouteContent>
        </Suspense>
      );
    return (
      <div className="route-loading" role="alert">
        <p>页面加载失败，请重新打开当前页面。</p>
        <button type="button" className="secondary-button" onClick={() => window.location.reload()}>
          重新打开
        </button>
      </div>
    );
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [sessionStatus, setSessionStatus] = useState<'loading' | 'failed' | 'ready'>(() =>
    getToken() ? 'loading' : 'ready'
  );
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [requestedPage, setPage] = useState<PageKey>(() => pageFromHash());
  const canOpenSystemPages = Boolean(user && SYSTEM_MANAGEMENT_ROLES.includes(user.role));
  const restrictedPage =
    (requestedPage === 'ai-management' && user?.role !== 'DMD') ||
    (!canOpenSystemPages && (requestedPage === 'regions' || requestedPage === 'accounts')) ||
    (user?.role === 'OBS' && ['athletes', 'coaches', 'teams', 'data-import', 'data-management', 'reports', 'bluetooth'].includes(requestedPage));
  const page = restrictedPage ? 'overview' : requestedPage;
  const [routeHash, setRouteHash] = useState(() => window.location.hash);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [teamSelection, setTeamSelection] = useState<{ project: Project; id: number } | null>(null);
  const [teamOptions, setTeamOptions] = useState<{ project: Project; teams: ProjectTeam[] } | null>(null);
  const [teamError, setTeamError] = useState('');
  const [athleteId, setAthleteId] = useState<number | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const teamId = teamSelection?.project === project ? teamSelection.id : null;
  const teams = teamOptions?.project === project ? teamOptions.teams : [];
  const [authorizedProjects, setAuthorizedProjects] = useState<Project[]>([]);
  const [athletesReady, setAthletesReady] = useState(false);
  const [projectReady, setProjectReady] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [rosterError, setRosterError] = useState('');
  const rosterUserRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    if (!user || !project) return;
    let active = true;
    setTeamError('');
    api.overviewTeams(project).then(({ teams }) => {
      if (!active) return;
      setTeamOptions({ project, teams });
      setTeamSelection(current => current?.project === project && !teams.some(team => team.id === current.id) ? null : current);
    }).catch(() => { if (active) { setTeamOptions(null); setTeamError('队伍列表加载失败，请刷新重试'); } });
    return () => { active = false; };
  }, [user, project, refreshKey]);
  const [globalError, setGlobalError] = useState('');
  const importNavigationGuard = useRef<(() => boolean) | null>(null);
  const acceptedHash = useRef(window.location.hash);
  const setImportNavigationGuard = useCallback((guard: (() => boolean) | null) => {
    importNavigationGuard.current = guard;
  }, []);

  useEffect(() => {
    const syncPageFromHash = () => {
      if (window.location.hash === acceptedHash.current) return;
      if (importNavigationGuard.current && !importNavigationGuard.current()) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${acceptedHash.current}`);
        return;
      }
      acceptedHash.current = window.location.hash;
      setPage(pageFromHash());
      setRouteHash(window.location.hash);
    };
    window.addEventListener('hashchange', syncPageFromHash);
    return () => window.removeEventListener('hashchange', syncPageFromHash);
  }, []);

  const changePage = (nextPage: PageKey, query?: string) => {
    if (nextPage !== page && importNavigationGuard.current && !importNavigationGuard.current()) return false;
    if (nextPage === 'special-schedule' || nextPage === 'strength-plan') {
      const kind = nextPage === 'special-schedule' ? 'special' : 'physical';
      const source =
        page.startsWith('special-') || page.startsWith('strength-')
          ? page
          : kind === 'special'
            ? 'special-overview'
            : 'strength-overview';
      window.location.hash = `/training-plans?type=${kind}&source=${source}`;
      acceptedHash.current = window.location.hash;
      setPage('training-plans');
      return true;
    }
    setPage(nextPage);
    writePageHash(nextPage, query);
    acceptedHash.current = window.location.hash;
    setRouteHash(window.location.hash);
    return true;
  };

  useEffect(() => {
    if (!getToken()) {
      setSessionStatus('ready');
      return;
    }
    let active = true;
    api
      .me()
      .then(({ user: current }) => {
        if (!active) return;
        setUser(current);
        setSessionStatus('ready');
      })
      .catch(() => {
        if (active) setSessionStatus(getToken() ? 'failed' : 'ready');
      });
    return () => { active = false; };
  }, [sessionAttempt]);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    if (rosterUserRef.current !== user.id) {
      setAthletesReady(false);
      setProjectReady(false);
    }
    rosterUserRef.current = user.id;
    setProjectError('');
    setRosterError('');
    if (user.role === 'ATL' && user.athleteId) setAthleteId(user.athleteId);

    api.currentProject(controller.signal)
      .then((saved) => {
        if (controller.signal.aborted) return;
        const available = orderedProjects(saved.projects);
        setAuthorizedProjects(available);
        setProject(saved.project && available.includes(saved.project) ? saved.project : available[0] ?? null);
        setProjectReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setProjectError('项目信息加载失败，请重试。');
      });

    api.athletes({ signal: controller.signal, timeoutMs: 15000 })
      .then(({ athletes: nextAthletes }) => {
        if (controller.signal.aborted) return;
        setAthletes(nextAthletes);
        setAthletesReady(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setRosterError('运动员名册加载失败，请重试。');
      });

    return () => controller.abort();
  }, [user, refreshKey]);

  const recordScope = trainingRecordScope(
    page,
    user?.role === 'ATL' ? (user.athleteId ?? null) : athleteId
  );
  const recordsRequired = recordScope !== undefined;
  const recordsAthleteId = recordScope?.athleteId ?? null;

  useEffect(() => {
    if (!user || !athletesReady || !project) return;
    const selected = recordsAthleteId
      ? athletes.find((athlete) => athlete.id === recordsAthleteId)
      : null;
    if (selected && selected.project !== project) {
      setAthleteId(user.role === 'ATL' ? user.athleteId : null);
      return;
    }
    if (!recordsRequired) {
      setRecords([]);
      setLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setRecords([]);
    setLoading(true);
    setGlobalError('');
    api
      .records(from, to, recordsAthleteId, project, teamId ?? undefined, controller.signal)
      .then(({ records: nextRecords }) => { if (active) setRecords(nextRecords); })
      .catch((error) =>
        active && setGlobalError(error instanceof Error ? error.message : '训练数据加载失败。')
      )
      .finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    user,
    athletesReady,
    athletes,
    from,
    to,
    recordsAthleteId,
    project,
    teamId,
    recordsRequired,
    refreshKey,
  ]);

  const projects = authorizedProjects;
  const projectAthletes = useMemo(
    () => athletes.filter((athlete) => athlete.project === project && (teamId === null || athlete.teamId === teamId)),
    [athletes, project, teamId]
  );

  const login = (token: string, current: User) => {
    setToken(token);
    setUser(current);
    setAthleteId(current.role === 'ATL' ? current.athleteId : null);
    changePage('overview');
  };

  const logout = async () => {
    if (importNavigationGuard.current && !importNavigationGuard.current()) return;
    try {
      await api.logout();
    } catch {
      // 注销接口失败时仍清除本地登录态
    }
    setToken(null);
    setUser(null);
    rosterUserRef.current = null;
    setAthletes([]);
    setRecords([]);
    setAthleteId(null);
    setProject(null);
    setTeamSelection(null);
    setTeamOptions(null);
    setAuthorizedProjects([]);
    setAthletesReady(false);
    setProjectReady(false);
  };

  const renameOwnProfile = async (name: string) => {
    const result = await api.updateProfileName(name);
    setUser(result.user);
    if (result.user.athleteId) {
      setAthletes((current) =>
        current.map((athlete) =>
          athlete.id === result.user.athleteId ? { ...athlete, name } : athlete
        )
      );
      setRecords((current) =>
        current.map((record) =>
          record.athleteId === result.user.athleteId ? { ...record, athleteName: name } : record
        )
      );
    }
    setRefreshKey((key) => key + 1);
  };

  if (sessionStatus !== 'ready')
    return (
      <div className="boot-screen">
        <BrandLogo className="large" />
        <strong>竞迹</strong>
        <p>{sessionStatus === 'loading' ? '正在恢复训练数据会话…' : '暂时无法恢复登录状态，请重试。'}</p>
        {sessionStatus === 'failed' && (
          <button type="button" className="secondary-button" onClick={() => {
            setSessionStatus('loading');
            setSessionAttempt((attempt) => attempt + 1);
          }}>
            重试
          </button>
        )}
      </div>
    );
  if (!user) return <LoginPage onLogin={login} />;
  const needsRoster = page !== 'overview';
  const bootError =
    ((!projectReady || !project) && projectError) ||
    (project && needsRoster && !athletesReady && rosterError);
  if (bootError || !projectReady || (project && needsRoster && !athletesReady))
    return (
      <div className="boot-screen">
        <BrandLogo className="large" />
        <strong>竞迹</strong>
        <p role={bootError ? 'alert' : 'status'}>{bootError || '正在加载项目信息…'}</p>
        {bootError && (
          <button type="button" className="secondary-button" onClick={() => setRefreshKey((key) => key + 1)}>
            重试
          </button>
        )}
      </div>
    );
  if (!project)
    return (
      <div className="boot-screen">
        <BrandLogo className="large" />
        <strong>竞迹</strong>
        <p>当前账号暂无可访问项目。</p>
      </div>
    );

  const trainingQuery = new URLSearchParams(routeHash.split('?')[1]);
  const trainingTarget = trainingQuery.get('teamTraining');
  const importedTeamId = trainingQuery.get('project') === project && trainingTarget
    ? Number(trainingTarget) || null : null;
  const focusTrainingStats = trainingTarget !== null || /^#\/?team-training-stats(?:\?|$)/.test(routeHash);
  const importedDate = trainingQuery.get('date');
  const canViewTrainingStats = ['SCC', 'REG', 'TD', 'DMD', 'OBS'].includes(user.role);

  const shared = {
    teamId,
    records,
    athletes: projectAthletes,
    project,
    projects: projects.length ? projects : project ? [project] : [],
    from,
    to,
    athleteId,
    loading,
    onRangeChange: (nextFrom: string, nextTo: string) => {
      setFrom(nextFrom);
      setTo(nextTo);
    },
    onAthleteChange: setAthleteId,
    onProjectChange: (nextProject: Project) => {
      if (nextProject !== project && importNavigationGuard.current && !importNavigationGuard.current()) return;
      if (nextProject !== project && page === 'special-overview' && focusTrainingStats) changePage(page);
      setProject(nextProject);
      setTeamSelection(null);
      setAthleteId(null);
      void api.saveCurrentProject(nextProject).catch(() => undefined);
    },
  };
  const usesGlobalTrainingFilter =
    page === 'overview' ||
    page === 'physiology-biochemistry' ||
    page === 'personal' ||
    page.startsWith('special-') ||
    page.startsWith('strength-');

  const trainingFilters = usesGlobalTrainingFilter ? (
    <DateToolbar
      {...shared}
      presetMode="period"
      layout="scope-first"
      teams={teams}
      teamError={teamError}
      onTeamChange={(id) => {
        if (page === 'special-overview' && focusTrainingStats) changePage(page);
        setTeamSelection(id === null ? null : { project, id });
        setAthleteId(null);
        setRecords([]);
      }}
    />
  ) : null;

  return (
    <AppShell
      user={user}
      page={page}
      onPageChange={changePage}
      onLogout={logout}
      onProfileNameChange={renameOwnProfile}
    >
      {globalError && <div className="global-error">{globalError}</div>}
      {(projectError || (needsRoster && rosterError)) && (
        <div className="global-error" role="alert">
          {projectError || rosterError}{' '}
          <button type="button" className="secondary-button" onClick={() => setRefreshKey((key) => key + 1)}>
            重试
          </button>
        </div>
      )}
      <RouteErrorBoundary page={page}>
        {page === 'training-plans' && (
          <UnifiedTrainingPlansPage
            key={routeHash}
            user={user}
            athletes={athletes}
            project={project}
            from={from}
            to={to}
            initialKind={
              new URLSearchParams(routeHash.split('?')[1]).get('type') ||
              (routeHash.includes('special-schedule')
                ? 'special'
                : routeHash.includes('strength-plan')
                  ? 'physical'
                  : '')
            }
            onBack={(() => {
              const source = new URLSearchParams(routeHash.split('?')[1]).get('source');
              return source && pageKeys.includes(source as PageKey) && source !== 'training-plans'
                ? () => changePage(source as PageKey)
                : undefined;
            })()}
          />
        )}
        {page === 'overview' && <OverviewPage {...shared} user={user} filters={trainingFilters} />}
        {page === 'special-overview' && (
          <SpecialTrainingDashboard
            filters={trainingFilters}
            project={project}
            teamId={teamId}
            from={from}
            to={to}
            onPlanOpen={() => changePage('special-schedule')}
            showCustomTestTrend={user.role !== 'OBS'}
            teamTraining={canViewTrainingStats ? {
              teamId: importedTeamId ?? teamId,
              date: importedTeamId && importedDate && /^\d{4}-\d{2}-\d{2}$/.test(importedDate)
                ? importedDate : undefined,
              focus: focusTrainingStats,
              onImport: user.role === 'OBS' ? undefined : () => changePage('data-import'),
            } : undefined}
          />
        )}
        {page.startsWith('special-') && page !== 'special-overview' && (
          <SpecialTestsPage
            filters={trainingFilters}
            {...shared}
            onPlanOpen={() => changePage('special-schedule')}
            section={page as Exclude<SpecialPageKey, 'special-overview'>}
            onSectionChange={changePage}
          />
        )}
        {page === 'strength-overview' && (
          <StrengthTrainingDashboard
            filters={trainingFilters}
            athletes={projectAthletes}
            project={project}
            teamId={teamId}
            from={from}
            to={to}
            onNavigate={changePage}
          />
        )}
        {page === 'strength-enode' && <EnodePage filters={trainingFilters} athletes={projectAthletes} athleteId={athleteId} project={project} from={from} to={to} onNavigate={changePage} />}
        {page.startsWith('strength-') && page !== 'strength-overview' && page !== 'strength-enode' && (
          <StrengthTrainingAnalysisPage
            filters={trainingFilters}
            onPlanOpen={() => changePage('strength-plan')}
            section={page as Exclude<StrengthPageKey, 'strength-overview'>}
            user={user}
            athletes={projectAthletes}
            athleteId={athleteId}
            from={from}
            to={to}
            onSectionChange={changePage}
            onChanged={() => setRefreshKey((key) => key + 1)}
          />
        )}
        {page === 'physiology-biochemistry' && (
          <PhysiologyBiochemistryPage filters={trainingFilters} project={project} from={from} to={to} />
        )}
        {page === 'bluetooth' && <BluetoothConnectPage user={user} />}
        {page === 'data-import' && user.role !== 'ATL' && (
          <DataImportPage
            projects={shared.projects}
            onProjectChange={shared.onProjectChange}
            onViewEnode={() => changePage('strength-enode')}
            onViewTeamTraining={(id, date) => {
              const params = new URLSearchParams({ teamTraining: String(id), project });
              if (date) params.set('date', date);
              changePage('special-overview', `?${params}`);
            }}
            onNavigationGuardChange={setImportNavigationGuard}
            user={user}
            project={project}
            athletes={projectAthletes}
            onChanged={() => setRefreshKey((key) => key + 1)}
          />
        )}
        {page === 'reports' && user.role !== 'ATL' && (
          <ReportsPage key={`${project}:${teamId ?? ''}`} project={project} teamId={teamId} />
        )}
        {page === 'data-management' && user.role !== 'ATL' && <DataManagementPage key={project} user={user} project={project} teamId={teamId} />}
        {page === 'athletes' && user.role !== 'ATL' && (
          <AthleteManagementPage
            user={user}
            initialAthletes={athletes}
            onChanged={() => setRefreshKey((key) => key + 1)}
            onOpenProfile={(athlete) => {
              if (isProject(athlete.project)) setProject(athlete.project);
              setAthleteId(athlete.id);
              changePage('personal');
            }}
          />
        )}
        {page === 'personal' && (
          <PersonalPage filters={trainingFilters} {...shared} user={user} onChanged={() => setRefreshKey((key) => key + 1)} />
        )}
        {page === 'coaches' && user.role !== 'ATL' && (
          <CoachManagementPage
            user={user}
            athletes={projectAthletes}
            onEditScope={(id) => changePage('regions', `?accountId=${id}`)}
            onChanged={() => setRefreshKey((key) => key + 1)}
          />
        )}
        {page === 'teams' && user.role !== 'ATL' && <TeamsPage onChanged={() => setRefreshKey((key) => key + 1)} />}
        {page === 'regions' && canOpenSystemPages && (
          <RegionAccessPage
            user={user}
            preferredAccountId={Number(trainingQuery.get('accountId')) || undefined}
            onAccountDeleted={() => setRefreshKey((key) => key + 1)}
          />
        )}
        {page === 'accounts' && canOpenSystemPages && <AccountsPage />}
        {page === 'ai-management' && user.role === 'DMD' && <AiManagementPage />}
      </RouteErrorBoundary>
    </AppShell>
  );
}
