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
  FileSpreadsheet,
  ChevronDown,
  Building2,
  ClipboardList,
  HardDrive,
  FlaskConical
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import type { Role, User } from '../types';
import { roleMeta } from '../utils';
import { BrandLogo } from './BrandLogo';
import { EditableName } from './EditableName';

export type SpecialPageKey = 'special-overview' | 'special-volume' | 'special-time' | 'special-distance' | 'special-load' | 'special-rate' | 'special-heart' | 'special-power' | 'special-records' | 'special-schedule';
export type StrengthPageKey = 'strength-overview' | 'strength-plan' | 'strength-records' | 'strength-analysis' | 'strength-assessment';
export type DataCollectionPageKey = 'bluetooth' | 'data-import' | 'data-import-history' | 'data-management';
export type PageKey = 'overview' | SpecialPageKey | StrengthPageKey | 'physiology-biochemistry' | 'athletes' | 'personal' | 'coaches' | 'teams' | 'regions' | 'accounts' | DataCollectionPageKey;


const dataCollectionGroups: Array<{ key: DataCollectionPageKey; label: string; roles?: Role[] }> = [
  { key: 'bluetooth', label: '设备管理' },
  { key: 'data-import', label: '数据导入', roles: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] },
  { key: 'data-import-history', label: '导入记录', roles: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] },
  { key: 'data-management', label: '指标与标准', roles: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] }
];

const directNavItems: Array<{
  key: PageKey;
  label: string;
  icon: typeof ChartNoAxesCombined;
  roles?: Role[];
}> = [
  { key: 'overview', label: '训练总览', icon: ChartNoAxesCombined },
  { key: 'physiology-biochemistry', label: '生理生化', icon: FlaskConical },
  { key: 'personal', label: '运动员表现', icon: UserRound }
];

const organizationGroups: Array<{
  key: Extract<PageKey, 'athletes' | 'coaches' | 'teams'>;
  label: string;
  icon: typeof ChartNoAxesCombined;
  roles: Role[];
}> = [
  { key: 'athletes', label: '运动员管理', icon: UsersRound, roles: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] },
  { key: 'coaches', label: '教练管理', icon: Network, roles: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] },
  { key: 'teams', label: '队伍管理', icon: Layers3, roles: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] },
];

const systemGroups: Array<{
  key: Extract<PageKey, 'regions' | 'accounts'>;
  label: string;
  icon: typeof ChartNoAxesCombined;
  roles: Role[];
}> = [
  { key: 'regions', label: '账号权限', icon: MapPinned, roles: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] },
  { key: 'accounts', label: '账户审核', icon: UserCheck, roles: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] }
];

type Props = {
  user: User;
  page: PageKey;
  onPageChange: (page: PageKey) => void;
  onLogout: () => void;
  onProfileNameChange: (name: string) => Promise<void>;
  children: ReactNode;
};

export function AppShell({ user, page, onPageChange, onLogout, onProfileNameChange, children }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [dataCollectionOpen, setDataCollectionOpen] = useState(() => isDataCollectionPage(page));
  const [organizationOpen, setOrganizationOpen] = useState(() => isOrganizationPage(page));
  const [systemOpen, setSystemOpen] = useState(() => isSystemPage(page));
  const dataCollectionActive = isDataCollectionPage(page);
  const organizationActive = isOrganizationPage(page);
  const systemActive = isSystemPage(page);
  const visibleDataCollectionGroups = dataCollectionGroups.filter((item) => !item.roles || item.roles.includes(user.role));
  const dataCollectionCurrent = visibleDataCollectionGroups.find((item) => item.key === page);
  const visibleOrganizationGroups = organizationGroups.filter((item) => item.roles.includes(user.role));
  const visibleSystemGroups = systemGroups.filter((item) => item.roles.includes(user.role));
  const current = page.startsWith('special-') ? { label: '专项训练', icon: TimerReset } : page.startsWith('strength-') ? { label: '体能训练', icon: Dumbbell } : dataCollectionCurrent ? { ...dataCollectionCurrent, icon: itemIcon(dataCollectionCurrent.key) } : directNavItems.find((item) => item.key === page) || visibleOrganizationGroups.find((item) => item.key === page) || visibleSystemGroups.find((item) => item.key === page) || directNavItems[0];

  useEffect(() => {
    if (dataCollectionActive) setDataCollectionOpen(true);
    if (organizationActive) setOrganizationOpen(true);
    if (systemActive) setSystemOpen(true);
  }, [dataCollectionActive, organizationActive, systemActive]);

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

        <nav className="primary-nav" aria-label="主导航">
          {directNavItems.slice(0, 1).map((item) => {
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
          <button className={page.startsWith('special-') ? 'active' : ''} onClick={() => choosePage('special-overview')}><TimerReset size={19} strokeWidth={1.8} /><span><strong>专项训练</strong></span></button>
          <button className={page.startsWith('strength-') ? 'active' : ''} onClick={() => choosePage('strength-overview')}><Dumbbell size={19} strokeWidth={1.8} /><span><strong>体能训练</strong></span></button>
          {directNavItems.slice(1).map((item) => {
            const Icon = item.icon;
            return <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => choosePage(item.key)}><Icon size={19} strokeWidth={1.8} /><span><strong>{item.label}</strong></span></button>;
          })}
          <div className={`special-nav data-collection-nav ${dataCollectionActive ? 'active' : ''} ${dataCollectionOpen ? 'open' : 'collapsed'}`}>
            <button className="special-nav-parent" onClick={() => setDataCollectionOpen((open) => !open)} aria-expanded={dataCollectionOpen}>
              <HardDrive size={19} strokeWidth={1.8} />
              <span><strong>数据管理</strong></span>
              <ChevronDown className="special-nav-chevron" size={15} />
            </button>
            {dataCollectionOpen && <div className="special-nav-tree">
              {visibleDataCollectionGroups.map((item) => <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => choosePage(item.key)}>
                <i /> <span>{item.label}</span>
              </button>)}
            </div>}
          </div>
          {visibleOrganizationGroups.length > 0 && <div className={`special-nav ${organizationActive ? 'active' : ''} ${organizationOpen ? 'open' : 'collapsed'}`}>
            <button className="special-nav-parent" onClick={() => setOrganizationOpen((open) => !open)} aria-expanded={organizationOpen}>
              <Building2 size={19} strokeWidth={1.8} /><span><strong>组织管理</strong></span><ChevronDown className="special-nav-chevron" size={15} />
            </button>
            {organizationOpen && <div className="special-nav-tree">{visibleOrganizationGroups.map((item) => <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => choosePage(item.key)}><i /><span>{item.label}</span></button>)}</div>}
          </div>}
          {visibleSystemGroups.length > 0 && <div className={`special-nav ${systemActive ? 'active' : ''} ${systemOpen ? 'open' : 'collapsed'}`}>
            <button className="special-nav-parent" onClick={() => setSystemOpen((open) => !open)} aria-expanded={systemOpen}>
              <ClipboardList size={19} strokeWidth={1.8} /><span><strong>系统管理</strong></span><ChevronDown className="special-nav-chevron" size={15} />
            </button>
            {systemOpen && <div className="special-nav-tree">{visibleSystemGroups.map((item) => <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => choosePage(item.key)}><i /><span>{item.label}</span></button>)}</div>}
          </div>}
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

function isDataCollectionPage(page: PageKey) {
  return page === 'bluetooth' || page === 'data-import' || page === 'data-import-history' || page === 'data-management';
}

function isOrganizationPage(page: PageKey) {
  return page === 'athletes' || page === 'coaches' || page === 'teams';
}

function isSystemPage(page: PageKey) {
  return page === 'regions' || page === 'accounts';
}

function itemIcon(key: DataCollectionPageKey) {
  return key === 'bluetooth' ? BluetoothConnected : FileSpreadsheet;
}
