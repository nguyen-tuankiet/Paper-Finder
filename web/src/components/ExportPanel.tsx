import { CrownFilled, FileExcelOutlined, FileTextOutlined, FileWordOutlined, LockOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Radio, Space, Tag, Typography, message } from 'antd';
import { useMemo, useState } from 'react';
import type { ExportFormat, PaperRecord } from '../../../shared/types';
import { useAccount } from '../lib/accountContext';
import { ApiError, exportDocx, exportRecords } from '../lib/api';
import { formatReferenceList, type CitationStyle } from '../lib/citation';
import type { CustomCitationConfig } from '../lib/customCitation';
import { docxFileName, exportFileName } from '../lib/records';
import { Panel } from './Panel';

type Scope = 'filtered' | 'selected' | 'all';

interface Props {
  allRecords: PaperRecord[];
  filtered: PaperRecord[];
  selectedIds: Set<string>;
  online: boolean;
  /** Kiểu trích dẫn đang chọn, dùng để dựng file Word tài liệu tham khảo. */
  citationStyle: CitationStyle;
  customCitation: CustomCitationConfig;
}

export function ExportPanel({ allRecords, filtered, selectedIds, online, citationStyle, customCitation }: Props) {
  const [scope, setScope] = useState<Scope>('filtered');
  const [onlyDoi, setOnlyDoi] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | 'docx' | null>(null);
  const [messageApi, contextHolder] = message.useMessage();
  const account = useAccount();
  const { entitlements, user } = account;
  /** Khóa theo hạng chỉ có khi máy chủ bật tài khoản (tắt = mọi thứ mở như trước). */
  const gated = account.enabled;
  const needLogin = gated && entitlements.exportRows === 0;
  const referenceLocked = gated && !entitlements.referenceExport;
  const wordLocked = gated && !entitlements.wordExport;
  const rowCap = gated ? entitlements.exportRows : null;

  const selected = useMemo(() => allRecords.filter((r) => selectedIds.has(r.id)), [allRecords, selectedIds]);
  const base = scope === 'all' ? allRecords : scope === 'selected' ? selected : filtered;
  const toExport = useMemo(() => (onlyDoi ? base.filter((r) => r.doi) : base), [base, onlyDoi]);
  const withoutDoiCount = base.length - base.filter((r) => r.doi).length;
  const willCut = rowCap !== null && rowCap > 0 && toExport.length > rowCap;

  const run = async (format: ExportFormat) => {
    const reference = format === 'bibtex' || format === 'ris';
    if (gated && !user && (reference || needLogin)) {
      account.openAuth('register');
      return;
    }
    if (reference && referenceLocked) {
      account.openUpgrade('Xuất BibTeX/RIS (cho Zotero, Mendeley, EndNote) dành cho hạng Pro.', 'pro');
      return;
    }
    setBusy(format);
    const fileName = exportFileName(format);
    try {
      const outcome = await exportRecords(format, toExport, fileName);
      if (outcome.truncated) {
        void messageApi.warning(`Hạng ${entitlements.label} chỉ xuất ${outcome.truncated.rows}/${outcome.truncated.total} dòng đầu. Mua gói để xuất đủ.`, 7);
      } else {
        void messageApi.success(`Đã xuất ${toExport.length} bài vào file ${fileName}`);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'plan_required') account.openUpgrade(error.message, 'pro');
      else if (error instanceof ApiError && error.code === 'unauthorized') account.openAuth('login');
      else void messageApi.error(error instanceof Error ? `Xuất file thất bại: ${error.message}` : 'Xuất file thất bại.');
    } finally {
      setBusy(null);
    }
  };

  const runWord = async () => {
    if (gated && !user) {
      account.openAuth('register');
      return;
    }
    if (wordLocked) {
      account.openUpgrade('Xuất tài liệu tham khảo ra file Word (đã sắp xếp, thụt dòng) dành cho hạng Tiêu chuẩn trở lên.', 'standard');
      return;
    }
    setBusy('docx');
    try {
      const text = formatReferenceList(toExport, { style: citationStyle, includeDoi: false, custom: customCitation });
      await exportDocx(text.split('\n').filter((l) => l.trim()), docxFileName());
      void messageApi.success(`Đã xuất ${toExport.length} tài liệu tham khảo ra file Word.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'plan_required') account.openUpgrade(error.message, 'standard');
      else if (error instanceof ApiError && error.code === 'unauthorized') account.openAuth('login');
      else void messageApi.error(error instanceof Error ? `Xuất file Word thất bại: ${error.message}` : 'Xuất file Word thất bại.');
    } finally {
      setBusy(null);
    }
  };

  const disabled = toExport.length === 0 || busy !== null || !online;
  const lockTag = (text: string) => (
    <Tag color="gold" icon={<LockOutlined />} style={{ marginInlineStart: 6, marginInlineEnd: 0 }}>
      {text}
    </Tag>
  );

  return (
    <Panel title="Xuất danh sách" extra="Excel, CSV, Word, BibTeX hoặc RIS" aria-label="Xuất dữ liệu">
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
          <Button type="primary" icon={<FileExcelOutlined />} loading={busy === 'xlsx'} disabled={disabled} onClick={() => void run('xlsx')}>
            Xuất Excel (.xlsx)
            {needLogin && !user && lockTag('Đăng nhập')}
          </Button>
          <Button icon={<FileTextOutlined />} loading={busy === 'csv'} disabled={disabled} onClick={() => void run('csv')}>
            Xuất CSV
            {needLogin && !user && lockTag('Đăng nhập')}
          </Button>
          <Button icon={<FileWordOutlined />} loading={busy === 'docx'} disabled={disabled} onClick={() => void runWord()} title="Danh sách tài liệu tham khảo theo kiểu trích dẫn đang chọn, sẵn để dán vào luận văn">
            Tài liệu tham khảo (.docx)
            {wordLocked && (
              <Tag color="gold" icon={<LockOutlined />} style={{ marginInlineStart: 6, marginInlineEnd: 0 }}>
                Tiêu chuẩn
              </Tag>
            )}
          </Button>
          {(['bibtex', 'ris'] as const).map((format) => (
            <Button key={format} icon={<FileTextOutlined />} loading={busy === format} disabled={disabled} onClick={() => void run(format)} title={referenceLocked ? 'Tính năng hạng Pro' : undefined}>
              {format === 'bibtex' ? 'BibTeX' : 'RIS'}
              {referenceLocked && (
                <Tag color="gold" icon={<CrownFilled />} style={{ marginInlineStart: 6, marginInlineEnd: 0 }}>
                  Pro
                </Tag>
              )}
            </Button>
          ))}
          <Typography.Text type="secondary">
            Sẽ xuất <b>{willCut ? rowCap : toExport.length}</b> bài{willCut ? ` (hạng ${entitlements.label} giới hạn ${rowCap} dòng/file)` : ' (toàn bộ, không chỉ trang đang xem)'}.
          </Typography.Text>
        </Space>
        {willCut && (
          <Alert
            type="warning"
            showIcon
            title={`Bạn đang chọn ${toExport.length} bài nhưng hạng ${entitlements.label} chỉ xuất ${rowCap} dòng đầu mỗi file.`}
            action={
              <Button size="small" type="primary" onClick={() => account.openUpgrade('Hạng Tiêu chuẩn trở lên xuất không giới hạn số dòng.', 'standard')}>
                Mua gói
              </Button>
            }
          />
        )}
        {needLogin && !user && <Alert type="info" showIcon title="Đăng nhập (miễn phí) để xuất file Excel/CSV." action={<Button size="small" type="primary" onClick={() => account.openAuth('register')}>Đăng nhập</Button>} />}
        {!onlyDoi && withoutDoiCount > 0 && toExport.length > 0 && (
          <Typography.Text type="secondary">Trong đó có {withoutDoiCount} bài chưa có DOI; tick “Chỉ xuất bài có DOI” để loại các bài này.</Typography.Text>
        )}
        {scope === 'selected' && selected.length === 0 && <Alert type="info" showIcon title="Chưa chọn bài nào. Tick các dòng trong bảng để chọn bài cần xuất." />}
      </Space>
    </Panel>
  );
}
