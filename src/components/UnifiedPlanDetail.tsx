import type { CatalogPlan } from '../../shared/training-plan-catalog';
import { planDays, planObject, planText } from '../../shared/training-plan-view';

export function UnifiedPlanDetail({ plan }: { plan: CatalogPlan }) {
  const days = planDays(plan);
  const exercises = (Array.isArray(plan.data.exercises) ? plan.data.exercises : []).map(planObject);
  const weekLabels = planObject(plan.data.weekLabels);
  return (
    <>
      <h3>周期安排与每日训练内容</h3>
      <p>
        体重：{planText(plan.data.bodyWeight)} kg · 年龄：{planText(plan.data.age)} 岁
      </p>
      <p>
        {planText(plan.data.scheduleLabel)}
        {plan.data.summary ? ` · ${planText(plan.data.summary)}` : ''}
      </p>
      {days.length ? (
        days.map((day) => (
          <section className="unified-plan-day" key={day.key}>
            <h4>{day.date}</h4>
            <p>训练重点：{day.focus || '未设置'}</p>
            {day.notes && <p>备注：{day.notes}</p>}
            <div className="table-scroll">
              <table>
                <caption className="sr-only">{day.date}训练内容</caption>
                <thead>
                  <tr>
                    <th scope="col">训练内容</th>
                    <th scope="col">类型</th>
                    <th scope="col">计划时长（分钟） / 公里数（km）</th>
                    <th scope="col">强度与备注</th>
                  </tr>
                </thead>
                <tbody>
                  {day.items.map((item, index) => (
                    <tr key={`${day.key}:${index}`}>
                      <td>
                        {planText(item.name || item.content)}
                        {item.start_time ? (
                          <small>
                            {planText(item.start_time)} — {planText(item.end_time)}
                          </small>
                        ) : null}
                      </td>
                      <td>
                        {planText(
                          item.training_type || item.trainingType || item.type || item.category
                        )}
                      </td>
                      <td>
                        {planText(item.durationMin ?? item.duration ?? item.estimatedMinutes)} /{' '}
                        {planText(item.distanceKm ?? item.distance)}
                      </td>
                      <td>
                        {planText(item.intensity ?? item.targetIntensity ?? item.percentage)}
                        {item.plannedWeight !== undefined ? (
                          <small>计划重量：{planText(item.plannedWeight)}</small>
                        ) : null}
                        {item.load !== undefined ? (
                          <small>负荷：{planText(item.load)}</small>
                        ) : null}
                        {item.pace !== undefined ? (
                          <small>配速：{planText(item.pace)}</small>
                        ) : null}
                        {item.rawText !== undefined ? (
                          <small>原始训练描述：{planText(item.rawText)}</small>
                        ) : null}
                        <small>
                          {planText(item.notes || item.note || item.detail || item.venue)}
                        </small>
                        {item.target ? <small>目标：{planText(item.target)}</small> : null}
                        {item.sets !== undefined || item.reps !== undefined ? (
                          <small>
                            组数 / 次数：{planText(item.sets)} / {planText(item.reps)}
                          </small>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!day.items.length && <p>当日未保存具体训练内容</p>}
          </section>
        ))
      ) : (
        <p>未保存按日安排；以下按原计划周期展示，不推算每日课表。</p>
      )}
      {exercises.length > 0 && (
        <>
          <h3>
            {plan.kind === 'special'
              ? '专项训练安排'
              : plan.kind === 'combined'
                ? '专项与体能训练处方'
                : '体能训练安排'}
          </h3>
          {exercises.map((exercise, index) => (
            <section className="unified-plan-day" key={String(exercise.id || index)}>
              <h4>{planText(exercise.name)}</h4>
              <p>{planText(exercise.unitNote)}</p>
              <p>
                类别：{planText(exercise.category || exercise.trainingCategory)} · 部位：
                {planText(exercise.bodyPosition)} · MAX：{planText(exercise.maxWeight)} kg
              </p>
              <p>
                目标强度：{planText(exercise.targetIntensity)} · 预计时长：
                {planText(exercise.estimatedMinutes)} 分钟
              </p>
              <div className="table-scroll">
                <table>
                  <caption className="sr-only">{planText(exercise.name)}周期处方</caption>
                  <thead>
                    <tr>
                      <th scope="col">周期</th>
                      <th scope="col">组数</th>
                      <th scope="col">次数</th>
                      <th scope="col">强度 %</th>
                      <th scope="col">计划重量（kg）</th>
                      <th scope="col">训练安排</th>
                      <th scope="col">原记录完成情况</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Array.isArray(exercise.lines) ? exercise.lines : []).flatMap(
                      (line, lineIndex) =>
                        Object.entries(planObject(planObject(line).weeks)).map(([key, raw]) => {
                          const entry = planObject(raw);
                          return (
                            <tr key={`${lineIndex}:${key}`}>
                              <td>{planText(weekLabels[key] || `第${key}周`)}</td>
                              <td>{planText(entry.sets)}</td>
                              <td>{planText(entry.reps)}</td>
                              <td>{planText(entry.percentage)}</td>
                              <td>
                                {typeof exercise.maxWeight === 'number' &&
                                typeof entry.percentage === 'number'
                                  ? Math.round(exercise.maxWeight * entry.percentage) / 100
                                  : '—'}
                              </td>
                              <td>{planText(entry.arrangement)}</td>
                              <td>{planText(entry.actualCompleted)}</td>
                            </tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
      {plan.data.unmappedContent ? (
        <p>原计划补充内容：{planText(plan.data.unmappedContent)}</p>
      ) : null}
      {plan.data.warnings ? <p>原计划提示：{planText(plan.data.warnings)}</p> : null}
    </>
  );
}
