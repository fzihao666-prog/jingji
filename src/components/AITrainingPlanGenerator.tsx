import { useState, useRef, useMemo } from 'react';
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
  LineChart,
  Line,
  Area,
  AreaChart,
  PieChart as RePieChart,
  Pie,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar
} from 'recharts';
import { api } from '../api';
import type { Athlete, User } from '../types';

interface Props {
  user: User;
  athlete: Athlete;
  onSaved: () => void;
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

export function AITrainingPlanGenerator({ user, athlete, onSaved }: Props) {
  const [step, setStep] = useState<'input' | 'analyzing' | 'preview'>('input');
  const [inputMode, setInputMode] = useState<'text' | 'file'>('text');
  const [textInput, setTextInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [generatedPlan, setGeneratedPlan] = useState<AIPlan | null>(null);
  const [aiMetadata, setAiMetadata] = useState<any>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedWeek, setExpandedWeek] = useState<number | null>(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setError('文件大小不能超过 10MB');
        return;
      }
      setSelectedFile(file);
      setError('');
    }
  };

  const handleAnalyze = async () => {
    setError('');
    
    if (inputMode === 'text' && !textInput.trim()) {
      setError('请输入训练需求描述');
      return;
    }
    if (inputMode === 'file' && !selectedFile) {
      setError('请选择要上传的文件');
      return;
    }

    setStep('analyzing');

    try {
      const formData = new FormData();
      formData.append('athleteId', String(athlete.id));
      formData.append('inputType', inputMode);

      if (inputMode === 'file' && selectedFile) {
        formData.append('file', selectedFile);
      } else {
        formData.append('text', textInput);
      }

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
      await api.saveAITrainingPlan({
        athleteId: athlete.id,
        plan: generatedPlan,
        aiMetadata
      });
      onSaved();
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
      intensity: w.intensity === 'high' ? 3 : w.intensity === 'medium' ? 2 : 1
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
      name: name === 'strength' ? '力量' : name === 'endurance' ? '耐力' : name === 'power' ? '爆发力' : '恢复',
      value
    }));
  }, [generatedPlan]);

  const intensityRadarData = useMemo(() => {
    if (!generatedPlan) return [];
    return generatedPlan.weeklyPlans.map(w => ({
      week: `W${w.weekNumber}`,
      intensity: w.totalLoad,
      fullMark: 100
    }));
  }, [generatedPlan]);

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
          <div className="input-tabs">
            <button
              className={inputMode === 'text' ? 'active' : ''}
              onClick={() => setInputMode('text')}
            >
              <FileText size={18} />
              <span>文字描述</span>
            </button>
            <button
              className={inputMode === 'file' ? 'active' : ''}
              onClick={() => setInputMode('file')}
            >
              <Upload size={18} />
              <span>上传文件</span>
            </button>
          </div>

          <div className="input-content">
            {inputMode === 'text' ? (
              <div className="text-input-wrapper">
                <label>描述训练需求和目标</label>
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={`例如：\n• 运动员准备参加全运会，需要提升最大力量\n• 当前卧拉MAX 65kg，深蹲MAX 80kg\n• 希望在未来8周内重点提升上肢力量\n• 每周可训练3次，周二、周四、周六\n• 请制定渐进超负荷的科学训练计划`}
                  rows={10}
                />
                <div className="input-hint">
                  <Lightbulb size={14} />
                  <span>描述越详细，AI 生成的计划越精准</span>
                </div>
              </div>
            ) : (
              <div className="file-upload-wrapper">
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  accept=".xlsx,.xls,.pdf,.doc,.docx,.txt,.md,.jpg,.jpeg,.png"
                  hidden
                />
                <div
                  className={`upload-zone ${selectedFile ? 'has-file' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {selectedFile ? (
                    <>
                      <CheckCircle size={48} className="success-icon" />
                      <h4>{selectedFile.name}</h4>
                      <p>{(selectedFile.size / 1024).toFixed(1)} KB</p>
                      <button
                        className="change-file"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFile(null);
                        }}
                      >
                        更换文件
                      </button>
                    </>
                  ) : (
                    <>
                      <Upload size={48} />
                      <h4>点击或拖拽上传文件</h4>
                      <p>支持 Excel、Word、PDF、文本、图片</p>
                      <span className="file-types">.xlsx .doc .pdf .txt .jpg</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="error-alert">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className="action-bar">
            <button className="btn-secondary" onClick={() => { setTextInput(''); setSelectedFile(null); setError(''); setStep('input'); }}>
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
            <h3><BarChart3 size={18} /> 训练数据分析</h3>
            
            <div className="charts-grid">
              {/* 训练负荷趋势 */}
              <div className="chart-card">
                <h4>周训练负荷趋势</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={loadChartData}>
                    <defs>
                      <linearGradient id="loadGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#176f7f" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#176f7f" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="week" />
                    <YAxis />
                    <Tooltip />
                    <Area 
                      type="monotone" 
                      dataKey="load" 
                      stroke="#176f7f" 
                      fillOpacity={1} 
                      fill="url(#loadGradient)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* 训练类型分布 */}
              <div className="chart-card">
                <h4>训练类型分布</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <RePieChart>
                    <Pie
                      data={exerciseDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {exerciseDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </RePieChart>
                </ResponsiveContainer>
              </div>

              {/* 强度雷达图 */}
              <div className="chart-card wide">
                <h4>周期强度分布</h4>
                <ResponsiveContainer width="100%" height={250}>
                  <RadarChart cx="50%" cy="50%" outerRadius="80%" data={intensityRadarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="week" />
                    <PolarRadiusAxis angle={30} domain={[0, 100]}/>
                    <Radar
                      name="训练强度"
                      dataKey="intensity"
                      stroke="#1b9d95"
                      fill="#1b9d95"
                      fillOpacity={0.3}
                    />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
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

