import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { BrandLogo } from '../components/BrandLogo';
import type { ProjectTeam, User } from '../types';
import { PROVINCES, PROVINCE_CITIES } from '../../shared/regions';
import { PROJECTS } from '../../shared/projects';

type Mode = 'login' | 'register';

function genderFromIdentityNumber(value: string) {
  return /^\d{17}[\dX]$/.test(value) ? (Number(value[16]) % 2 ? '男' : '女') : '';
}

export function LoginPage({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState(() => localStorage.getItem('jingji.rememberedUsername') || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberUsername, setRememberUsername] = useState(() => Boolean(localStorage.getItem('jingji.rememberedUsername')));
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [project, setProject] = useState('赛艇');
  const [team, setTeam] = useState('');
  const [teams, setTeams] = useState<ProjectTeam[]>([]);
  const [gender, setGender] = useState('');
  const [identityNumber, setIdentityNumber] = useState('');
  const [nativePlaceProvince, setNativePlaceProvince] = useState('');
  const [nativePlaceCity, setNativePlaceCity] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const projectTeams = teams.filter((item) => item.project === project);

  useEffect(() => {
    api.teams().then((result) => setTeams(result.teams)).catch(() => setTeams([]));
  }, []);

  useEffect(() => {
    if (!projectTeams.some((item) => item.name === team)) setTeam(projectTeams[0]?.name || '');
  }, [project, teams]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setSuccess('');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
  };

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result = await api.login(username, password);
      if (rememberUsername) localStorage.setItem('jingji.rememberedUsername', username);
      else localStorage.removeItem('jingji.rememberedUsername');
      onLogin(result.token, result.user);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '登录失败。');
    } finally {
      setSubmitting(false);
    }
  };

  const register = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致。');
      return;
    }
    if (!/^\d{17}[\dX]$/.test(identityNumber)) {
      setError('身份证号须为18位，前17位为数字，末位为数字或X。');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.register({
        username, password, displayName, role: 'ATL', project, team, gender, identityNumber,
        nativePlace: `${nativePlaceProvince}/${nativePlaceCity}`
      });
      setSuccess(result.message);
      setPassword('');
      setConfirmPassword('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '注册申请提交失败。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={`login-page login-page-${mode}`}>
      <section className="login-story">
        <div className="login-brand">
          <BrandLogo className="large" variant="full" />
        </div>

        <div className="training-route" aria-hidden="true"><i /><span /><b /></div>
        <div className="hero-metric hero-metric-pace" aria-hidden="true"><strong>1:38</strong><small>/500m</small></div>
        <div className="hero-metric hero-metric-rate" aria-hidden="true"><strong>28</strong><small>SPM</small></div>
        <div className="hero-metric hero-metric-length" aria-hidden="true"><strong>2.1</strong><small>m</small></div>

        <div className="story-copy">
          <h1>让训练数据成为<br />下一次突破的依据</h1>
          <span className="story-rule" />
          <p className="story-disciplines">赛艇&nbsp;&nbsp;·&nbsp;&nbsp;皮划艇&nbsp;&nbsp;·&nbsp;&nbsp;激流</p>
          <p className="story-english">PERFORMANCE, TRAINING, RECOVERY</p>
        </div>
      </section>

      <section className="login-panel">
        <div className={`login-box login-box-${mode}`}>
          <div className="login-heading">
            <p>{mode === 'login' ? '竞技表现管理平台' : '运动员账号准入'}</p>
            <h2>{mode === 'login' ? '欢迎回来' : '运动员注册'}</h2>
            <span>{mode === 'login' ? '请输入账号和密码进入系统' : '提交资料，审核通过后即可登录'}</span>
          </div>

          {mode === 'login' ? (
            <form onSubmit={login}>
              {success && <p className="form-success"><CheckCircle2 size={17} />{success}</p>}
              <label className="login-field"><span>账号</span><div className="auth-input"><UserRound size={18} /><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="请输入账号" required /></div></label>
              <label className="login-field"><span>密码</span><div className="auth-input password-auth-input"><LockKeyhole size={18} /><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="请输入密码" required /><button type="button" className="password-visibility" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
              <div className="auth-preferences">
                <label className="remember-control"><input type="checkbox" checked={rememberUsername} onChange={(event) => setRememberUsername(event.target.checked)} /><span>记住账号</span></label>
                <button type="button" className="forgot-password" onClick={() => setError('暂未开通在线找回，请联系系统管理员重置密码。')}>忘记密码</button>
              </div>
              {error && <p className="form-error"><AlertCircle size={16} />{error}</p>}
              <div className="login-submit-stack">
                <button className="primary-button login-button" disabled={submitting}>{submitting ? '登录中…' : '登录系统'} <ArrowRight size={18} /></button>
                <button type="button" className="secondary-button register-entry" onClick={() => switchMode('register')}>运动员注册</button>
              </div>
            </form>
          ) : success ? (
            <div className="registration-complete">
              <CheckCircle2 size={42} />
              <h3>申请已提交</h3>
              <p>{success}</p>
              <button className="primary-button" onClick={() => switchMode('login')}><ArrowLeft size={17} />返回登录</button>
            </div>
          ) : (
            <form onSubmit={register} className="registration-form">
              <section className="register-section">
                <div className="register-section-title"><b>01</b><strong>基本资料</strong></div>
                <div className="form-grid profile-grid">
                  <label><span>姓名</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
                  <label><span>身份证号</span><input value={identityNumber} onChange={(event) => { const value = event.target.value.replace(/\s/g, '').toUpperCase(); setIdentityNumber(value); setGender(genderFromIdentityNumber(value)); }} maxLength={18} pattern="[0-9]{17}[0-9X]" title="请输入18位身份证号，末位可以是X" placeholder="18位身份证号" required /></label>
                  <label><span>项目</span><select value={project} onChange={(event) => setProject(event.target.value)}>{PROJECTS.map((item) => <option key={item}>{item}</option>)}</select></label>
                  <label><span>队伍</span><select value={team} onChange={(event) => setTeam(event.target.value)} disabled={!projectTeams.length} required><option value="">{projectTeams.length ? '请选择队伍' : '该项目暂无队伍'}</option>{projectTeams.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
                  <label><span>性别</span><input value={gender} readOnly placeholder="填写身份证号后自动确定" aria-label="性别（根据身份证号自动确定）" /></label>
                  <label><span>籍贯省份</span><select value={nativePlaceProvince} onChange={(event) => { setNativePlaceProvince(event.target.value); setNativePlaceCity(''); }} required><option value="">请选择省份</option>{PROVINCES.map((province) => <option key={province}>{province}</option>)}</select></label>
                  <label><span>籍贯城市</span><select value={nativePlaceCity} onChange={(event) => setNativePlaceCity(event.target.value)} disabled={!nativePlaceProvince} required><option value="">{nativePlaceProvince ? '请选择城市' : '请先选择省份'}</option>{(PROVINCE_CITIES[nativePlaceProvince] || []).map((cityName) => <option key={cityName}>{cityName}</option>)}</select></label>
                </div>
              </section>

              <section className="register-section">
                <div className="register-section-title"><b>02</b><strong>账号设置</strong></div>
                <div className="form-grid account-grid">
                  <label className="field-wide"><span>账号</span><input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} autoComplete="username" placeholder="字母、数字或下划线" required /></label>
                  <label><span>密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="至少8位，含字母和数字" required /></label>
                  <label><span>确认密码</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required /></label>
                </div>
              </section>

              {error && <p className="form-error"><AlertCircle size={16} />{error}</p>}
              <div className="auth-actions register-actions">
                <button type="button" className="form-link" onClick={() => switchMode('login')}><ArrowLeft size={14} />返回登录</button>
                <button className="primary-button login-button" disabled={submitting}>{submitting ? '提交中…' : '提交申请'} <ArrowRight size={18} /></button>
              </div>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
