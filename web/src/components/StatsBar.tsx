import { ApiOutlined, CopyOutlined, FileSearchOutlined, LinkOutlined, QuestionCircleOutlined, UnlockOutlined, WarningOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import type { SearchStats } from '../../../shared/types';
import { Panel } from './Panel';
import { StatGrid, type StatItem } from './StatGrid';

interface Props {
  stats: SearchStats;
  suspectedCount: number;
  /** Số bài có bản đọc miễn phí (truy cập mở). */
  freeCount: number;
  onShowSuspected: () => void;
}

export function StatsBar({ stats, suspectedCount, freeCount, onShowSuspected }: Props) {
  const items: StatItem[] = [
    { key: 'total', label: 'Tổng số kết quả', value: stats.total, icon: <FileSearchOutlined /> },
    { key: 'doi', label: 'Có DOI', value: stats.withDoi, icon: <LinkOutlined /> },
    { key: 'nodoi', label: 'Chưa có DOI', value: stats.withoutDoi, icon: <QuestionCircleOutlined /> },
    { key: 'free', label: 'Có bản miễn phí', value: freeCount, icon: <UnlockOutlined />, tone: 'success' },
    { key: 'dups', label: 'Trùng đã loại bỏ', value: stats.duplicatesRemoved, icon: <CopyOutlined /> },
    { key: 'sources', label: 'Nguồn thành công', value: `${stats.sourcesSucceeded}/${stats.sourcesQueried}`, icon: <ApiOutlined /> },
  ];
  if (suspectedCount > 0) {
    items.push({
      key: 'suspected',
      label: 'Nghi trùng cần xem',
      value: suspectedCount,
      icon: <WarningOutlined />,
      tone: 'warning',
      extra: (
        <Button type="link" size="small" onClick={onShowSuspected} aria-label="Xem và xử lý các bài nghi trùng">
          Xử lý
        </Button>
      ),
    });
  }

  return (
    <Panel aria-label="Thống kê kết quả">
      <StatGrid items={items} />
    </Panel>
  );
}
