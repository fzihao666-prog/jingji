import { Activity, ClipboardList, FlaskConical, TrendingUp } from 'lucide-react';
import { ChartCard, ContentState, PageContainer, PageHeader } from '../components/PageLayout';
import type { Project } from '../types';
import './SpecialTrainingPage.css';

type Props = {
  project: Project;
  from: string;
  to: string;
};

export function PhysiologyBiochemistryPage({ project, from, to }: Props) {
  return <PageContainer className="professional-overview training-dashboard-page">
    <PageHeader
      variant="dashboard"
      className="overview-page-heading"
      eyebrow="PHYSIOLOGY & BIOCHEMISTRY"
      title="生理生化"
    />
    <section className="training-dashboard-grid" aria-label="生理生化数据展示区域">
      <ChartCard title="生理生化整体概览" description={`${project} · 当前组织范围 · ${from} 至 ${to}`} className="dashboard-span-12">
        <ContentState kind="empty" icon={<Activity size={28} />} title="暂无生理生化数据" description="接入经确认的生理、生化数据模型后，将在此展示当前项目、组织范围和时间范围的整体概览。" />
      </ChartCard>
      <ChartCard title="核心数据展示" description="待根据真实数据字段配置展示内容" className="dashboard-span-5">
        <ContentState kind="empty" icon={<FlaskConical size={26} />} title="核心指标待配置" description="当前未预设指标、单位、正常范围或评价规则。" />
      </ChartCard>
      <ChartCard title="趋势与分析" description="待具备连续、可追溯的真实记录后启用" className="dashboard-span-7">
        <ContentState kind="empty" icon={<TrendingUp size={26} />} title="暂无趋势数据" description="数据模型和采集频率确认后，将按实际业务需求配置趋势与分析方式。" />
      </ChartCard>
      <ChartCard title="重点信息与记录" description="用于承载后续的重点记录和下钻入口" className="dashboard-span-12">
        <ContentState kind="empty" icon={<ClipboardList size={26} />} title="暂无重点记录" description="后续可在保留整体展示的基础上，提供运动员个人数据下钻。" />
      </ChartCard>
    </section>
  </PageContainer>;
}
