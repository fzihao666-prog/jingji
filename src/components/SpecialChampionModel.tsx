import { Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { AppCard, ContentState, SectionHeader } from './PageLayout';
import type { ErgometerChampionModelPayload, Project, SpecialChampionModelEvent, SpecialChampionModelPayload } from '../types';
import { CHAMPION_MODEL_STANDARD_LABELS, CHAMPION_MODEL_STANDARD_TYPES, type ChampionModelStandardType } from '../../shared/champion-model';
import { projectLabel } from '../../shared/projects';

type EventRow = {
  eventCode: string;
  eventName: string;
  standards: Partial<Record<ChampionModelStandardType, SpecialChampionModelEvent>>;
};

type ErgometerTestType = '2000M' | '5000M' | '30MIN_20SPM';

const ERGOMETER_LEVELS = [
  { code: 'BASIC', label: '基础' },
  { code: 'YOUTH_3', label: '青少三级' },
  { code: 'YOUTH_2', label: '青少二级' },
  { code: 'YOUTH_1', label: '青少一级' },
  { code: 'PROVINCIAL', label: '省市' },
  { code: 'PROVINCIAL_EXCELLENT', label: '省优' },
  { code: 'NATIONAL_EXCELLENT', label: '国优' },
  { code: 'U23_INTERNATIONAL', label: 'U23' },
  { code: 'INTERNATIONAL_EXCELLENT', label: '国际' }
] as const;

function normalizeErgometerValue(value: string | undefined, testType: ErgometerTestType) {
  if (!value) return '-';
  if (testType !== '5000M') return value;
  return /^\d+:\d{2}$/.test(value) ? `${value}.0` : value;
}

function ErgometerTabs({
  value,
  onChange
}: {
  value: ErgometerTestType;
  onChange: (value: ErgometerTestType) => void;
}) {
  return (
    <div className="ergometer-model-tabs">
      <button
        type="button"
        className={value === '2000M' ? 'active' : ''}
        onClick={() => onChange('2000M')}
      >
        2000m
      </button>

      <button
        type="button"
        className={value === '5000M' ? 'active' : ''}
        onClick={() => onChange('5000M')}
      >
        5000m
      </button>

      <button
        type="button"
        className={value === '30MIN_20SPM' ? 'active' : ''}
        onClick={() => onChange('30MIN_20SPM')}
      >
        30分钟（20桨）
      </button>
    </div>
  );
}

export function SpecialChampionModel({ project }: { project: Project }) {
  const [model, setModel] = useState<SpecialChampionModelPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [maleTestType, setMaleTestType] = useState<
    '2000M' | '5000M' | '30MIN_20SPM'
  >('2000M');

  const [maleModel, setMaleModel] =
    useState<ErgometerChampionModelPayload | null>(null);

  const [femaleTestType, setFemaleTestType] = useState<
    '2000M' | '5000M' | '30MIN_20SPM'
  >('2000M');

  const [femaleModel, setFemaleModel] =
    useState<ErgometerChampionModelPayload | null>(null);

  useEffect(() => {
    let ignored = false;
    setLoading(true);
    setError('');
    setModel(null);
    api.specialChampionModels(project)
      .then((payload) => { if (!ignored) setModel(payload); })
      .catch((reason: unknown) => { if (!ignored) setError(reason instanceof Error ? reason.message : '冠军模型读取失败。'); })
      .finally(() => { if (!ignored) setLoading(false); });
    return () => { ignored = true; };
  }, [project]);

  useEffect(() => {
    api.ergometerChampionModels(
      project,
      'MALE',
      maleTestType
    ).then(setMaleModel);
  }, [project, maleTestType]);
  useEffect(() => {
    api.ergometerChampionModels(
      project,
      'FEMALE',
      femaleTestType
    ).then(setFemaleModel);
  }, [project, femaleTestType]);

  function ergometerValueLabel(testType: ErgometerTestType) {
    if (testType === '30MIN_20SPM') {
      return '平均配速（/500m）';
    }

    return '完成时间';
  }


  const events = model?.events || [];
  const content = loading
    ? <ContentState kind="loading" title="正在读取冠军模型配置" />
    : error
      ? <ContentState kind="error" title="冠军模型暂不可用" description={error} />
      : !events.length
        ? <ContentState kind="empty" title="模型数据待配置" description={`尚未配置${projectLabel(project)}的专项细分项目与标杆成绩。`} />
        : <div className="champion-table-scroll">
          <table className="champion-model-table">
            <thead>
              <tr>
                <th scope="col">项目</th>
                <th scope="col">国家</th>
                <th scope="col">最好成绩</th>
                <th scope="col">配速</th>
                <th scope="col">赛事</th>
                <th scope="col">比赛地点</th>
              </tr>
            </thead>

            <tbody>
              {events.map((event) => (
                <tr key={event.eventCode}>
                  <th scope="row">{event.eventName}</th>
                  <td>{event.country || '待核实'}</td>
                  <td>{event.bestPerformance || '待核实'}</td>
                  <td>{event.pace || '待核实'}</td>
                  <td>{event.competition || '待核实'}</td>
                  <td>{event.location || '待核实'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>;
  const maleTableRows = useMemo(() => {
    if (!maleModel) return [];

    const grouped = new Map<number, Record<string, string>>();

    for (const row of maleModel.rows) {
      const current = grouped.get(row.bodyWeightKg) || {};

      current[row.levelCode] = row.standardValue;

      grouped.set(row.bodyWeightKg, current);
    }

    return [...grouped.entries()].map(([bodyWeightKg, values]) => ({
      bodyWeightKg,
      values
    }));
  }, [maleModel]);
  const femaleTableRows = useMemo(() => {
    if (!femaleModel) return [];

    const grouped = new Map<number, Record<string, string>>();

    for (const row of femaleModel.rows) {
      const current = grouped.get(row.bodyWeightKg) || {};

      current[row.levelCode] = row.standardValue;

      grouped.set(row.bodyWeightKg, current);
    }

    return [...grouped.entries()].map(([bodyWeightKg, values]) => ({
      bodyWeightKg,
      values
    }));
  }, [femaleModel]);

  function ErgometerChampionTable({
    rows,
    testType
  }: {
    rows: {
      bodyWeightKg: number;
      values: Record<string, string>;
    }[];
    testType: ErgometerTestType;
  }) {
    return (
      <div className="champion-table-scroll">
        <table className="champion-model-table">
          <thead>
            <tr>
              <th scope="col">体重</th>
              {ERGOMETER_LEVELS.map((level) => (
                <th scope="col" key={level.code}>{level.label}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.bodyWeightKg}>
                <th scope="row">{row.bodyWeightKg}kg</th>
                {ERGOMETER_LEVELS.map((level) => (
                  <td key={level.code}>{normalizeErgometerValue(row.values[level.code], testType)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }



  return <AppCard variant="chart" className="professional-panel special-champion-model">
    <div className="champion-model-head">
      <SectionHeader
        title="冠军模型"
        description={`${projectLabel(project)}专项标杆、测功仪分级与配速口径统一展示`}
        icon={<Trophy size={17} />}
      />
    </div>
    <div className="champion-model-section">
      <div className="champion-model-section-title">
        <strong>专项小项标杆</strong>
        <span>最好成绩、配速与赛事来源</span>
      </div>
      {content}
    </div>
    <div className="ergometer-model-grid">
      <section className="ergometer-model-card">
        <div className="ergometer-model-head">
          <div>
            <strong>男子测功仪模型</strong>
            <span>{ergometerValueLabel(maleTestType)}</span>
          </div>
          <ErgometerTabs
            value={maleTestType}
            onChange={setMaleTestType}
          />
        </div>
        <ErgometerChampionTable rows={maleTableRows} testType={maleTestType} />
      </section>
      <section className="ergometer-model-card">
        <div className="ergometer-model-head">
          <div>
            <strong>女子测功仪模型</strong>
            <span>{ergometerValueLabel(femaleTestType)}</span>
          </div>
          <ErgometerTabs
            value={femaleTestType}
            onChange={setFemaleTestType}
          />
        </div>
        <ErgometerChampionTable rows={femaleTableRows} testType={femaleTestType} />
      </section>
    </div>

  </AppCard>;
}
