import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { StrengthTrainingSession } from '../types';

type Props = {
  sessions: StrengthTrainingSession[];
};

function sessionRpe(session: StrengthTrainingSession) {
  const values = session.sets.map((set) => set.rpe).filter((value): value is number => value !== null);
  if (values.length) return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10;
  return session.rpe;
}

export function StrengthTrainingLoadChart({ sessions }: Props) {
  const data = [...sessions]
    .sort((left, right) => left.trainingDate.localeCompare(right.trainingDate) || left.sessionOrder - right.sessionOrder)
    .map((session) => ({
      id: session.id,
      label: `${session.trainingDate.slice(5).replace('-', '/')} · ${session.sessionOrder}`,
      session: session.sessionLabel,
      volume: Math.round(session.volume),
      rpe: sessionRpe(session)
    }));

  return (
    <section className="strength-load-visual" aria-label="训练负荷趋势">
      <header>
        <div><span>TRAINING LOAD</span><h3>训练负荷趋势</h3><p>柱形表示每场训练量，折线表示平均RPE；同日多场分别记录。</p></div>
        <div className="strength-load-legend" aria-hidden="true"><span><i />训练量</span><span><i />平均RPE</span></div>
      </header>
      <div className="strength-load-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
            <CartesianGrid stroke="#e1eaeb" strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#71858b', fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={18} />
            <YAxis yAxisId="volume" tick={{ fill: '#71858b', fontSize: 9 }} axisLine={false} tickLine={false} width={45} tickFormatter={(value) => Number(value).toLocaleString()} />
            <YAxis yAxisId="rpe" orientation="right" domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fill: '#c07135', fontSize: 9 }} axisLine={false} tickLine={false} width={24} />
            <Tooltip
              labelFormatter={(label, payload) => payload?.[0]?.payload?.session ? `${label} · ${payload[0].payload.session}` : String(label)}
              formatter={(value, name) => name === '平均RPE' ? [value ?? '未记录', name] : [`${Number(value).toLocaleString()} kg·reps`, name]}
              contentStyle={{ border: '1px solid #d5e2e4', borderRadius: 8, boxShadow: '0 10px 24px rgba(7,59,76,.1)', fontSize: 10 }}
            />
            <Bar yAxisId="volume" dataKey="volume" name="训练量" fill="#0e8f87" radius={[4, 4, 0, 0]} maxBarSize={34} animationDuration={180} />
            <Line yAxisId="rpe" type="monotone" dataKey="rpe" name="平均RPE" stroke="#d1813f" strokeWidth={2.2} dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} connectNulls animationDuration={180} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
