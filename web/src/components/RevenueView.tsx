import { CrownFilled, DollarOutlined, RiseOutlined, ShoppingCartOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons';
import { Table, Tag, Typography } from 'antd';
import type { AdminOrder, PlanPeriod, RevenuePlanRow, RevenueReport } from '../../../shared/types';
import { Panel } from './Panel';
import { RevenueChart } from './RevenueChart';
import { StatGrid } from './StatGrid';

const fmt = new Intl.NumberFormat('vi-VN');
const money = (value: number) => `${fmt.format(value)}đ`;
const TIER_LABEL = { standard: 'Tiêu chuẩn', pro: 'Pro' } as const;
const PERIOD_LABEL: Record<PlanPeriod, string> = { week: '7 ngày', month: '1 tháng', year: '1 năm' };
const ORDER_TTL_MS = 24 * 3_600_000;

/** Nhãn trạng thái đơn: đơn chưa trả quá 24 giờ coi là bỏ dở (khớp thời hạn hiển thị đơn trên máy chủ). */
function OrderStatusTag({ order, now }: { order: AdminOrder; now: number }) {
  if (order.status === 'paid') return <Tag color="green">Đã thanh toán</Tag>;
  if (order.status === 'pending' && now - new Date(order.createdAt).getTime() <= ORDER_TTL_MS) return <Tag color="blue">Chờ thanh toán</Tag>;
  return <Tag>Bỏ dở</Tag>;
}

function planLabel(plan: string): string {
  const [tier, period] = plan.split(':');
  const t = TIER_LABEL[tier as keyof typeof TIER_LABEL];
  const p = PERIOD_LABEL[period as PlanPeriod];
  return t && p ? `${t} · ${p}` : plan;
}

export function RevenueView({ report }: { report: RevenueReport }) {
  const now = new Date(report.generatedAt).getTime();
  const share = (value: number) => (report.allTime.revenueVnd > 0 ? `${Math.round((value / report.allTime.revenueVnd) * 100)}%` : '—');
  const paidRate = report.funnel.created > 0 ? `${Math.round((report.funnel.paid / report.funnel.created) * 100)}%` : '—';

  return (
    <>
      <Panel aria-label="Doanh thu tổng quan">
        <StatGrid
          items={[
            { key: 'today', label: 'Doanh thu hôm nay', value: money(report.today.revenueVnd), icon: <DollarOutlined />, tone: 'success' },
            { key: '7', label: 'Doanh thu 7 ngày', value: money(report.last7Days.revenueVnd), icon: <DollarOutlined />, tone: 'success' },
            { key: 'month', label: 'Doanh thu tháng này', value: money(report.thisMonth.revenueVnd), icon: <DollarOutlined />, tone: 'success' },
            { key: '30', label: 'Doanh thu 30 ngày', value: money(report.last30Days.revenueVnd), icon: <DollarOutlined />, tone: 'success' },
            { key: 'all', label: 'Tổng doanh thu', value: money(report.allTime.revenueVnd), icon: <DollarOutlined />, tone: 'success' },
            { key: 'orders', label: 'Đơn đã thanh toán', value: fmt.format(report.allTime.orders), icon: <ShoppingCartOutlined /> },
            { key: 'avg', label: 'Giá trị trung bình mỗi đơn', value: money(report.averageOrderVnd), icon: <RiseOutlined /> },
            { key: 'orders-today', label: 'Đơn thanh toán hôm nay', value: fmt.format(report.today.orders), icon: <ShoppingCartOutlined /> },
          ]}
        />
      </Panel>

      <Panel title="Doanh thu theo ngày" extra={`${report.daily.length} ngày gần nhất (múi giờ ${report.timezone})`}>
        <RevenueChart days={report.daily} />
      </Panel>

      <Panel title="Khách hàng và chuyển đổi">
        <StatGrid
          items={[
            { key: 'users', label: 'Tổng tài khoản', value: fmt.format(report.users), icon: <TeamOutlined /> },
            { key: 'paying', label: 'Đã từng trả tiền', value: fmt.format(report.payingUsers), icon: <UserAddOutlined />, tone: 'success' },
            { key: 'conv', label: 'Tỷ lệ trả tiền / tài khoản', value: `${report.conversionPercent.toLocaleString('vi-VN')}%`, icon: <RiseOutlined /> },
            { key: 'repeat', label: 'Mua từ 2 lần trở lên', value: fmt.format(report.repeatBuyers), icon: <UserAddOutlined /> },
            { key: 'std', label: 'Đang dùng Tiêu chuẩn', value: fmt.format(report.activeStandard), icon: <CrownFilled /> },
            { key: 'pro', label: 'Đang dùng Pro', value: fmt.format(report.activePro), icon: <CrownFilled /> },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ margin: '12px 0 0', fontSize: 13 }}>
          30 ngày gần nhất: <b>{report.funnel.created}</b> đơn được tạo, <b>{report.funnel.paid}</b> đã thanh toán ({paidRate}), <b>{report.funnel.pending}</b> đang chờ (dưới 24 giờ), <b>{report.funnel.abandoned}</b> bỏ dở.
        </Typography.Paragraph>
      </Panel>

      <Panel title="Doanh thu theo gói">
        <Table<RevenuePlanRow>
          size="small"
          pagination={false}
          rowKey={(row) => `${row.tier}:${row.period}`}
          dataSource={report.byPlan}
          locale={{ emptyText: 'Chưa có đơn nào được thanh toán.' }}
          scroll={{ x: 520 }}
          columns={[
            { title: 'Hạng', key: 'tier', render: (_v, row) => TIER_LABEL[row.tier] },
            { title: 'Thời hạn', key: 'period', render: (_v, row) => PERIOD_LABEL[row.period] },
            { title: 'Số đơn', dataIndex: 'orders', key: 'orders', align: 'right' },
            { title: 'Doanh thu', key: 'revenue', align: 'right', render: (_v, row) => money(row.revenueVnd) },
            { title: 'Tỷ trọng', key: 'share', align: 'right', render: (_v, row) => share(row.revenueVnd) },
          ]}
        />
      </Panel>

      <Panel title="Đơn hàng gần đây" extra={`${report.recentOrders.length} đơn mới nhất`}>
        <Table<AdminOrder>
          size="small"
          rowKey="orderCode"
          dataSource={report.recentOrders}
          locale={{ emptyText: 'Chưa có đơn hàng nào.' }}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          scroll={{ x: 820 }}
          columns={[
            { title: 'Tạo lúc', key: 'createdAt', render: (_v, o) => new Date(o.createdAt).toLocaleString('vi-VN') },
            { title: 'Mã đơn', dataIndex: 'orderCode', key: 'orderCode' },
            { title: 'Email', key: 'email', render: (_v, o) => o.email ?? <Typography.Text type="secondary">(đã xóa)</Typography.Text> },
            { title: 'Gói', key: 'plan', render: (_v, o) => planLabel(o.plan) },
            { title: 'Số tiền', key: 'amount', align: 'right', render: (_v, o) => money(o.amount) },
            { title: 'Trạng thái', key: 'status', render: (_v, o) => <OrderStatusTag order={o} now={now} /> },
            { title: 'Mã giao dịch', key: 'ref', render: (_v, o) => o.paymentRef ?? '—' },
          ]}
        />
      </Panel>

      <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
        Doanh thu tính theo ngày thanh toán (múi giờ {report.timezone}) và chỉ gồm đơn mà SePay đã xác nhận tiền vào đúng số tiền. Gói cấp thủ công không tạo đơn nên không có trong số liệu này. Tiền chuyển sai nội dung hoặc thiếu tiền không khớp đơn nào; xem log <code>payment_needs_attention</code> trên máy chủ để đối soát.
      </Typography.Paragraph>
    </>
  );
}
