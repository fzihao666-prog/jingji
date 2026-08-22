import {
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardList,
  Dumbbell,
  FileUp,
  KeyRound,
  Layers3,
  LogOut,
  MapPinned,
  Menu,
  ShieldCheck,
  TimerReset,
  UserCheck,
  UserRound,
  UsersRound,
  X,
  BluetoothConnected
} from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import type { Project, Role, User } from '../types';
import { roleMeta } from '../utils';
import { BrandLogo } from './BrandLogo';
import { EditableName } from './EditableName';
import { ProjectMark } from './ProjectMark';

export type PageKey = 'overview' | 'calendar' | 'specialTests' | 'plans' | 'personal' | 'report' | 'import' | 'roster' | 'teams' | 'regions' | 'accounts' | 'bluetooth';

const navItems: Array<{
  key: PageKey;
  label: string;
  icon: typeof CalendarDays;
  roles?: Role[];
}> = [
  { key: 'overview', label: '训练总览', icon: ChartNoAxesCombined },
  { key: 'calendar', label: '训练日历', icon: CalendarDays },
  { key: 'specialTests', label: '专项训练', icon: TimerReset },
  { key: 'plans', label: '体能训练', icon: Dumbbell },
  { key: 'bluetooth', label: '蓝牙连接', icon: BluetoothConnected },
  { key: 'personal', label: '个人档案', icon: UserRound },
  { key: 'report', label: '周期报告', icon: ClipboardList },
  { key: 'import', label: 'AI识别导入', icon: FileUp, roles: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] },
  { key: 'roster', label: '人员关系', icon: UsersRound, roles: ['SCC', 'PRJ', 'REG', 'TD', 'DMD'] },
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
  const visibleItems = navItems.filter((item) => !item.roles || item.roles.includes(user.role));
  const current = visibleItems.find((item) => item.key === page) || visibleItems[0];

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
          {visibleItems.map((item) => {
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
