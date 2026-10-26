import { Button } from 'antd';
import type { SearchStats } from '../../../shared/types';

interface Props {
  stats: SearchStats;
  suspectedCount: number;
  /** Số bài có bản đọc miễn phí (truy cập mở). */
  freeCount: number;
  onShowSuspected: () => void;
}

function Stat({ label, value, warn, children }: { label: string; value: string | number; warn?: boolean; children?: React.ReactNode }) {
  return (
    <div className={warn ? 'pf-stat pf-stat-warn' : 'pf-stat'}>
      <div className="pf-stat-label">{label}</div>
      <div className="pf-stat-value">{value}</div>
      {children}
    </div>
  );
}

export function StatsBar({ stats, suspectedCount, freeCount, onShowSuspected }: Props) {
  return (
    <section className="pf-panel pf-stats" aria-label="Thống kê kết quả">
      <Stat label="Tổng số kết quả" value={stats.total} />
      <Stat label="Có DOI" value={stats.withDoi} />
      <Stat label="Chưa có DOI" value={stats.withoutDoi} />
      <Stat label="Có bản miễn phí" value={freeCount} />
      <Stat label="Bài trùng đã loại bỏ" value={stats.duplicatesRemoved} />
      <Stat label="Nguồn truy vấn thành công" value={`${stats.sourcesSucceeded}/${stats.sourcesQueried}`} />
      {suspectedCount > 0 && (
        <Stat label="Nghi trùng cần xem" value={suspectedCount} warn>
          <Button type="link" size="small" onClick={onShowSuspected}>
            Xem và xử lý
          </Button>
        </Stat>
      )}
    </section>
  );
}
