import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, LockKeyhole, UserRound } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { api } from '../api';
import { BrandLogo } from '../components/BrandLogo';
import type { ProjectTeam, User } from '../types';
import { PROVINCES, PROVINCE_CITIES } from '../../shared/regions';
import { PROJECTS } from '../../shared/projects';

type Mode = 'login' | 'register';

const OLYMPIC_DISCIPLINES = [
  { label: '射箭', english: 'Archery', gif:'/assets/olympic-sports/archery.gif' },
  { label: '花样游泳', english: 'Artistic Swimming', gif:'/assets/olympic-sports/artistic swimming.gif', col: 1, row: 0 },
  { label: '田径', english: 'Athletics', gif:'/assets/olympic-sports/athletics.gif', col: 2, row: 0 },
  { label: '羽毛球', english: 'Badminton', gif:'/assets/olympic-sports/badminton.gif', col: 3, row: 0 },
  { label: '棒球', english: 'Baseball', gif:'/assets/olympic-sports/baseball.gif', col: 4, row: 0 },
  { label: '垒球', english: 'Softball', gif:'/assets/olympic-sports/softball.gif', col: 5, row: 0 },
  { label: '篮球', english: 'Basketball', gif:'/assets/olympic-sports/basketball.gif', col: 6, row: 0 },
  { label: '三人篮球', english: 'Basketball 3X3', gif:'/assets/olympic-sports/3x3 basketball.gif', col: 0, row: 1 },
  { label: '沙滩排球', english: 'Beach Volleyball', gif:'/assets/olympic-sports/beach volleyball.gif', col: 1, row: 1 },
  { label: '拳击', english: 'Boxing', gif:'/assets/olympic-sports/boxing.gif', col: 2, row: 1 },
  { label: '激流回旋', english: 'Canoe Slalom', gif:'/assets/olympic-sports/canoe_slalom.gif', col: 3, row: 1 },
  { label: '静水皮划艇', english: 'Canoe Sprint', gif:'/assets/olympic-sports/canoe_sprint.gif', col: 4, row: 1 },
  { label: '自由式小轮车', english: 'Cycling BMX Freestyle', gif:'/assets/olympic-sports/cycling_bmx_freestyle.gif', col: 5, row: 1 },
  { label: '竞速小轮车', english: 'Cycling BMX Racing', gif:'/assets/olympic-sports/cycling_bmx_racing.gif', col: 6, row: 1 },
  { label: '山地自行车', english: 'Cycling Mountain Bike', gif:'/assets/olympic-sports/cycling_mountain_bike.gif', col: 0, row: 2 },
  { label: '公路自行车', english: 'Cycling Road', gif:'/assets/olympic-sports/cycling_road.gif', col: 1, row: 2 },
  { label: '场地自行车', english: 'Cycling Track', gif:'/assets/olympic-sports/cycling_track.gif', col: 2, row: 2 },
  { label: '跳水', english: 'Diving', gif:'/assets/olympic-sports/diving.gif', col: 3, row: 2 },
  { label: '盛装舞步', english: 'Equestrian Dressage', gif:'/assets/olympic-sports/equestrian_dressage.gif', col: 4, row: 2 },
  { label: '马术三项', english: 'Equestrian Eventing', gif:'/assets/olympic-sports/equestrian_eventing.gif', col: 5, row: 2 },
  { label: '场地障碍', english: 'Equestrian Jumping', gif:'/assets/olympic-sports/equestrian_jumping.gif', col: 6, row: 2 },
  { label: '击剑', english: 'Fencing', gif:'/assets/olympic-sports/fencing.gif', col: 0, row: 3 },
  { label: '足球', english: 'Football', gif:'/assets/olympic-sports/football.gif', col: 1, row: 3 },
  { label: '高尔夫', english: 'Golf', gif:'/assets/olympic-sports/golf.gif', col: 2, row: 3 },
  { label: '竞技体操', english: 'Gymnastics Artistic', gif:'/assets/olympic-sports/gymnastics_artistic.gif', col: 3, row: 3 },
  { label: '艺术体操', english: 'Gymnastics Rhythmic', gif:'/assets/olympic-sports/gymnastics_rhythmic.gif', col: 4, row: 3 },
  { label: '手球', english: 'Handball', gif:'/assets/olympic-sports/handball.gif', col: 5, row: 3 },
  { label: '曲棍球', english: 'Hockey', gif:'/assets/olympic-sports/hockey.gif', col: 6, row: 3 },
  { label: '柔道', english: 'Judo', gif:'/assets/olympic-sports/judo.gif', col: 0, row: 4 },
  { label: '空手道·型', english: 'Karate Kata', gif:'/assets/olympic-sports/karate_kata.gif', col: 1, row: 4 },
  { label: '空手道·组手', english: 'Karate Kumite', gif:'/assets/olympic-sports/karate_kumite.gif', col: 2, row: 4 },
  { label: '马拉松游泳', english: 'Marathon Swimming', gif:'/assets/olympic-sports/marathon_swimming.gif', col: 3, row: 4 },
  { label: '现代五项', english: 'Modern Pentathlon', gif:'/assets/olympic-sports/modern_pentathlon.gif', col: 4, row: 4 },
  { label: '赛艇', english: 'Rowing', gif:'/assets/olympic-sports/rowing.gif', col: 5, row: 4 },
  { label: '七人制橄榄球', english: 'Rugby', gif:'/assets/olympic-sports/rugby.gif', col: 6, row: 4 },
  { label: '帆船', english: 'Sailing', gif:'/assets/olympic-sports/sailing.gif', col: 0, row: 5 },
  { label: '射击', english: 'Shooting', gif:'/assets/olympic-sports/shooting.gif', col: 1, row: 5 },
  { label: '滑板', english: 'Skateboarding', gif:'/assets/olympic-sports/skateboarding.gif', col: 2, row: 5 },
  { label: '运动攀岩', english: 'Sport Climbing', gif:'/assets/olympic-sports/sport_climbing.gif', col: 3, row: 5 },
  { label: '冲浪', english: 'Surfing', gif:'/assets/olympic-sports/surfing.gif', col: 4, row: 5 },
  { label: '游泳', english: 'Swimming', gif:'/assets/olympic-sports/swimming.gif', col: 5, row: 5 },
  { label: '乒乓球', english: 'Table Tennis', gif:'/assets/olympic-sports/table_tennis.gif', col: 6, row: 5 },
  { label: '跆拳道', english: 'Taekwondo', gif:'/assets/olympic-sports/taekwondo.gif', col: 0, row: 6 },
  { label: '网球', english: 'Tennis', gif:'/assets/olympic-sports/tennis.gif', col: 1, row: 6 },
  { label: '蹦床', english: 'Trampoline', gif:'/assets/olympic-sports/trampoline.gif', col: 2, row: 6 },
  { label: '铁人三项', english: 'Triathlon', gif:'/assets/olympic-sports/triathlon.gif', col: 3, row: 6 },
  { label: '排球', english: 'Volleyball', gif:'/assets/olympic-sports/volleyball.gif', col: 4, row: 6 },
  { label: '水球', english: 'Water Polo', gif:'/assets/olympic-sports/water_polo.gif', col: 5, row: 6 },
  { label: '举重', english: 'Weightlifting', gif:'/assets/olympic-sports/weightlifting.gif', col: 6, row: 6 },
  { label: '摔跤', english: 'Wrestling', gif:'/assets/olympic-sports/wrestling.gif', col: 0, row: 7 }
] as const;

const OLYMPIC_SPRITE_ROW_Y = [-16, -73, -131, -186, -246, -300, -358, -408] as const;

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
  const [project, setProject] = useState('');
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
    if (!project) {
      setError('请选择运动项目。');
      return;
    }
    if (!team) {
      setError('请选择所属队伍。');
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
      <section className="login-story olympic-story">
        <div className="login-brand">
          <BrandLogo className="large" variant="full" />
        </div>

        <div className="olympic-story-heading">
          <div>
            <p><span /> OLYMPIC DISCIPLINES</p>
            <h1>让每一次训练，<br /><em>都成为突破的依据</em></h1>
          </div>
        </div>
        <div className="olympic-pictogram-panel">
          <div
            className="olympic-sports-grid"
            role="list"
            aria-label="奥运运动项目图标总览"
          >
            {OLYMPIC_DISCIPLINES.map((discipline) => (
              <article
                className="olympic-sport"
                key={discipline.english}
                role="listitem"
                title={`${discipline.label} / ${discipline.english}`}
              >
                <span
                  className="olympic-sport-icon"
                  aria-hidden="true"
                >
                  <img
                    src={discipline.gif}
                    alt=""
                  />
                </span>

                <span>{discipline.label}</span>
              </article>
            ))}
          </div>
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
                  <label><span>项目</span><select value={project} onChange={(event) => setProject(event.target.value)} required><option value="">请选择项目</option>{PROJECTS.map((item) => <option key={item}>{item}</option>)}</select></label>
                  <label><span>队伍</span><select value={team} onChange={(event) => setTeam(event.target.value)} disabled={!project || !projectTeams.length} required><option value="">{!project ? '请先选择项目' : projectTeams.length ? '请选择队伍' : '该项目暂无队伍'}</option>{projectTeams.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
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
