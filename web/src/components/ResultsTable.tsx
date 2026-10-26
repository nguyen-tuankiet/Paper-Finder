import { CopyOutlined, DownloadOutlined, EyeOutlined, LinkOutlined, ReadOutlined } from '@ant-design/icons';
import { Button, Input, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import type { SorterResult } from 'antd/es/table/interface';
import { useMemo, useState } from 'react';
import { SOURCE_IDS, type PaperRecord } from '../../../shared/types';
import { copyText } from '../lib/clipboard';
import {
  NO_DATA,
  SOURCE_LABELS,
  authorsShort,
  docTypeLabel,
  doiUrl,
  formatLicense,
  publisherUrl,
  sortByYear,
  type ResultFilters,
} from '../lib/records';

interface Props {
  allRecords: PaperRecord[];
  filtered: PaperRecord[];
  filters: ResultFilters;
  onFiltersChange: (filters: ResultFilters) => void;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onShowDetail: (record: PaperRecord) => void;
}

const muted = (text: string) => <Typography.Text type="secondary">{text}</Typography.Text>;

/**
 * Cột "Truy cập": có bản mở -> nhãn Miễn phí + nút tải PDF (hoặc đọc toàn văn);
 * chưa thấy bản mở -> nút tới trang nhà xuất bản. Nút luôn mở link gốc của nơi cung cấp, không qua máy chủ PaperFinder.
 */
export function AccessCell({ record }: { record: PaperRecord }) {
  if (record.isOpenAccess) {
    return (
      <Space direction="vertical" size={4}>
        <Space size={6} wrap>
          <Tooltip title="Có bản đọc miễn phí hợp pháp (truy cập mở) theo dữ liệu của nguồn.">
            <Tag color="green" style={{ marginInlineEnd: 0 }}>
              Miễn phí
            </Tag>
          </Tooltip>
          {record.oaLicense && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{formatLicense(record.oaLicense)}</Typography.Text>}
        </Space>
        {record.oaPdfUrl ? (
          <Button size="small" type="primary" ghost icon={<DownloadOutlined />} href={record.oaPdfUrl} target="_blank" rel="noopener noreferrer">
            Tải PDF
          </Button>
        ) : record.oaUrl ? (
          <Button size="small" icon={<ReadOutlined />} href={record.oaUrl} target="_blank" rel="noopener noreferrer">
            Đọc toàn văn
          </Button>
        ) : null}
      </Space>
    );
  }
  const url = publisherUrl(record);
  return (
    <Space direction="vertical" size={4}>
      <Tooltip title="Các nguồn chưa cho biết bài có bản miễn phí. Có thể phải trả phí hoặc có quyền truy cập qua thư viện, trường học.">
        <Tag style={{ marginInlineEnd: 0, whiteSpace: 'normal' }}>Chưa thấy bản miễn phí</Tag>
      </Tooltip>
      {url && (
        <Button size="small" icon={<LinkOutlined />} href={url} target="_blank" rel="noopener noreferrer">
          Trang nhà xuất bản
        </Button>
      )}
    </Space>
  );
}

export function ResultsTable({ allRecords, filtered, filters, onFiltersChange, selectedIds, onSelectionChange, onShowDetail }: Props) {
  const [yearOrder, setYearOrder] = useState<'ascend' | 'descend' | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [messageApi, contextHolder] = message.useMessage();

  const data = useMemo(() => sortByYear(filtered, yearOrder), [filtered, yearOrder]);
  const presentSources = useMemo(() => SOURCE_IDS.filter((s) => allRecords.some((r) => r.sources.includes(s))), [allRecords]);
  const types = useMemo(() => [...new Set(allRecords.map((r) => r.documentType).filter(Boolean))].sort(), [allRecords]);

  const copyDoi = async (doi: string) => {
    if (await copyText(doi)) void messageApi.success(`Đã sao chép DOI: ${doi}`);
    else void messageApi.error('Không sao chép được DOI. Hãy chọn và sao chép thủ công.');
  };

  const columns: ColumnsType<PaperRecord> = [
    {
      title: 'STT',
      key: 'stt',
      width: 64,
      align: 'center',
      render: (_value, _record, index) => (page - 1) * pageSize + index + 1,
    },
    {
      title: 'Tên bài báo',
      dataIndex: 'title',
      key: 'title',
      width: 380,
      render: (_value, record) => {
        const title = record.title || '(Chưa có tiêu đề)';
        const content = record.originalUrl ? (
          <a href={record.originalUrl} target="_blank" rel="noopener noreferrer" className="pf-title-link">
            {title}
          </a>
        ) : (
          <span>{title}</span>
        );
        return (
          <div>
            <Tooltip title={title} mouseEnterDelay={0.6} placement="topLeft">
              <div className="pf-clamp pf-clamp-3">{content}</div>
            </Tooltip>
            {record.isPreprint && (
              <Tag color="orange" style={{ marginTop: 4 }}>
                Preprint
              </Tag>
            )}
          </div>
        );
      },
    },
    {
      title: 'DOI',
      dataIndex: 'doi',
      key: 'doi',
      width: 230,
      render: (doi: string) =>
        doi ? (
          <Space size={4} align="start">
            <a href={doiUrl(doi)} target="_blank" rel="noopener noreferrer" className="pf-doi">
              {doi}
            </a>
            <Tooltip title="Sao chép DOI">
              <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => void copyDoi(doi)} aria-label={`Sao chép DOI ${doi}`} />
            </Tooltip>
          </Space>
        ) : (
          muted('Chưa có DOI')
        ),
    },
    {
      title: 'Tác giả',
      key: 'authors',
      width: 220,
      render: (_value, record) => {
        if (record.authors.length === 0) return muted(NO_DATA);
        const { shown, extra } = authorsShort(record.authors);
        return (
          <Tooltip title={record.authors.map((a) => a.name).join(', ')} mouseEnterDelay={0.6}>
            <div className="pf-clamp pf-clamp-3">
              {shown}
              {extra > 0 && <Typography.Text type="secondary"> và {extra} tác giả khác</Typography.Text>}
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: 'Năm',
      dataIndex: 'publicationYear',
      key: 'year',
      width: 84,
      align: 'center',
      sorter: true,
      sortOrder: yearOrder,
      sortDirections: ['descend', 'ascend'],
      render: (year: number | null) => year ?? muted('—'),
    },
    {
      title: 'Tạp chí / hội nghị',
      key: 'journal',
      width: 220,
      render: (_value, record) =>
        record.journal ? (
          <Tooltip title={record.journal} mouseEnterDelay={0.6}>
            <div className="pf-clamp pf-clamp-2">{record.journal}</div>
          </Tooltip>
        ) : (
          muted(NO_DATA)
        ),
    },
    {
      title: 'Nguồn',
      key: 'sources',
      width: 120,
      render: (_value, record) => (
        <Space size={[0, 4]} wrap>
          {record.sources.map((s) => (
            <Tag key={s}>{SOURCE_LABELS[s]}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: 'Truy cập',
      key: 'access',
      width: 190,
      render: (_value, record) => <AccessCell record={record} />,
    },
    {
      title: 'Thao tác',
      key: 'actions',
      width: 96,
      fixed: 'right',
      render: (_value, record) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => onShowDetail(record)}>
          Chi tiết
        </Button>
      ),
    },
  ];

  const handleChange = (pagination: TablePaginationConfig, _filters: unknown, sorter: SorterResult<PaperRecord> | SorterResult<PaperRecord>[]) => {
    setPage(pagination.current ?? 1);
    setPageSize(pagination.pageSize ?? 20);
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    setYearOrder((single?.order as 'ascend' | 'descend' | undefined) ?? null);
  };

  const set = (patch: Partial<ResultFilters>) => {
    setPage(1);
    onFiltersChange({ ...filters, ...patch });
  };

  return (
    <section className="pf-panel" aria-label="Bảng kết quả">
      {contextHolder}
      <h2 className="pf-panel-title">
        Danh sách bài báo <small>Nhấp tên bài để mở trang gốc, nhấp DOI để mở doi.org</small>
      </h2>
      <div className="pf-toolbar">
        <Input.Search
          allowClear
          placeholder="Tìm trong kết quả (tiêu đề, tác giả, DOI, tạp chí...)"
          value={filters.text}
          onChange={(e) => set({ text: e.target.value })}
          className="pf-toolbar-search"
        />
        <Select
          value={filters.doi}
          onChange={(doi) => set({ doi })}
          options={[
            { value: 'all', label: 'Mọi bài (DOI)' },
            { value: 'with', label: 'Có DOI' },
            { value: 'without', label: 'Chưa có DOI' },
          ]}
          style={{ minWidth: 130 }}
          aria-label="Lọc theo DOI"
        />
        <Select
          value={filters.source}
          onChange={(source) => set({ source })}
          options={[
            { value: 'all', label: 'Mọi nguồn' },
            ...presentSources.map((s) => ({ value: s, label: `Có trong ${SOURCE_LABELS[s]}` })),
            ...(presentSources.length > 1 ? [{ value: 'both', label: 'Có ở từ 2 nguồn trở lên' }] : []),
          ]}
          style={{ minWidth: 160 }}
          aria-label="Lọc theo nguồn"
        />
        <Select
          value={filters.access}
          onChange={(access) => set({ access })}
          options={[
            { value: 'all', label: 'Mọi truy cập' },
            { value: 'free', label: 'Miễn phí' },
            { value: 'notfound', label: 'Chưa thấy bản miễn phí' },
          ]}
          style={{ minWidth: 190 }}
          aria-label="Lọc theo truy cập miễn phí"
        />
        {types.length > 1 && (
          <Select
            value={filters.type}
            onChange={(type) => set({ type })}
            options={[{ value: '', label: 'Mọi loại tài liệu' }, ...types.map((t) => ({ value: t, label: docTypeLabel(t) }))]}
            style={{ minWidth: 170 }}
            aria-label="Lọc theo loại tài liệu"
          />
        )}
      </div>

      <div className="pf-selection-bar">
        <Typography.Text>
          Hiển thị <b>{filtered.length}</b>/{allRecords.length} bài · Đã chọn <b>{selectedIds.size}</b>
        </Typography.Text>
        <Space size="small" wrap>
          <Button size="small" disabled={filtered.length === 0} onClick={() => onSelectionChange(new Set([...selectedIds, ...filtered.map((r) => r.id)]))}>
            Chọn tất cả {filtered.length} bài đang lọc
          </Button>
          <Button size="small" disabled={selectedIds.size === 0} onClick={() => onSelectionChange(new Set())}>
            Bỏ chọn
          </Button>
        </Space>
      </div>

      <Table<PaperRecord>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={data}
        onChange={handleChange}
        scroll={{ x: 1440 }}
        sticky
        locale={{ emptyText: 'Không có bài báo nào khớp bộ lọc hiện tại.' }}
        pagination={{ current: page, pageSize, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: (total) => `${total} bài` }}
        rowSelection={{
          selectedRowKeys: [...selectedIds],
          preserveSelectedRowKeys: true,
          onSelect: (record, selected) => {
            const next = new Set(selectedIds);
            if (selected) next.add(record.id);
            else next.delete(record.id);
            onSelectionChange(next);
          },
          onSelectAll: (selected, _rows, changeRows) => {
            const next = new Set(selectedIds);
            for (const row of changeRows) {
              if (selected) next.add(row.id);
              else next.delete(row.id);
            }
            onSelectionChange(next);
          },
        }}
      />
    </section>
  );
}
