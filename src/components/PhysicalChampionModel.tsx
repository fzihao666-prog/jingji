import { useEffect, useId, useState } from 'react';
import { api } from '../api';
import type { Project } from '../types';
import { projectLabel } from '../../shared/projects';
import type { PhysicalChampionPayload } from '../../shared/physical-champion';
import { PhysicalChampionOverview } from './PhysicalChampionOverview';
import { ChartCard, ContentState } from './PageLayout';
import './PhysicalChampionModel.css';

type Props = { project: Project; from: string; to: string };

export function PhysicalChampionModel({ project, from, to }: Props) {
  const [payload, setPayload] = useState<PhysicalChampionPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [groupId, setGroupId] = useState('');
  const [revision, setRevision] = useState(0);
  const selectorId = useId();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .physicalChampion({ project, from, to })
      .then((result) => {
        if (active) setPayload(result);
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : '冠军模型加载失败。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project, from, to, revision]);
  const current =
    payload?.project === project && payload.from === from && payload.to === to ? payload : null;
  const showLoading = loading || (!error && !current);
  const group = current?.groups.find((item) => item.id === groupId) ?? current?.groups[0];
  return (
    <ChartCard
      title="体能冠军模型"
      description={`${projectLabel(project)} · ${from} — ${to}`}
      className="physical-champion"
    >
      {showLoading ? (
        <ContentState kind="loading" title="正在加载冠军模型" />
      ) : error ? (
        <ContentState
          kind="error"
          title="冠军模型加载失败"
          description={error}
          action={
            <button type="button" onClick={() => setRevision((value) => value + 1)}>
              重试
            </button>
          }
        />
      ) : !group ? (
        <ContentState
          kind="empty"
          title="待配置冠军模型"
          description={current?.pendingReason || '当前项目尚未配置冠军值。'}
        />
      ) : (
        <>
          {current && current.groups.length > 1 && (
            <div className="physical-champion-toolbar">
              <label htmlFor={selectorId}>参考分组</label>
              <select
                id={selectorId}
                value={group.id}
                onChange={(event) => setGroupId(event.target.value)}
              >
                {current.groups.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <PhysicalChampionOverview
            key={`${project}:${group.id}:${revision}`}
            group={group}
            canEdit={current?.canEdit ?? false}
            onSave={async (values) => {
              await api.updatePhysicalChampionValues({ project, values });
              setPayload(null);
              setRevision((value) => value + 1);
            }}
          />
        </>
      )}
    </ChartCard>
  );
}
