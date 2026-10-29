import { ArrowLeftOutlined, CheckCircleFilled, CopyOutlined, LoadingOutlined } from '@ant-design/icons';
import { Alert, Button, Typography, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { CheckoutResponse } from '../../../shared/types';
import { confirmPayment } from '../lib/api';

const POLL_MS = 4000;
const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(n);

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function CopyRow({ label, value, shown, onCopy }: { label: string; value: string; shown?: string; onCopy: (value: string) => void }) {
  return (
    <div className="pf-pay-row">
      <span className="pf-pay-label">{label}</span>
      <span className="pf-pay-value">{shown ?? value}</span>
      <Button size="small" type="text" icon={<CopyOutlined />} aria-label={`Sao chép ${label.toLowerCase()}`} onClick={() => onCopy(value)} />
    </div>
  );
}

interface Props {
  order: CheckoutResponse;
  /** Mô tả gói đang mua, vd. "Pro · 1 tháng". */
  planLabel: string;
  onBack: () => void;
  onPaid: () => void;
  onClose: () => void;
}

/** Bước thanh toán bằng chuyển khoản: mã QR VietQR kèm thông tin để chuyển tay, tự kiểm tra trạng thái đơn mỗi vài giây. */
export function PaymentStep({ order, planLabel, onBack, onPaid, onClose }: Props) {
  const [messageApi, holder] = message.useMessage();
  const [now, setNow] = useState(() => Date.now());
  const [paid, setPaid] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [closedByServer, setClosedByServer] = useState(false);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  const expiresAt = new Date(order.expiresAt).getTime();
  const remaining = expiresAt - now;
  const expired = remaining <= 0 || closedByServer;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (paid) return;
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const result = await confirmPayment(order.orderCode);
        if (stopped) return;
        if (result.status === 'paid') {
          setPaid(true);
          onPaidRef.current();
          return;
        }
        if (result.status === 'cancelled' || result.status === 'unknown') {
          setClosedByServer(true);
          return;
        }
        setProblem(null);
      } catch {
        if (!stopped) setProblem('Chưa kiểm tra được trạng thái thanh toán (lỗi kết nối). Hệ thống sẽ thử lại.');
      }
      if (!stopped) timer = window.setTimeout(() => void tick(), POLL_MS);
    };
    timer = window.setTimeout(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [order.orderCode, paid]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      void messageApi.success('Đã sao chép', 1.2);
    } catch {
      void messageApi.warning('Trình duyệt không cho sao chép tự động, hãy chép tay.', 2.5);
    }
  };

  if (paid) {
    return (
      <div className="pf-pay-done">
        <CheckCircleFilled className="pf-pay-done-icon" />
        <Typography.Title level={4} style={{ margin: '8px 0 4px' }}>
          Thanh toán thành công
        </Typography.Title>
        <Typography.Paragraph type="secondary">Gói {planLabel} đã được kích hoạt cho tài khoản của bạn. Cảm ơn bạn đã ủng hộ PaperFinder!</Typography.Paragraph>
        <Button type="primary" onClick={onClose}>
          Bắt đầu dùng
        </Button>
      </div>
    );
  }

  return (
    <div className="pf-pay">
      {holder}
      <Button type="link" icon={<ArrowLeftOutlined />} onClick={onBack} style={{ padding: 0 }}>
        Chọn gói khác
      </Button>
      <Typography.Title level={4} style={{ margin: '4px 0 2px' }}>
        Thanh toán gói {planLabel}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        Mở ứng dụng ngân hàng, quét mã QR bên dưới. Số tiền và nội dung đã được điền sẵn; giữ nguyên nội dung để hệ thống tự nhận ra khoản chuyển.
      </Typography.Paragraph>

      <div className="pf-pay-body">
        <div className={`pf-pay-qr${expired ? ' is-expired' : ''}`}>
          {qrFailed ? (
            <div className="pf-pay-qr-fallback">Không tải được mã QR. Hãy chuyển khoản tay theo thông tin bên cạnh.</div>
          ) : (
            <img src={order.qrUrl} alt={`Mã QR chuyển khoản ${fmt(order.amount)} đồng, nội dung ${order.memo}`} width={240} height={240} onError={() => setQrFailed(true)} />
          )}
        </div>

        <div className="pf-pay-info">
          <CopyRow label="Ngân hàng" value={order.bankName} onCopy={copy} />
          <CopyRow label="Số tài khoản" value={order.accountNumber} onCopy={copy} />
          {order.accountName && <CopyRow label="Chủ tài khoản" value={order.accountName} onCopy={copy} />}
          <CopyRow label="Số tiền" value={String(order.amount)} shown={`${fmt(order.amount)}đ`} onCopy={copy} />
          <CopyRow label="Nội dung" value={order.memo} onCopy={copy} />
          <Alert type="warning" showIcon style={{ marginTop: 10 }} title={`Nội dung chuyển khoản phải đúng “${order.memo}” và số tiền không thấp hơn ${fmt(order.amount)}đ, nếu không hệ thống sẽ không tự kích hoạt được.`} />
        </div>
      </div>

      <div className="pf-pay-status" role="status" aria-live="polite">
        {expired ? (
          <Alert
            type="error"
            showIcon
            title="Đơn đã hết hạn"
            description="Nếu bạn đã chuyển khoản, gói vẫn sẽ được kích hoạt khi tiền về; hãy tải lại trang sau ít phút. Nếu chưa, hãy chọn gói và tạo đơn mới."
          />
        ) : (
          <>
            <LoadingOutlined /> Đang chờ nhận tiền... đơn còn hiệu lực <b>{clock(remaining)}</b>. Trang tự cập nhật, không cần bấm gì thêm.
          </>
        )}
        {problem && !expired && <div className="pf-pay-problem">{problem}</div>}
      </div>
    </div>
  );
}
