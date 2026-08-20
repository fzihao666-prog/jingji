import { useState, useMemo } from 'react';
import './AITrainingPlanGenerator.css';
import { 
  LoaderCircle, 
  FileText, 
  Upload, 
  Sparkles, 
  Save, 
  X, 
  CheckCircle, 
  Brain,
  Target,
  TrendingUp,
  Calendar,
  Dumbbell,
  Clock,
  Zap,
  ChevronDown,
  ChevronUp,
  BarChart3,
  PieChart,
  Activity,
  Lightbulb,
  AlertCircle
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Area,
  AreaChart,
  PieChart as RePieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';
import { api } from '../api';
import type { Athlete, User } from '../types';
import { AITrainingPlanImporter } from './AITrainingPlanImporter';

interface Props {
  user: User;
  athlete: Athlete;
  athletes: Athlete[];
  onSaved: (planId?: number) => void | Promise<void>;
}

interface AIPlan {
  exercises?: Array<{
    id: string;
    name: string;
    maxWeight: number | null;
    unitNote: string;
  }>;

  title: string;
  summary: string;
  durationWeeks: number;
  startDate: string;
  endDate: string;
  scheduleLabel: string;
  bodyWeight: number | null;
  age: number | null;
  weeklyPlans: Array<{
    weekNumber: number;
    focus: string;
    totalLoad: number;
    intensity?: 'low' | 'medium' | 'high';
    days: Array<{
      dayOfWeek: string;
      exercises: Array<{
        name: string;
        sets: string;
        reps: string;
        percentage: number;
        notes?: string;
        category?: 'strength' | 'endurance' | 'power' | 'recovery';
      }>;
    }>;
  }>;
  guidelines: {
    principles: string[];
    keyPoints: string[];
    cautions: string[];
    nutrition: string[];
    recovery: string[];
  };
  progression: {
    phase: string;
    expectedOutcome: string;
    adjustmentStrategy: string;
  };
}

const COLORS = ['#176f7f', '#1b9d95', '#e1a42c', '#e65d43', '#7cc7b5'];
const CATEGORY_COLORS: Record<string, string> = {
  strength: '#176f7f',
  endurance: '#1b9d95',
  power: '#e1a42c',
  recovery: '#7cc7b5'
};

function categoryName(category: string) {
  return category === 'strength' ? '力量' : category === 'endurance' ? '耐力' : category === 'power' ? '爆发力' : '恢复';
}

function prescriptionNumber(value: string | number | undefined) {
  const values = String(value ?? '').match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  if (!values.length) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function relativeExerciseLoad(exercise: AIPlan['weeklyPlans'][number]['days'][number]['exercises'][number]) {
  const sets = prescriptionNumber(exercise.sets);
  const reps = prescriptionNumber(exercise.reps);
  const percentage = Number(exercise.percentage);
  if (!sets || !reps) return 1;
  return sets * reps * (Number.isFinite(percentage) && percentage > 0 ? percentage / 100 : 1);
}

export function AITrainingPlanGenerator(props: Props) {
  const [workflow, setWorkflow] = useState<'generate' | 'import'>('generate');

  return (
    <div className="ai-workflow-shell">
      <nav className="ai-workflow-switch" aria-label="AI训练计划方式">
        <button type="button" className={workflow === 'generate' ? 'active' : ''} onClick={() => setWorkflow('generate')}>
          <Sparkles size={20} />
          <span><strong>生成新计划</strong><small>描述目标，由AI制定方案</small></span>
        </button>
        <button type="button" className={workflow === 'import' ? 'active' : ''} onClick={() => setWorkflow('import')}>
          <Upload size={20} />
          <span><strong>识别已有计划</strong><small>上传原文件，校正后导入</small></span>
        </button>
      </nav>
      {workflow === 'generate'
        ? <AITrainingPlanGeneratorContent athlete={props.athlete} onSaved={props.onSaved} />
        : <AITrainingPlanImporter athlete={props.athlete} athletes={props.athletes} onSaved={props.onSaved} />}
    </div>
  );
}

function AITrainingPlanGeneratorContent({ athlete, onSaved }: Pick<Props, 'athlete' | 'onSaved'>) {
  const [step, setStep] = useState<'input' | 'analyzing' | 'preview'>('input');
  const [textInput, setTextInput] = useState('');
  const [generatedPlan, setGeneratedPlan] = useState<AIPlan | null>(null);
  const [aiMetadata, setAiMetadata] = useState<any>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedWeek, setExpandedWeek] = useState<number | null>(1);
  const handleAnalyze = async () => {
    setError('');
    
    if (!textInput.trim()) {
      setError('请输入训练需求描述');
      return;
    }

    setStep('analyzing');

    try {
      const formData = new FormData();
      formData.append('athleteId', String(athlete.id));
      formData.append('text', textInput);

      const result = await api.analyzeAITrainingPlan(formData);
      
      // 增强数据结构
      const enhancedPlan: AIPlan = {
        ...result.plan,
        guidelines: (result.plan as AIPlan).guidelines || {
          principles: ['循序渐进', '个性化调整', '充分恢复'],
          keyPoints: ['注意动作质量', '及时记录训练感受'],
          cautions: ['避免过度训练', '注意身体信号'],
          nutrition: ['保证蛋白质摄入', '训练前后适当补充碳水'],
          recovery: ['充足睡眠', '训练后拉伸放松']
        },
        progression: (result.plan as AIPlan).progression || {
          phase: '基础积累期',
          expectedOutcome: '力量素质稳步提升',
          adjustmentStrategy: '根据实际完成情况动态调整负荷'
        }
      };
      
      setGeneratedPlan(enhancedPlan);
      setAiMetadata(result.aiMetadata);
      setStep('preview');
      setExpandedWeek(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请重试');
      setStep('input');
    }
  };

  const handleSave = async () => {
    if (!generatedPlan) return;

    setSaving(true);
    try {
      const result = await api.saveAITrainingPlan({
        athleteId: athlete.id,
        plan: generatedPlan,
        aiMetadata
      });
      await onSaved(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      setSaving(false);
    }
  };

  // 图表数据准备
  const loadChartData = useMemo(() => {
    if (!generatedPlan) return [];
    return generatedPlan.weeklyPlans.map(w => ({
      week: `第${w.weekNumber}周`,
      load: w.totalLoad,
      days: w.days.length,
      prescriptions: w.days.reduce((sum, day) => sum + day.exercises.length, 0)
    }));
  }, [generatedPlan]);

  const exerciseDistribution = useMemo(() => {
    if (!generatedPlan) return [];
    const dist = new Map<string, number>();
    generatedPlan.weeklyPlans.forEach(w => {
      w.days.forEach(d => {
        d.exercises.forEach(e => {
          const cat = e.category || 'strength';
          dist.set(cat, (dist.get(cat) || 0) + 1);
        });
      });
    });
    return Array.from(dist.entries()).map(([name, value]) => ({
      key: name,
      name: categoryName(name),
      value,
      color: CATEGORY_COLORS[name] || COLORS[0]
    }));
  }, [generatedPlan]);

  const dashboardData = useMemo(() => {
    if (!generatedPlan) return {
      intensityByWeek: [],
      exerciseVolumes: [],
      dailyLoads: [],
      heatmapWeeks: [],
      metrics: { days: 0, prescriptions: 0, averageIntensity: 0, peakWeek: '—' }
    };
    const intensityByWeek: Array<{ week: string; low: number; medium: number; high: number }> = [];
    const volumeMap = new Map<string, number>();
    const dailyLoads: Array<{ day: string; load: number; prescriptions: number }> = [];
    const heatmapWeeks: Array<{ week: string; focus: string; days: Array<{ day: string; load: number; prescriptions: number }> }> = [];
    const percentages: number[] = [];
    let totalDays = 0;
    let totalPrescriptions = 0;

    generatedPlan.weeklyPlans.forEach((week) => {
      const zones = { week: `W${week.weekNumber}`, low: 0, medium: 0, high: 0 };
      const heatmapDays: Array<{ day: string; load: number; prescriptions: number }> = [];
      week.days.forEach((day) => {
        totalDays += 1;
        totalPrescriptions += day.exercises.length;
        let dayLoad = 0;
        day.exercises.forEach((exercise) => {
          const load = relativeExerciseLoad(exercise);
          dayLoad += load;
          volumeMap.set(exercise.name, (volumeMap.get(exercise.name) || 0) + load);
          const percentage = Number(exercise.percentage);
          if (Number.isFinite(percentage) && percentage > 0) percentages.push(percentage);
          const resolved = Number.isFinite(percentage) && percentage > 0
            ? percentage
            : week.intensity === 'high' ? 85 : week.intensity === 'medium' ? 70 : 55;
          if (resolved >= 80) zones.high += 1;
          else if (resolved >= 65) zones.medium += 1;
          else zones.low += 1;
        });
        const point = {
          day: day.dayOfWeek || `训练日${heatmapDays.length + 1}`,
          load: Math.round(dayLoad * 10) / 10,
          prescriptions: day.exercises.length
        };
        heatmapDays.push(point);
        dailyLoads.push({ ...point, day: `W${week.weekNumber}·${point.day}` });
      });
      intensityByWeek.push(zones);
      heatmapWeeks.push({ week: `WEEK ${week.weekNumber}`, focus: week.focus, days: heatmapDays });
    });

    const exerciseVolumes = [...volumeMap.entries()]
      .map(([name, load]) => ({ name, load: Math.round(load * 10) / 10 }))
      .sort((a, b) => b.load - a.load)
      .slice(0, 8);
    const peak = [...generatedPlan.weeklyPlans].sort((a, b) => b.totalLoad - a.totalLoad)[0];
    return {
      intensityByWeek,
      exerciseVolumes,
      dailyLoads,
      heatmapWeeks,
      metrics: {
        days: totalDays,
        prescriptions: totalPrescriptions,
        averageIntensity: percentages.length ? Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length) : 0,
        peakWeek: peak ? `W${peak.weekNumber}` : '—'
      }
    };
  }, [generatedPlan]);
  const distributionTotal = exerciseDistribution.reduce((sum, item) => sum + item.value, 0);
  const maxDailyLoad = Math.max(1, ...dashboardData.dailyLoads.map((item) => item.load));
  const hasHeatmapDays = dashboardData.heatmapWeeks.some((week) => week.days.length > 0);

  if (step === 'input') {
    return (
      <div className="ai-training-container">
        <div className="ai-header">
          <div className="ai-badge">
            <Brain size={24} />
            <span>AI 智能训练规划</span>
          </div>
          <h2>为 {athlete.name} 定制专属训练方案</h2>
          <p>AI 将分析运动员数据，生成科学、个性化的训练计划</p>
        </div>

        <div className="input-section">
          <div className="input-content">
            <div className="generation-mode-label"><FileText size={18} /><span>用文字描述一个新的训练目标</span></div>
            <div className="text-input-wrapper">
              <label htmlFor="ai-training-goal">描述训练需求和目标</label>
              <textarea
                id="ai-training-goal"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={`例如：\n• 运动员准备参加全运会，需要提升最大力量\n• 当前卧拉MAX 65kg，深蹲MAX 80kg\n• 希望在未来8周内重点提升上肢力量\n• 每周可训练3次，周二、周四、周六\n• 请制定渐进超负荷的科学训练计划`}
                rows={10}
              />
              <div className="input-hint">
                <Lightbulb size={14} />
                <span>这里用于生成新计划；已有文件请切换到“识别已有计划”</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="error-alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className="action-bar">
            <button className="btn-secondary" onClick={() => { setTextInput(''); setError(''); setStep('input'); }}>
              <X size={16} /> 重置
            </button>
            <button className="btn-primary ai-generate" onClick={handleAnalyze}>
              <Sparkles size={18} /> 
              生成 AI 训练计划
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'analyzing') {
    return (
      <div className="ai-training-container analyzing">
        <div className="analyzing-content">
          <div className="brain-animation">
            <Brain size={64} className="pulse" />
            <div className="neural-connections">
              <span></span><span></span><span></span>
            </div>
          </div>
          <h3>AI 正在深度分析中...</h3>
          <div className="analysis-steps">
            <div className="step completed">
              <CheckCircle size={16} />
              <span>分析运动员历史数据</span>
            </div>
            <div className="step completed">
              <CheckCircle size={16} />
              <span>理解训练需求和目标</span>
            </div>
            <div className="step active">
              <LoaderCircle size={16} className="spin" />
              <span>生成个性化训练方案</span>
            </div>
            <div className="step">
              <span></span>
              <span>优化训练负荷分布</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'preview' && generatedPlan) {
    return (
      <div className="ai-training-container preview">
        <div className="preview-header">
          <div className="plan-title-section">
            <div className="ai-badge small">
              <Zap size={14} />
              <span>AI 生成</span>
            </div>
            <h2>{generatedPlan.title}</h2>
            <div className="plan-meta">
              <span><Calendar size={14} /> {generatedPlan.durationWeeks} 周计划</span>
              <span><Clock size={14} /> {generatedPlan.scheduleLabel}</span>
              <span><Target size={14} /> {generatedPlan.progression.phase}</span>
            </div>
          </div>
          <button className="btn-icon" onClick={() => { setGeneratedPlan(null); setAiMetadata(null); setError(''); setStep('input'); }}>
            <X size={20} />
          </button>
        </div>

        <div className="preview-content">
          {/* AI 分析摘要 */}
          <div className="ai-insight-card">
            <div className="card-header">
              <Brain size={20} />
              <h3>AI 分析摘要</h3>
            </div>
            <p className="summary-text">{generatedPlan.summary}</p>
            <div className="model-info">
              <span>生成模型：{aiMetadata?.modelUsed}</span>
              <span>分析时间：{new Date().toLocaleString()}</span>
            </div>
          </div>

          {/* 训练方针 */}
          <div className="guidelines-grid">
            <div className="guideline-card">
              <div className="card-header">
                <Target size={18} />
                <h4>训练原则</h4>
              </div>
              <ul>
                {generatedPlan.guidelines.principles.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>

            <div className="guideline-card">
              <div className="card-header">
                <Lightbulb size={18} />
                <h4>关键要点</h4>
              </div>
              <ul>
                {generatedPlan.guidelines.keyPoints.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>

            <div className="guideline-card caution">
              <div className="card-header">
                <AlertCircle size={18} />
                <h4>注意事项</h4>
              </div>
              <ul>
                {generatedPlan.guidelines.cautions.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>

            <div className="guideline-card recovery">
              <div className="card-header">
                <Activity size={18} />
                <h4>恢复建议</h4>
              </div>
              <ul>
                {generatedPlan.guidelines.recovery.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* 数据可视化 */}
          <div className="charts-section">
            <div className="charts-section-heading">
              <div><BarChart3 size={19} /><span><strong>训练计划数据看板</strong><small>保存前检查训练量、强度与结构是否均衡</small></span></div>
              <em>PLAN INTELLIGENCE</em>
            </div>

            <div className="plan-dashboard-strip">
              <div><span>训练周期</span><strong>{generatedPlan.durationWeeks}</strong><small>WEEKS</small></div>
              <div><span>训练日</span><strong>{dashboardData.metrics.days}</strong><small>SESSIONS</small></div>
              <div><span>处方条目</span><strong>{dashboardData.metrics.prescriptions}</strong><small>ITEMS</small></div>
              <div><span>平均强度</span><strong>{dashboardData.metrics.averageIntensity || '—'}</strong><small>{dashboardData.metrics.averageIntensity ? '% 1RM' : '未标注'}</small></div>
              <div className="peak"><span>峰值周</span><strong>{dashboardData.metrics.peakWeek}</strong><small>PEAK LOAD</small></div>
            </div>

            <div className="charts-grid enhanced">
              <div className="chart-card wide chart-primary">
                <div className="chart-card-heading"><span>LOAD</span><div><h4>周训练负荷趋势</h4><p>AI给出的周期负荷指数与训练频次</p></div></div>
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={loadChartData}>
                    <defs>
                      <linearGradient id="loadGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#168f88" stopOpacity={0.42}/>
                        <stop offset="95%" stopColor="#176f7f" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 6" stroke="#d9e5e6" vertical={false} />
                    <XAxis dataKey="week" interval={0} tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#b9cccf' }} />
                    <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value, name) => [value, name === 'load' ? '负荷指数' : name]} />
                    <Area 
                      type="monotone" 
                      dataKey="load" 
                      stroke="#0b5963"
                      strokeWidth={3}
                      dot={{ r: 5, fill: '#ffc20a', stroke: '#0b5963', strokeWidth: 2 }}
                      fillOpacity={1} 
                      fill="url(#loadGradient)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
                <div className="chart-inline-stats">
                  {loadChartData.map((item) => <span key={item.week}><b>{item.week}</b>{item.days}天 · {item.prescriptions}条</span>)}
                </div>
              </div>

              <div className="chart-card">
                <div className="chart-card-heading"><span>MIX</span><div><h4>训练类型占比</h4><p>按处方条目统计</p></div></div>
                <div className="chart-donut-wrap">
                  {distributionTotal > 0 ? <>
                    <ResponsiveContainer width="100%" height={210}>
                      <RePieChart>
                        <Pie data={exerciseDistribution} cx="50%" cy="50%" innerRadius={58} outerRadius={86} paddingAngle={3} dataKey="value" stroke="none">
                          {exerciseDistribution.map((entry) => <Cell key={entry.key} fill={entry.color} />)}
                        </Pie>
                        <Tooltip formatter={(value) => [`${value} 条`, '处方']} />
                      </RePieChart>
                    </ResponsiveContainer>
                    <div className="donut-center"><strong>{distributionTotal}</strong><span>条处方</span></div>
                  </> : <div className="chart-empty">AI未返回可统计的训练类型</div>}
                </div>
                <div className="chart-legend-list">
                  {exerciseDistribution.map((entry) => (
                    <span key={entry.key}><i style={{ background: entry.color }} /><b>{entry.name}</b><em>{distributionTotal ? Math.round(entry.value / distributionTotal * 100) : 0}%</em></span>
                  ))}
                </div>
              </div>

              <div className="chart-card">
                <div className="chart-card-heading"><span>ZONE</span><div><h4>强度分区结构</h4><p>低于65% / 65—79% / 80%以上</p></div></div>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={dashboardData.intensityByWeek}>
                    <CartesianGrid strokeDasharray="3 6" stroke="#e0e9ea" vertical={false} />
                    <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: '#bdcdcf' }} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value, name) => [`${value} 条`, name === 'low' ? '低强度' : name === 'medium' ? '中强度' : '高强度']} />
                    <Legend formatter={(value) => value === 'low' ? '低强度' : value === 'medium' ? '中强度' : '高强度'} />
                    <Bar dataKey="low" stackId="zone" fill="#7cc7b5" radius={[0, 0, 3, 3]} />
                    <Bar dataKey="medium" stackId="zone" fill="#e1a42c" />
                    <Bar dataKey="high" stackId="zone" fill="#d85445" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-card">
                <div className="chart-card-heading"><span>VOLUME</span><div><h4>项目相对训练量排行</h4><p>组 × 次 × 强度，取前8项</p></div></div>
                {dashboardData.exerciseVolumes.length > 0 ? <ResponsiveContainer width="100%" height={Math.max(230, dashboardData.exerciseVolumes.length * 34)}>
                  <BarChart data={dashboardData.exerciseVolumes} layout="vertical" margin={{ left: 10, right: 28 }}>
                    <CartesianGrid strokeDasharray="3 6" stroke="#e1e9ea" horizontal={false} />
                    <XAxis type="number" tickLine={false} axisLine={{ stroke: '#bdcdcf' }} />
                    <YAxis type="category" dataKey="name" width={92} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value) => [value, '相对训练量']} />
                    <Bar dataKey="load" fill="#176f7f" radius={[0, 5, 5, 0]} />
                  </BarChart>
                </ResponsiveContainer> : <div className="chart-empty">AI未返回可计算的项目处方</div>}
              </div>

              <div className="chart-card">
                <div className="chart-card-heading"><span>SESSION</span><div><h4>单日相对负荷</h4><p>比较每个训练日的处方密度</p></div></div>
                {dashboardData.dailyLoads.length > 0 ? <ResponsiveContainer width="100%" height={Math.max(230, dashboardData.dailyLoads.length * 31)}>
                  <BarChart data={dashboardData.dailyLoads} layout="vertical" margin={{ left: 8, right: 28 }}>
                    <CartesianGrid strokeDasharray="3 6" stroke="#e1e9ea" horizontal={false} />
                    <XAxis type="number" tickLine={false} axisLine={{ stroke: '#bdcdcf' }} />
                    <YAxis type="category" dataKey="day" width={92} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value, name) => [value, name === 'load' ? '相对负荷' : name]} />
                    <Bar dataKey="load" fill="#1b9d95" radius={[0, 5, 5, 0]} />
                  </BarChart>
                </ResponsiveContainer> : <div className="chart-empty">AI未返回训练日处方</div>}
              </div>

              <div className="chart-card wide heatmap-card">
                <div className="chart-card-heading"><span>DENSITY</span><div><h4>周期训练密度热力图</h4><p>颜色越深，代表该训练日的相对处方负荷越高</p></div></div>
                {hasHeatmapDays ? <div className="microcycle-heatmap" role="img" aria-label="周期训练密度热力图">
                  {dashboardData.heatmapWeeks.map((week) => (
                    <div className="heatmap-week" key={week.week}>
                      <div className="heatmap-week-label"><strong>{week.week}</strong><span>{week.focus}</span></div>
                      <div className="heatmap-days">
                        {week.days.map((day, index) => {
                          const ratio = day.load / maxDailyLoad;
                          return (
                            <div
                              className={ratio > 0.56 ? 'heatmap-day high' : 'heatmap-day'}
                              key={`${day.day}-${index}`}
                              style={{ backgroundColor: `rgba(11, 89, 99, ${0.10 + ratio * 0.84})` }}
                              title={`${day.day}：相对负荷 ${day.load}，${day.prescriptions} 条处方`}
                            >
                              <span>{day.day}</span><strong>{day.load}</strong><small>{day.prescriptions} 条</small>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div> : <div className="chart-empty">AI未返回可展示的周期训练日</div>}
                {hasHeatmapDays && <div className="heatmap-scale"><span>低</span><i /><i /><i /><i /><span>高</span></div>}
              </div>
            </div>
          </div>

          {/* 动态训练计划 */}
          <div className="training-schedule">
            <h3><Dumbbell size={18} /> 详细训练安排</h3>
            
            <div className="weeks-accordion">
              {generatedPlan.weeklyPlans.map((week) => (
                <div 
                  key={week.weekNumber} 
                  className={`week-card ${expandedWeek === week.weekNumber ? 'expanded' : ''}`}
                >
                  <div 
                    className="week-header"
                    onClick={() => setExpandedWeek(expandedWeek === week.weekNumber ? null : week.weekNumber)}
                  >
                    <div className="week-info">
                      <span className="week-number">第 {week.weekNumber} 周</span>
                      <span className="week-focus">{week.focus}</span>
                    </div>
                    <div className="week-stats">
                      <span className="load-badge">
                        <TrendingUp size={14} />
                        负荷 {week.totalLoad}
                      </span>
                      <span className={`intensity-badge ${week.intensity}`}>
                        {week.intensity === 'high' ? '高强度' : week.intensity === 'medium' ? '中强度' : '低强度'}
                      </span>
                      {expandedWeek === week.weekNumber ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                  </div>

                  {expandedWeek === week.weekNumber && (
                    <div className="week-content">
                      {week.days.map((day, idx) => (
                        <div key={idx} className="day-section">
                          <h5>{day.dayOfWeek}</h5>
                          <div className="exercises-list">
                            {day.exercises.map((ex, eidx) => (
                              <div key={eidx} className="exercise-item">
                                <div className="exercise-main">
                                  <span className="exercise-name">{ex.name}</span>
                                  <span className="exercise-params">
                                    {ex.sets} 组 × {ex.reps} 次 @ {ex.percentage}%
                                  </span>
                                </div>
                                {ex.notes && (
                                  <span className="exercise-notes">{ex.notes}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 预期成果 */}
          <div className="outcome-card">
            <div className="card-header">
              <TrendingUp size={20} />
              <h3>预期训练成果</h3>
            </div>
            <div className="outcome-content">
              <div className="outcome-item">
                <span className="label">训练阶段</span>
                <span className="value">{generatedPlan.progression.phase}</span>
              </div>
              <div className="outcome-item">
                <span className="label">预期效果</span>
                <span className="value">{generatedPlan.progression.expectedOutcome}</span>
              </div>
              <div className="outcome-item">
                <span className="label">调整策略</span>
                <span className="value">{generatedPlan.progression.adjustmentStrategy}</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="error-alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className="preview-actions">
            <button className="btn-secondary" onClick={() => setStep('input')}>
              <X size={16} /> 重新输入
            </button>
            <button 
              className="btn-primary save-plan" 
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <><LoaderCircle size={16} className="spin" /> 保存中...</>
              ) : (
                <><Save size={16} /> 保存训练计划</>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

