import './IcpFooter.css';

const WEBSITE_FILING = {
  number: '京ICP备2026066298号-1',
  queryUrl: 'https://beian.miit.gov.cn/',
};

export function IcpFooter() {
  return (
    <footer className="icp-footer">
      <a href={WEBSITE_FILING.queryUrl} target="_blank" rel="noopener noreferrer">
        {WEBSITE_FILING.number}
      </a>
    </footer>
  );
}
