import {
  ChartNoAxesCombined,
  Dumbbell,
  KeyRound,
  Layers3,
  LogOut,
  MapPinned,
  Menu,
  Network,
  ShieldCheck,
  TimerReset,
  UserCheck,
  UserRound,
  UsersRound,
  X,
  BluetoothConnected,
  ChevronDown
} from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import type { Project, Role, User } from '../types';
import { roleMeta } from '../utils';
import { BrandLogo } from './BrandLogo';
import { EditableName } from './EditableName';
import { ProjectMark } from './ProjectMark';

export type SpecialPageKey = 'special-time' | 'special-distance' | 'special-load' | 'special-rate' | 'special-heart' | 'special-power' | 'special-schedule' | 'special-athletes';
export type StrengthPageKey = 'strength-overview' | 'strength-plan' | 'strength-records' | 'strength-analysis' | 'strength-assessment';
export type DataCollectionPageKey = 'bluetooth';
export type PageKey = 'overview' | SpecialPageKey | StrengthPageKey | 'athletes' | 'personal' | 'coaches' | 'teams' | 'regions' | 'accounts' | 'bluetooth';

const specialGroups: Array<{ key: SpecialPageKey; label: string; pages: SpecialPageKey[] }> = [
  { key: 'special-time', label: '专项分析', pages: ['special-time', 'special-distance', 'special-load'] },
  { key: 'special-rate', label: '专项指标', pages: ['special-rate', 'special-heart', 'special-power'] },
  { key: 'special-schedule', label: '训练安排', pages: ['special-schedule'] },
  { key: 'special-athletes', label: '运动员看板', pages: ['special-athletes'] }
];

const strengthGroups: Array<{ key: StrengthPageKey; label: string }> = [
  { key: 'strength-overview', label: '体能总览' },
  { key: 'strength-plan', label: '训练安排' },
  { key: 'strength-records', label: '训练记录' },
  { key: 'strength-analysis', label: '训练分析' },
  { key: 'strength-assessment', label: '体能评估' }
];

const dataCollectionGroups: Array<{ key: DataCollectionPageKey; label: string }> = [
  { key: 'bluetooth', label: '蓝牙连接' }
];

const navItems: Array<{
  key: PageKey;
  label: string;
  icon: typeof ChartNoAxesCombined;
  roles?: Role[];
}> = [
  { key: 'overview', label: '训练总览', icon: ChartNoAxesCombined },
  { key: 'personal', label: '个人档案', icon: UserRound },
  { key: 'athletes', label: '运动员管理', icon: UsersRound, roles: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] },
  { key: 'coaches', label: '教练管理', icon: Network, roles: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] },
  { key: 'teams', label: '队伍管理', icon: Layers3, roles: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] },
  { key: 'regions', label: '账号权限', icon: MapPinned, roles: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] },
  { key: 'accounts', label: '账户审核', icon: UserCheck, roles: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] }
];

type Props = {
  user: User;
  page: PageKey;
  onPageChange: (page: PageKey) => void;
  onLogout: () => void;
  onProfileNameChange: (name: string) => Promise<void>;
  project: Project;
  projects: Project[];
  onProjectChange: (project: Project) => void;
  children: ReactNode;
};

export function AppShell({ user, page, onPageChange, onLogout, onProfileNameChange, project, projects, onProjectChange, children }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [specialOpen, setSpecialOpen] = useState(() => page.startsWith('special-'));
  const [strengthOpen, setStrengthOpen] = useState(() => page.startsWith('strength-'));
  const [dataCollectionOpen, setDataCollectionOpen] = useState(() => page === 'bluetooth');
  const visibleItems = navItems.filter((item) => !item.roles || item.roles.includes(user.role));
  const specialActive = page.startsWith('special-');
  const strengthActive = page.startsWith('strength-');
  const dataCollectionActive = page === 'bluetooth';
  const specialCurrent = specialGroups.find((group) => group.pages.includes(page as SpecialPageKey));
  const strengthCurrent = strengthGroups.find((item) => item.key === page);
  const dataCollectionCurrent = dataCollectionGroups.find((item) => item.key === page);
  const current = specialCurrent ? { ...specialCurrent, icon: TimerReset } : strengthCurrent ? { ...strengthCurrent, icon: Dumbbell } : dataCollectionCurrent ? { ...dataCollectionCurrent, icon: BluetoothConnected } : visibleItems.find((item) => item.key === page) || visibleItems[0];

  const choosePage = (key: PageKey) => {
    onPageChange(key);
    setMobileOpen(false);
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordMessage('');
    if (newPassword !== confirmPassword) {
      setPasswordMessage('两次输入的新密码不一致。');
      return;
    }
    setPasswordBusy(true);
    try {
      const result = await api.changePassword(currentPassword, newPassword);
      setPasswordMessage(result.message);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (error) {
      setPasswordMessage(error instanceof Error ? error.message : '修改失败。');
    } finally {
      setPasswordBusy(false);
    }
  };

  return (
    <div className="app-frame">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-block">
          <BrandLogo />
          <div>
            <strong>竞迹</strong>
            <small>JINGJI PERFORMANCE</small>
          </div>
          <button className="icon-button sidebar-close" onClick={() => setMobileOpen(false)} aria-label="关闭菜单">
            <X size={20} />
          </button>
        </div>

        <div className="scope-card">
          <div className="scope-icon"><ShieldCheck size={17} /></div>
          <div>
            <span>{roleMeta[user.role].label}</span>
          </div>
        </div>

        <div className="project-lanes" aria-label="当前运动项目">
          {projects.map((item) => {
            return <button
              key={item}
              className={`${item === project ? 'active' : ''} ${item === '皮划艇' ? 'canoe' : item === '激流' ? 'slalom' : 'rowing'}`}
              onClick={() => onProjectChange(item)}
              aria-label={`切换到${item}`}
              title={item}
            >
              <ProjectMark project={item} />
              <strong>{item}</strong>
            </button>;
          })}
        </div>

        <nav className="primary-nav" aria-label="主导航">
          {visibleItems.slice(0, 1).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={page === item.key ? 'active' : ''}
                onClick={() => choosePage(item.key)}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span><strong>{item.label}</strong></span>
              </button>
            );
          })}
          <div className={`special-nav ${specialActive ? 'active' : ''} ${specialOpen ? 'open' : 'collapsed'}`}>
            <button className="special-nav-parent" onClick={() => setSpecialOpen((open) => !open)} aria-expanded={specialOpen}>
              <TimerReset size={19} strokeWidth={1.8} />
              <span><strong>专项训练</strong></span>
              <ChevronDown className="special-nav-chevron" size={15} />
            </button>
            {specialOpen && <div className="special-nav-tree">
              {specialGroups.map((group) => <button key={group.key} className={group.pages.includes(page as SpecialPageKey) ? 'active' : ''} onClick={() => choosePage(group.key)}>
                <i /> <span>{group.label}</span>
              </button>)}
            </div>}
          </div>
          <div className={`special-nav strength-nav ${strengthActive ? 'active' : ''} ${strengthOpen ? 'open' : 'collapsed'}`}>
            <button className="special-nav-parent" onClick={() => setStrengthOpen((open) => !open)} aria-expanded={strengthOpen}>
              <Dumbbell size={19} strokeWidth={1.8} />
              <span><strong>体能训练</strong></span>
              <ChevronDown className="special-nav-chevron" size={15} />
            </button>
            {strengthOpen && <div className="special-nav-tree">
              {strengthGroups.map((item) => <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => choosePage(item.key)}>
                <i /> <span>{item.label}</span>
              </button>)}
            </div>}
          </div>
          <div className={`special-nav data-collection-nav ${dataCollectionActive ? 'active' : ''} ${dataCollectionOpen ? 'open' : 'collapsed'}`}>
            <button className="special-nav-parent" onClick={() => setDataCollectionOpen((open) => !open)} aria-expanded={dataCollectionOpen}>
              <BluetoothConnected size={19} strokeWidth={1.8} />
              <span><strong>数据采集</strong></span>
              <ChevronDown className="special-nav-chevron" size={15} />
            </button>
            {dataCollectionOpen && <div className="special-nav-tree">
              {dataCollectionGroups.map((item) => <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => choosePage(item.key)}>
                <i /> <span>{item.label}</span>
              </button>)}
            </div>}
          </div>
          {visibleItems.slice(1).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={page === item.key ? 'active' : ''}
                onClick={() => choosePage(item.key)}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span><strong>{item.label}</strong></span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-avatar">{user.displayName.slice(0, 1)}</div>
          <div className="user-copy"><strong><EditableName value={user.displayName} canEdit onSave={onProfileNameChange} label="本人姓名" /></strong><small>@{user.username}</small></div>
          <button className="icon-button" onClick={() => { setPasswordOpen(true); setPasswordMessage(''); }} aria-label="修改密码"><KeyRound size={17} /></button>
          <button className="icon-button" onClick={onLogout} aria-label="退出登录"><LogOut size={18} /></button>
        </div>
      </aside>

      {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="关闭菜单" />}
      {passwordOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPasswordOpen(false); }}>
        <section className="password-modal" role="dialog" aria-modal="true" aria-labelledby="password-title">
          <div className="modal-heading"><h2 id="password-title">修改密码</h2><button className="icon-button" onClick={() => setPasswordOpen(false)} aria-label="关闭"><X size={19} /></button></div>
          <form onSubmit={changePassword}>
            <label><span>当前密码</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
            <label><span>新密码</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少8位，含字母和数字" required /></label>
            <label><span>确认新密码</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
            {passwordMessage && <p className="modal-message">{passwordMessage}</p>}
            <button className="primary-button" disabled={passwordBusy}>{passwordBusy ? '保存中…' : '保存密码'}</button>
          </form>
        </section>
      </div>}

      <main className="main-area">
        <header className="mobile-header">
          <button className="icon-button" onClick={() => setMobileOpen(true)} aria-label="打开菜单"><Menu size={22} /></button>
          <span>{current.label}</span>
          <div className="user-avatar small">{user.displayName.slice(0, 1)}</div>
        </header>
        {children}
      </main>
    </div>
  );
}
