import { LoadingOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Progress, Space, Typography } from 'antd';
import type { SearchResult, SourceId } from '../../../shared/types';
import type { SearchPhase, SourceProgress } from '../lib/hooks';
import { SOURCE_LABELS } from '../lib/records';

/** Hiển thị tiến độ theo từng nguồn trong lúc đang tìm kiếm / tải thêm kết quả. */
export function SearchProgress({ sources, progress }: { sources: SourceId[]; progress: Partial<Record<SourceId, SourceProgress>> }) {
  return (
    <section className="pf-panel" aria-live="polite" aria-label="Tiến độ tìm kiếm">
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Typography.Text strong>
          <LoadingOutlined /> Đang tìm kiếm và tải kết quả...
        </Typography.Text>
        {sources.map((source) => {
          const p = progress[source];
          const percent = p && p.target > 0 ? Math.round((p.fetched / p.target) * 100) : 0;
          return (
            <div key={source}>
              <Typography.Text>
                {SOURCE_LABELS[source]}
                {p ? (
                  <Typography.Text type="secondary">
                    {' '}
                    — “{p.keyword}”: {p.fetched}/{p.target || '?'} bài
                  </Typography.Text>
                ) : (
                  <Typography.Text type="secondary"> — đang chờ phản hồi...</Typography.Text>
                )}
              </Typography.Text>
              <Progress percent={percent} status={p ? 'active' : 'normal'} showInfo={Boolean(p)} />
            </div>
          );
        })}
        <Typography.Text type="secondary">Có thể bấm “Hủy tìm kiếm” bất cứ lúc nào.</Typography.Text>
      </Space>
    </section>
  );
}

/** Cảnh báo theo từng nguồn: một nguồn lỗi nhưng nguồn còn lại vẫn hoạt động. */
export function SourceAlerts({ result }: { result: SearchResult }) {
  const problems = result.sources.filter((s) => s.state !== 'ok');
  if (problems.length === 0) return null;
  const allFailed = result.sources.every((s) => s.state === 'error');
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {problems.map((source) => {
        const messages = [...new Set(source.errors.map((e) => e.message))];
        const failedKeywords = source.errors.map((e) => e.keyword);
        return (
          <Alert
            key={source.source}
            type={source.state === 'error' ? 'error' : 'warning'}
            showIcon
            message={
              source.state === 'error'
                ? `${source.label}: không lấy được dữ liệu${allFailed ? '' : ' — kết quả bên dưới chỉ đến từ các nguồn còn lại'}`
                : `${source.label}: chỉ lấy được một phần dữ liệu`
            }
            description={
              <>
                {messages.map((m) => (
                  <div key={m}>{m}</div>
                ))}
                {result.request.keywords.length > 1 && failedKeywords.length > 0 && (
                  <div>Từ khóa bị ảnh hưởng: {[...new Set(failedKeywords)].join('; ')}</div>
                )}
              </>
            }
          />
        );
      })}
    </Space>
  );
}

export function EmptyState({ phase, error, hasResult, onRetry }: { phase: SearchPhase; error: string | null; hasResult: boolean; onRetry?: () => void }) {
  if (phase === 'failed') {
    return (
      <Alert
        type="error"
        showIcon
        message="Không thực hiện được tìm kiếm"
        description={error ?? 'Đã xảy ra lỗi không xác định.'}
        action={onRetry ? <Button onClick={onRetry}>Thử lại</Button> : undefined}
      />
    );
  }
  if (phase === 'cancelled') {
    return <Alert type="info" showIcon message="Đã hủy tìm kiếm." description="Bạn có thể chỉnh từ khóa hoặc bộ lọc rồi tìm lại." />;
  }
  if (phase === 'idle' && !hasResult) {
    return (
      <section className="pf-panel">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Nhập từ khóa nghiên cứu và bấm “Tìm bài báo”. Kết quả lấy trực tiếp từ các nguồn học thuật bạn chọn."
        />
      </section>
    );
  }
  return null;
}

export function NoResults({ result }: { result: SearchResult }) {
  const allFailed = result.sources.every((s) => s.state === 'error');
  if (allFailed) return null; // đã có cảnh báo lỗi riêng cho từng nguồn
  return (
    <section className="pf-panel">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <span>
            Không tìm thấy bài báo phù hợp.
            <br />
            Thử từ khóa tổng quát hơn, mở rộng khoảng năm, bỏ chọn “Chỉ lấy bài có DOI” hoặc dùng thêm nguồn dữ liệu.
          </span>
        }
      />
    </section>
  );
}
