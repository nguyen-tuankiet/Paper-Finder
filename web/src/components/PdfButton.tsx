import { DownloadOutlined } from '@ant-design/icons';
import { Button, message } from 'antd';
import { useState } from 'react';
import type { PaperRecord } from '../../../shared/types';
import { downloadPdf } from '../lib/api';

/**
 * Nút "Tải PDF": tải file về máy qua máy chủ PaperFinder. Nếu không tải trực tiếp được (link hỏng,
 * trang yêu cầu đăng nhập...) thì báo lý do và đưa link gốc để mở thủ công.
 */
export function PdfButton({ record, size = 'small', ghost = true }: { record: PaperRecord; size?: 'small' | 'middle'; ghost?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [api, holder] = message.useMessage();

  const onClick = async () => {
    // Kết quả cũ không có chữ ký: mở link gốc như trước.
    if (!record.oaPdfSig) {
      window.open(record.oaPdfUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    setLoading(true);
    try {
      await downloadPdf(record);
      void api.success('Đã tải PDF về máy.');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Không tải được file.';
      // Phương án dự phòng: mở link gốc ở tab mới để khách tự lưu từ trình xem PDF (có thể bị chặn popup, nên vẫn kèm link bấm tay).
      window.open(record.oaPdfUrl, '_blank', 'noopener,noreferrer');
      void api.warning({
        duration: 12,
        content: (
          <span>
            {reason} Đã thử mở link gốc ở tab mới; nếu không thấy,{' '}
            <a href={record.oaPdfUrl} target="_blank" rel="noopener noreferrer">
              bấm vào đây
            </a>
            .
          </span>
        ),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {holder}
      <Button size={size} type="primary" ghost={ghost} icon={<DownloadOutlined />} loading={loading} onClick={() => void onClick()}>
        Tải PDF
      </Button>
    </>
  );
}
