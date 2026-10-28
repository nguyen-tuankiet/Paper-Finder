import { CrownFilled, FileExcelOutlined, FileTextOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Radio, Space, Tag, Typography, message } from 'antd';
import { useMemo, useState } from 'react';
import type { ExportFormat, PaperRecord } from '../../../shared/types';
import { useAccount } from '../lib/accountContext';
import { ApiError, exportRecords } from '../lib/api';
import { exportFileName } from '../lib/records';
import { Panel } from './Panel';

type Scope = 'filtered' | 'selected' | 'all';

interface Props {
  allRecords: PaperRecord[];
  filtered: PaperRecord[];
  selectedIds: Set<string>;
  online: boolean;
}

export function ExportPanel({ allRecords, filtered, selectedIds, online }: Props) {
  const [scope, setScope] = useState<Scope>('filtered');
  const [onlyDoi, setOnlyDoi] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const account = useAccount();
  /** Khi tài khoản được bật, BibTeX/RIS chỉ dành cho gói Pro. */
  const proLocked = account.enabled && !account.isPro;

  const selected = useMemo(() => allRecords.filter((r) => selectedIds.has(r.id)), [allRecords, selectedIds]);
  const base = scope === 'all' ? allRecords : scope === 'selected' ? selected : filtered;
  const toExport = useMemo(() => (onlyDoi ? base.filter((r) => r.doi) : base), [base, onlyDoi]);
  const withoutDoiCount = base.length - base.filter((r) => r.doi).length;

  const run = async (format: ExportFormat) => {
    if (proLocked && (format === 'bibtex' || format === 'ris')) {
      if (account.user) account.openUpgrade('Xuất BibTeX/RIS (cho Zotero, Mendeley, EndNote) dành cho gói Pro.');
      else account.openAuth('register');
      return;
    }
    setBusy(format);
    const fileName = exportFileName(format);
    try {
      await exportRecords(format, toExport, fileName);
      void messageApi.success(`Đã xuất ${toExport.length} bài vào file ${fileName}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'pro_required') account.openUpgrade(error.message);
      else if (error instanceof ApiError && error.code === 'unauthorized') account.openAuth('login');
      else void messageApi.error(error instanceof Error ? `Xuất file thất bại: ${error.message}` : 'Xuất file thất bại.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Xuất danh sách" extra="Excel, CSV, BibTeX hoặc RIS, đầy đủ mọi dòng" aria-label="Xuất dữ liệu">
      {contextHolder}
      <Space orientation="vertical" size="small" style={{ width: '100%' }}>
        <Space size="large" wrap align="center">
          <Radio.Group value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
            <Radio value="filtered">Kết quả đang lọc ({filtered.length})</Radio>
            <Radio value="selected">Bài đã chọn ({selected.length})</Radio>
            <Radio value="all">Tất cả ({allRecords.length})</Radio>
          </Radio.Group>
          <Checkbox checked={onlyDoi} onChange={(e) => setOnlyDoi(e.target.checked)}>
            Chỉ xuất bài có DOI
          </Checkbox>
        </Space>
        <Space wrap>
          <Button type="primary" icon={<FileExcelOutlined />} loading={busy === 'xlsx'} disabled={toExport.length === 0 || busy !== null || !online} onClick={() => void run('xlsx')}>
            Xuất Excel (.xlsx)
          </Button>
          <Button icon={<FileTextOutlined />} loading={busy === 'csv'} disabled={toExport.length === 0 || busy !== null || !online} onClick={() => void run('csv')}>
            Xuất CSV
          </Button>
          {(['bibtex', 'ris'] as const).map((format) => (
            <Button
              key={format}
              icon={<FileTextOutlined />}
              loading={busy === format}
              disabled={toExport.length === 0 || busy !== null || !online}
              onClick={() => void run(format)}
              title={proLocked ? 'Tính năng gói Pro' : undefined}
            >
              {format === 'bibtex' ? 'BibTeX' : 'RIS'}
              {proLocked && (
                <Tag color="gold" icon={<CrownFilled />} style={{ marginInlineStart: 6, marginInlineEnd: 0 }}>
                  Pro
                </Tag>
              )}
            </Button>
          ))}
          <Typography.Text type="secondary">
            Sẽ xuất <b>{toExport.length}</b> bài (toàn bộ, không chỉ trang đang xem).
          </Typography.Text>
        </Space>
        {!onlyDoi && withoutDoiCount > 0 && toExport.length > 0 && (
          <Typography.Text type="secondary">Trong đó có {withoutDoiCount} bài chưa có DOI; tick “Chỉ xuất bài có DOI” để loại các bài này.</Typography.Text>
        )}
        {scope === 'selected' && selected.length === 0 && <Alert type="info" showIcon title="Chưa chọn bài nào. Tick các dòng trong bảng để chọn bài cần xuất." />}
      </Space>
    </Panel>
  );
}
