import { AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, LockKeyhole, UserRound, UsersRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { BrandLogo } from '../components/BrandLogo';
import type { User } from '../types';
import { PROVINCES, PROVINCE_CITIES } from '../../shared/regions';
import { PROJECTS } from '../../shared/projects';

type Mode = 'login' | 'register';

export function LoginPage({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'ATL' | 'SCC'>('ATL');
  const [project, setProject] = useState('赛艇');
  const [team, setTeam] = useState('');
  const [gender, setGender] = useState('');
  const [identityNumber, setIdentityNumber] = useState('');
  const [nativePlaceProvince, setNativePlaceProvince] = useState('');
  const [nativePlaceCity, setNativePlaceCity] = useState('');
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [county, setCounty] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setSuccess('');
    setPassword('');
    setConfirmPassword('');
  };

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const result = await api.login(username, password);
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
        username, password, displayName, role, project, team, gender, identityNumber,
        nativePlace: `${nativePlaceProvince}/${nativePlaceCity}`,
        region, city, county
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
          <div><strong>竞迹</strong><small>JINGJI PERFORMANCE</small></div>
        </div>
        <div className="story-copy">
          <p className="eyebrow">ROWING · CANOEING</p>
          <h1>让每次训练，<br />留下清晰答案。</h1>
        </div>
        <ol className="auth-steps" aria-label="申请开通流程">
          <li><span>01</span><strong>提交申请</strong></li>
          <li><span>02</span><strong>管理员审核</strong></li>
          <li><span>03</span><strong>登录使用</strong></li>
        </ol>
        <div className="lane-visual" aria-hidden="true">
          <div className="boat"><span /><i /><i /><i /><i /></div>
          <div className="lane lane-one" /><div className="lane lane-two" /><div className="lane lane-three" />
        </div>
      </section>

      <section className="login-panel">
        <div className={`login-box login-box-${mode}`}>
          <div className="login-heading">
            <p>{mode === 'login' ? '训练数据中心' : '账号准入'}</p>
            <h2>{mode === 'login' ? '欢迎回来' : '申请注册'}</h2>
            <span>{mode === 'login' ? '使用已开通的账号进入系统' : '提交资料，审核通过后即可登录'}</span>
          </div>

          {mode === 'login' ? (
            <form onSubmit={login}>
              {success && <p className="form-success"><CheckCircle2 size={17} />{success}</p>}
              <label><span>账号</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
              <label><span>密码</span><div className="password-input"><LockKeyhole size={17} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></div></label>
              {error && <p className="form-error"><AlertCircle size={16} />{error}</p>}
              <div className="auth-actions">
                <button type="button" className="form-link" onClick={() => switchMode('register')}>申请新账号</button>
                <button className="primary-button login-button" disabled={submitting}>{submitting ? '登录中…' : '登录'} <ArrowRight size={18} /></button>
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
              <fieldset className="register-role">
                <legend>选择申请身份</legend>
                <div role="group" aria-label="申请身份">
                  <button type="button" className={role === 'ATL' ? 'selected' : ''} onClick={() => setRole('ATL')}>
                    <UserRound aria-hidden="true" />
                    <span><strong>运动员</strong><small>查看本人训练数据</small></span>
                    <i><Check aria-hidden="true" /></i>
                  </button>
                  <button type="button" className={role === 'SCC' ? 'selected' : ''} onClick={() => setRole('SCC')}>
                    <UsersRound aria-hidden="true" />
                    <span><strong>教练</strong><small>上传数据、查看学员</small></span>
                    <i><Check aria-hidden="true" /></i>
                  </button>
                </div>
              </fieldset>

              <section className="register-section">
                <div className="register-section-title"><b>01</b><strong>基本资料</strong></div>
                <div className="form-grid profile-grid">
                  <label><span>姓名</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
                  <label><span>身份证号</span><input value={identityNumber} onChange={(event) => setIdentityNumber(event.target.value.replace(/\s/g, '').toUpperCase())} maxLength={18} pattern="[0-9]{17}[0-9X]" title="请输入18位身份证号，末位可以是X" placeholder="18位身份证号" required /></label>
                  <label><span>项目</span><select value={project} onChange={(event) => setProject(event.target.value)}>{PROJECTS.map((item) => <option key={item}>{item}</option>)}</select></label>
                  <label><span>队伍</span><input value={team} onChange={(event) => setTeam(event.target.value)} placeholder="如：女子双桨组" required /></label>
                  <label><span>性别</span><select value={gender} onChange={(event) => setGender(event.target.value)} required><option value="">请选择</option><option>女</option><option>男</option></select></label>
                  <label><span>籍贯省份</span><select value={nativePlaceProvince} onChange={(event) => { setNativePlaceProvince(event.target.value); setNativePlaceCity(''); }} required><option value="">请选择省份</option>{PROVINCES.map((province) => <option key={province}>{province}</option>)}</select></label>
                  <label><span>籍贯城市</span><select value={nativePlaceCity} onChange={(event) => setNativePlaceCity(event.target.value)} disabled={!nativePlaceProvince} required><option value="">{nativePlaceProvince ? '请选择城市' : '请先选择省份'}</option>{(PROVINCE_CITIES[nativePlaceProvince] || []).map((cityName) => <option key={cityName}>{cityName}</option>)}</select></label>
                  <label><span>所属省份</span><select value={region} onChange={(event) => setRegion(event.target.value)} required><option value="">请选择</option>{PROVINCES.map((province) => <option key={province}>{province}</option>)}</select></label>
                  <label><span>所属城市</span><input value={city} onChange={(event) => setCity(event.target.value)} placeholder="如：成都市" required /></label>
                  <label><span>所属区县</span><input value={county} onChange={(event) => setCounty(event.target.value)} placeholder="如：武侯区" required /></label>
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
