import { Alert, FloatButton, Layout, Typography } from 'antd';
import { useMemo, useState } from 'react';
import type { PaperRecord, SearchRequest, SearchResult } from '../../shared/types';
import { AppFooter } from './components/AppFooter';
import { DetailDrawer } from './components/DetailDrawer';
import { ProductPopup } from './components/ProductPopup';
import { DuplicatesModal, type DuplicateAction } from './components/DuplicatesModal';
import { ExportPanel } from './components/ExportPanel';
import { Header } from './components/Header';
import { ResultsTable } from './components/ResultsTable';
import { SearchForm } from './components/SearchForm';
import { EmptyState, NoResults, SearchProgress, SourceAlerts } from './components/SearchStatus';
import { StatsBar } from './components/StatsBar';
import { useOnlineStatus, useSearch, useSourceHealth } from './lib/hooks';
import { useCitationStyle, useCustomCitation } from './lib/citationStyle';
import { DEFAULT_FILTERS, DEFAULT_SOURCES, filterRecords, type ResultFilters } from './lib/records';

const pairKey = (ids: readonly [string, string]) => ids.join('|');

/** Toàn bộ trạng thái thao tác trên một kết quả (lọc, chọn, xử lý nghi trùng); được tạo mới cho mỗi lần tìm. */
function ResultsView({ result, online }: { result: SearchResult; online: boolean }) {
  const [citationStyle, setCitationStyle] = useCitationStyle();
  const [customCitation, setCustomCitation] = useCustomCitation();
  const [filters, setFilters] = useState<ResultFilters>(DEFAULT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<PaperRecord | null>(null);
  const [dupOpen, setDupOpen] = useState(false);

  const records = useMemo(() => result.records.filter((r) => !removedIds.has(r.id)), [result.records, removedIds]);
  const byId = useMemo(() => new Map(result.records.map((r) => [r.id, r])), [result.records]);
  const filtered = useMemo(() => filterRecords(records, filters), [records, filters]);
  const pendingPairs = useMemo(
    () => result.suspectedDuplicates.filter((p) => !dismissed.has(pairKey(p.recordIds)) && !removedIds.has(p.recordIds[0]) && !removedIds.has(p.recordIds[1])),
    [result.suspectedDuplicates, dismissed, removedIds],
  );

  const withDoi = records.filter((r) => r.doi).length;
  const stats = { ...result.stats, total: records.length, withDoi, withoutDoi: records.length - withDoi };

  const resolve = (pair: (typeof pendingPairs)[number], action: DuplicateAction) => {
    if (action === 'keep-both') {
      setDismissed((prev) => new Set(prev).add(pairKey(pair.recordIds)));
      return;
    }
    const removeId = action === 'remove-a' ? pair.recordIds[0] : pair.recordIds[1];
    setRemovedIds((prev) => new Set(prev).add(removeId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(removeId);
      return next;
    });
  };

  return (
    <>
      <SourceAlerts result={result} />
      {records.length === 0 ? (
        <NoResults result={result} />
      ) : (
        <>
          <StatsBar stats={stats} suspectedCount={pendingPairs.length} freeCount={records.filter((r) => r.isOpenAccess).length} onShowSuspected={() => setDupOpen(true)} />
          <ExportPanel allRecords={records} filtered={filtered} selectedIds={selectedIds} online={online} />
          <ResultsTable
            allRecords={records}
            filtered={filtered}
            filters={filters}
            onFiltersChange={setFilters}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onShowDetail={setDetail}
            citationStyle={citationStyle}
            onCitationStyleChange={setCitationStyle}
            customCitation={customCitation}
            onCustomCitationChange={setCustomCitation}
          />
          <Typography.Paragraph type="secondary" className="pf-disclaimer">
            Dữ liệu là metadata công khai từ Crossref và OpenAlex, không phải toàn bộ tài liệu khoa học trên thế giới. Abstract, tác giả hoặc tạp chí có thể thiếu tùy bản ghi. Bài preprint chưa chắc đã qua bình duyệt.
          </Typography.Paragraph>
        </>
      )}
      <DetailDrawer record={detail} citationStyle={citationStyle} customCitation={customCitation} onClose={() => setDetail(null)} />
      <DuplicatesModal open={dupOpen} pairs={pendingPairs} byId={byId} onClose={() => setDupOpen(false)} onResolve={resolve} />
    </>
  );
}

export default function App() {
  const online = useOnlineStatus();
  const health = useSourceHealth(online);
  const search = useSearch();
  const [lastRequest, setLastRequest] = useState<SearchRequest | null>(null);
  const available = health.status === 'ready' ? health.sources.map((s) => s.source) : DEFAULT_SOURCES;

  const run = (request: SearchRequest) => {
    setLastRequest(request);
    search.start(request);
  };

  const searching = search.phase === 'searching';

  return (
    <Layout className="pf-layout">
      <Header health={health} online={online} />
      <Layout.Content className="pf-main pf-main-overlap">
        {!online && <Alert type="warning" showIcon message="Bạn đang offline" description="Không thể tìm kiếm hoặc xuất file cho tới khi có mạng trở lại. Kết quả đã tải vẫn xem được." />}
        <SearchForm searching={searching} disabled={!online} available={available} onSearch={run} onCancel={search.cancel} />
        {searching && lastRequest && <SearchProgress sources={lastRequest.sources} progress={search.progress} />}
        <EmptyState phase={search.phase} error={search.error} hasResult={search.result !== null} onRetry={lastRequest ? () => run(lastRequest) : undefined} />
        {search.result && search.phase === 'done' && <ResultsView key={search.result.finishedAt} result={search.result} online={online} />}
      </Layout.Content>
      <AppFooter />
      <ProductPopup />
      <FloatButton.BackTop className="pf-backtop" visibilityHeight={600} tooltip="Lên đầu trang" />
    </Layout>
  );
}
