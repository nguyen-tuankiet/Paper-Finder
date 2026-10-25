import { LogoutOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Segmented, Space, Table, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import type { UsageDay, UsageReport, UsageSourceRow } from '../../shared/types';
import { UsageChart } from './components/UsageChart';
import { ApiError, fetchUsageReport } from './lib/api';

const STORAGE_KEY = 'pf_admin_password';

// Mật khẩu chỉ giữ trong phiên trình duyệt (đóng tab là mất), không lưu lâu dài.
const store = {
  get: () => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  },
  set: (value: string) => {
    try {
      if (value) sessionStorage.setItem(STORAGE_KEY, value);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* trình duyệt chặn lưu trữ: bỏ qua */
    }
  },
};

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sai mật khẩu quản trị.';
    if (error.status === 404) return 'Trang quản trị chưa được bật trên máy chủ (chưa đặt biến ADMIN_PASSWORD).';
    if (error.status === 429) return 'Nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.';
    return error.message;
  }
  return 'Đã xảy ra lỗi không xác định.';
}

function LoginForm({ onLogin }: { onLogin: (password: string) => Promise<string | null> }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!password) return;
    setBusy(true);
    setError(await onLogin(password));
    setBusy(false);
  };

  return (
    <section className="pf-panel" style={{ maxWidth: 420, margin: '40px auto', width: '100%' }}>
      <h2 className="pf-panel-title">Đăng nhập quản trị</h2>
      <Form layout="vertical" onFinish={() => void submit()}>
        <Form.Item label="Mật khẩu quản trị" validateStatus={error ? 'error' : undefined} help={error ?? undefined}>
          <Input.Password autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={busy} disabled={!password} block>
          Đăng nhập
        </Button>
      </Form>
    </section>
  );
}

const dayColumns = [
  { title: 'Ngày', dataIndex: 'date', key: 'date' },
  { title: 'Người dùng', dataIndex: 'visitors', key: 'visitors', align: 'right' as const },
  { title: 'Lượt tìm', dataIndex: 'searches', key: 'searches', align: 'right' as const },
  { title: 'Thành công', dataIndex: 'searchesCompleted', key: 'ok', align: 'right' as const },
  { title: 'Lỗi', dataIndex: 'searchesFailed', key: 'failed', align: 'right' as const },
  { title: 'Đã hủy', dataIndex: 'searchesCancelled', key: 'cancelled', align: 'right' as const },
  { title: 'Xuất file', dataIndex: 'exports', key: 'exports', align: 'right' as const },
  { title: 'Bài trả về', dataIndex: 'results', key: 'results', align: 'right' as const },
];

const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');
const fmt = new Intl.NumberFormat('vi-VN');

function Dashboard({ password, onLogout }: { password: string; onLogout: () => void }) {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await fetchUsageReport(password, days));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onLogout();
        return;
      }
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [password, days, onLogout]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const summary = report
    ? [
        { key: 'today', label: 'Hôm nay', ...report.today },
        { key: '7', label: '7 ngày gần nhất', ...report.last7Days },
        { key: '30', label: '30 ngày gần nhất', ...report.last30Days },
        { key: 'all', label: `Toàn bộ dữ liệu đang lưu`, ...report.allTime },
      ]
    : [];

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Thống kê sử dụng
        </Typography.Title>
        <Space wrap>
          <Segmented value={days} onChange={(v) => setDays(Number(v))} options={[{ label: '7 ngày', value: 7 }, { label: '30 ngày', value: 30 }, { label: '90 ngày', value: 90 }]} />
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
            Làm mới
          </Button>
          <Button icon={<LogoutOutlined />} onClick={onLogout}>
            Đăng xuất
          </Button>
        </Space>
      </div>

      {error && <Alert type="error" showIcon message={error} />}

      {report && (
        <>
          <Alert
            type={report.persistent ? 'info' : 'warning'}
            showIcon
            message={
              report.persistent
                ? 'Thống kê được ghi vào file trên máy chủ. Nếu máy chủ dùng ổ đĩa tạm (ví dụ Render gói Free), số liệu sẽ mất khi khởi động lại hoặc deploy lại.'
                : 'Thống kê chỉ lưu trong bộ nhớ và sẽ mất khi máy chủ khởi động lại.'
            }
          />

          <section className="pf-panel pf-stats" aria-label="Tổng quan">
            <div className="pf-stat">
              <div className="pf-stat-label">Người dùng hôm nay</div>
              <div className="pf-stat-value">{fmt.format(report.today.visitors)}</div>
            </div>
            <div className="pf-stat">
              <div className="pf-stat-label">Lượt tìm hôm nay</div>
              <div className="pf-stat-value">{fmt.format(report.today.searches)}</div>
            </div>
            <div className="pf-stat">
              <div className="pf-stat-label">Tổng người dùng</div>
              <div className="pf-stat-value">{fmt.format(report.allTime.visitors)}</div>
            </div>
            <div className="pf-stat">
              <div className="pf-stat-label">Tổng lượt tìm</div>
              <div className="pf-stat-value">{fmt.format(report.allTime.searches)}</div>
            </div>
            <div className="pf-stat">
              <div className="pf-stat-label">Tổng lượt xuất file</div>
              <div className="pf-stat-value">{fmt.format(report.allTime.exports)}</div>
            </div>
            <div className="pf-stat">
              <div className="pf-stat-label">Bài trung bình mỗi lượt tìm</div>
              <div className="pf-stat-value">{fmt.format(report.allTime.averageResultsPerSearch)}</div>
            </div>
          </section>

          <section className="pf-panel">
            <h2 className="pf-panel-title">
              Theo thời gian <small>{report.daily.length} ngày gần nhất (múi giờ {report.timezone})</small>
            </h2>
            <UsageChart days={report.daily} />
          </section>

          <section className="pf-panel">
            <h2 className="pf-panel-title">Tổng hợp</h2>
            <Table
              size="small"
              pagination={false}
              rowKey="key"
              dataSource={summary}
              scroll={{ x: 520 }}
              columns={[
                { title: 'Khoảng thời gian', dataIndex: 'label', key: 'label' },
                { title: 'Người dùng', dataIndex: 'visitors', key: 'visitors', align: 'right' },
                { title: 'Lượt tìm', dataIndex: 'searches', key: 'searches', align: 'right' },
                { title: 'Lượt xuất file', dataIndex: 'exports', key: 'exports', align: 'right' },
              ]}
            />
            <Typography.Paragraph type="secondary" style={{ margin: '12px 0 0', fontSize: 12.5 }}>
              Tìm kiếm thành công/lỗi/hủy toàn bộ: {report.allTime.completed} / {report.allTime.failed} / {report.allTime.cancelled}.
            </Typography.Paragraph>
          </section>

          <section className="pf-panel">
            <h2 className="pf-panel-title">Theo nguồn dữ liệu</h2>
            <Table<UsageSourceRow>
              size="small"
              pagination={false}
              rowKey="source"
              dataSource={report.sources}
              locale={{ emptyText: 'Chưa có lượt tìm nào.' }}
              scroll={{ x: 520 }}
              columns={[
                { title: 'Nguồn', dataIndex: 'label', key: 'label' },
                { title: 'Số lần được chọn', dataIndex: 'used', key: 'used', align: 'right' },
                { title: 'Lỗi hoàn toàn', dataIndex: 'failed', key: 'failed', align: 'right' },
                { title: 'Lấy được một phần', dataIndex: 'partial', key: 'partial', align: 'right' },
                { title: 'Tỷ lệ lỗi', key: 'rate', align: 'right', render: (_v, row) => percent(row.failed, row.used) },
              ]}
            />
          </section>

          <section className="pf-panel">
            <h2 className="pf-panel-title">Chi tiết theo ngày</h2>
            <Table<UsageDay>
              size="small"
              rowKey="date"
              dataSource={[...report.daily].reverse()}
              columns={dayColumns}
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              scroll={{ x: 640 }}
            />
          </section>

          <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
            “Người dùng” là số thiết bị/mạng khác nhau (mã băm một chiều của địa chỉ IP và trình duyệt); một người dùng nhiều thiết bị hoặc nhiều người chung một mạng có thể bị đếm lệch. Hệ thống không lưu địa chỉ IP, từ khóa hay nội dung tìm kiếm. Bắt đầu ghi từ {new Date(report.trackingSince).toLocaleString('vi-VN')}; cập nhật lúc {new Date(report.generatedAt).toLocaleTimeString('vi-VN')}; giữ tối đa {report.retentionDays} ngày.
          </Typography.Paragraph>
        </>
      )}
    </>
  );
}

export default function AdminPage() {
  const [password, setPassword] = useState(store.get());

  const login = async (candidate: string): Promise<string | null> => {
    try {
      await fetchUsageReport(candidate, 7);
      store.set(candidate);
      setPassword(candidate);
      return null;
    } catch (e) {
      return errorText(e);
    }
  };

  const logout = useCallback(() => {
    store.set('');
    setPassword('');
  }, []);

  return (
    <div className="pf-app">
      <header className="pf-header">
        <div className="pf-header-inner">
          <div className="pf-brand">
            <div>
              <Typography.Title level={3} className="pf-brand-title">
                PaperFinder · Quản trị
              </Typography.Title>
              <span className="pf-brand-sub">Thống kê sử dụng</span>
            </div>
          </div>
          <a href="/" style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>
            ← Về trang tìm kiếm
          </a>
        </div>
      </header>
      <main className="pf-main">{password ? <Dashboard password={password} onLogout={logout} /> : <LoginForm onLogin={login} />}</main>
    </div>
  );
}
