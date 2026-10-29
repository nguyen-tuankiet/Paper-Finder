# PaperFinder

Tìm kiếm và quản lý tài liệu khoa học: nhập từ khóa → lấy bài báo **thật** từ nhiều nguồn học thuật → chuẩn hóa, loại trùng → lọc/sắp xếp/chọn → xuất **Excel (.xlsx)** hoặc **CSV**.

## Giao diện

Giao diện dùng Ant Design 6: `Layout` (đầu trang có hero, nội dung, chân trang), `Card` cho các khung nội dung (`web/src/components/Panel.tsx`), `Statistic` cho lưới thống kê, nút "lên đầu trang". Chân trang nền navy gồm bốn cột (thương hiệu, nguồn dữ liệu, liên kết nhanh, theo dõi tác giả); "Hướng dẫn sử dụng", "Câu hỏi thường gặp" và "Chính sách bảo mật" mở hộp thoại có nội dung thật (`web/src/components/InfoModals.tsx`). Sau khoảng 1 giây khi vào trang, popup "Khám phá hệ sinh thái của chúng tôi" (`ProductPopup.tsx`) giới thiệu Cocoflow và Muse Studio; đóng bằng nút ×, phím Esc hoặc bấm nền, chỉ mở tab mới khi bấm vào sản phẩm, và không tự hiện lại trong cùng phiên; sau khi đóng, popup thu lại thành nút tròn ở mép phải màn hình, bấm vào để mở lại (ghi nhận bằng `sessionStorage`, có dự phòng trong bộ nhớ; có thể đặt thời gian hiện lại bằng `RESHOW_AFTER_MS`). Hai sản phẩm cũng có liên kết gọn ở chân trang. Tên tác giả, liên kết GitHub, mạng xã hội (icon chỉ hiện khi có URL trong `AUTHOR.socials`), danh sách ứng dụng khác và các liên kết nguồn dữ liệu nằm trong **một file dễ sửa: `web/src/lib/author.ts`**; logo Cocoflow ở `web/public/apps/`. Các liên kết ngoài đều mở ở tab mới với `rel="noopener noreferrer"`.

## Nguồn dữ liệu

| Nguồn | Thế mạnh | Cần key? | Giới hạn backend áp dụng |
| --- | --- | --- | --- |
| Crossref | Mọi bài có DOI, mọi lĩnh vực | Không | ≤ 2 đồng thời, cách nhau ≥ 400 ms |
| OpenAlex | Tổng hợp rộng, có cả bài không DOI | Không (key miễn phí tùy chọn) | 1 đồng thời, cách nhau ≥ 250 ms |
| Europe PMC | Y sinh, sức khỏe, kèm preprint | Không | ≤ 2 đồng thời, cách nhau ≥ 250 ms |
| DOAJ | Tạp chí truy cập mở | Không | 1 đồng thời, cách nhau ≥ 700 ms |
| arXiv | Preprint vật lý, toán, tin học | Không | 1 request / 3,1 giây (theo quy định của arXiv) |
| Semantic Scholar | Khoa học máy tính, y sinh | **Có** (`SEMANTIC_SCHOLAR_API_KEY`) | 1 request / 1,1 giây |

Semantic Scholar chỉ được bật khi có key (khi khảo sát, request không key bị HTTP 429 liên tục). Adapter này **chưa được kiểm thử với API thật** (chưa có key), chỉ kiểm thử bằng dữ liệu mô phỏng theo tài liệu API. Các nguồn còn lại đều đã có test tích hợp với API thật.

Lưu ý: arXiv phần lớn không có DOI (DOI chỉ có khi tác giả khai báo DOI bản đã xuất bản; ứng dụng không tự tạo DOI), nên khi chọn arXiv hãy bỏ tick “Chỉ lấy bài có DOI”.

> Kết quả là metadata công khai, **không bao phủ toàn bộ** tài liệu khoa học. Abstract, tác giả, tạp chí có thể thiếu tùy bản ghi. Ứng dụng không tải toàn văn bài báo.

## Cấu trúc thư mục

```
shared/types.ts        Kiểu dữ liệu dùng chung (PaperRecord, SearchRequest, ...)
server/                Backend Node.js + Express + TypeScript + Zod
  src/sources/         Adapter riêng cho Crossref, OpenAlex (-> PaperRecord chung)
  src/services/        search (điều phối), dedupe (loại trùng), export (CSV/XLSX), health
  src/lib/             http (timeout/retry/backoff/cache), limiter, doi, text, cache
  test/                Unit/API test (mock) + test/integration (API thật)
web/                   Frontend React + TypeScript + Vite + Ant Design
Dockerfile, docker-compose.yml, .env.example
```

## Chạy local trên Windows (PowerShell)

Yêu cầu: Node.js ≥ 20.12 (khuyến nghị 22) và npm.

```powershell
# 1. Cài dependencies (một lần, ở thư mục gốc dự án)
npm install

# 2. (Tùy chọn) tạo file cấu hình
Copy-Item .env.example .env

# 3. Chạy cả backend (http://localhost:8787) và frontend (http://localhost:5173)
npm run dev
```

Mở http://localhost:5173. Chạy riêng từng phần: `npm run dev:server`, `npm run dev:web`.

Không cần tài khoản hay API key trả phí. Các tùy chọn miễn phí nên đặt trong `.env` (xem phần giới hạn bên dưới): `CONTACT_EMAIL`, `OPENALEX_API_KEY`, và `SEMANTIC_SCHOLAR_API_KEY` (để bật thêm nguồn Semantic Scholar).

### Kiểm thử

```powershell
npm test                    # unit test backend + frontend (dùng mock, không cần Internet)
npm run test:integration    # test với API thật của Crossref/OpenAlex (cần Internet)
npm run typecheck           # kiểm tra kiểu TypeScript
```

### Build và chạy production

```powershell
npm run build
npm start                   # backend phục vụ luôn web/dist tại http://localhost:8787
```

## API backend

| Method | Đường dẫn | Mô tả |
| --- | --- | --- |
| POST | `/api/search` | Tìm kiếm. Trả về NDJSON: các dòng `progress`, rồi một dòng `result`. Đóng kết nối = hủy tác vụ. |
| POST | `/api/export/docx` | `{lines: [...]}` (các dòng tài liệu tham khảo đã định dạng) → file Word (hạng Tiêu chuẩn trở lên khi bật tài khoản) |
| POST | `/api/lookup` | `{text}` (mỗi dòng một DOI) → `{result, notFound, failed, invalid, duplicates}` (hạng Tiêu chuẩn trở lên khi bật tài khoản) |
| POST | `/api/export` | `{format: "xlsx"\|"csv"\|"bibtex"\|"ris", records: [...]}` → file tải về (khi bật tài khoản: cần đăng nhập, hạng Miễn phí cắt còn 50 dòng, BibTeX/RIS chỉ hạng Pro) |
| GET | `/api/sources` | Danh sách nguồn đang bật và trạng thái kết nối của từng nguồn (cache 60 giây) |
| GET | `/api/health` | Kiểm tra backend (nhẹ, không gọi nguồn dữ liệu; dùng cho bot giám sát) |
| GET | `/api/admin/stats?days=30` | Thống kê sử dụng; cần header `Authorization: Bearer <ADMIN_PASSWORD>` |
| GET | `/api/me`, `/api/plans` | Trạng thái đăng nhập, hạn mức lượt tìm; giá và các gói |
| POST | `/api/auth/register`, `/login`, `/logout`, `/change-password` | Tài khoản email + mật khẩu (chỉ khi bật `SESSION_SECRET`) |
| POST | `/api/billing/checkout`, `/confirm`, `/sepay-webhook` | Tạo đơn chuyển khoản QR (SePay), kiểm tra trạng thái đơn, nhận webhook SePay để kích hoạt gói |
| GET/POST/DELETE | `/api/library`, `/api/history` | Thư viện cá nhân và lịch sử tìm kiếm (từ hạng Tiêu chuẩn) |
| POST | `/api/admin/grant`, GET `/api/admin/accounts` | Cấp gói thủ công và thống kê tài khoản (cần mật khẩu admin) |

Ví dụ yêu cầu tìm kiếm:

```json
{ "keywords": ["Artificial intelligence in education", "Machine learning in healthcare"],
  "sources": ["crossref", "openalex", "europepmc", "doaj", "arxiv"], "maxResults": 50,
  "yearFrom": 2020, "yearTo": 2025, "onlyWithDoi": true }
```

`maxResults` (20/50/100/200/500) áp dụng cho **mỗi từ khóa trên mỗi nguồn**; tối đa 10 từ khóa mỗi lần.

## Truy cập miễn phí (Open Access)

Mỗi bài có cột **Truy cập**:
- **Miễn phí**: có ít nhất một nguồn xác nhận bài có bản đọc miễn phí hợp pháp (truy cập mở). Kèm giấy phép (vd. CC BY) nếu nguồn nêu, và nút **Tải PDF** (link PDF trực tiếp) hoặc **Đọc toàn văn** (trang chứa toàn văn).
- **Chưa thấy bản miễn phí**: các nguồn chưa cho biết bài có bản mở. Nút **Trang nhà xuất bản** mở link DOI (hoặc URL gốc) để khách xem quyền truy cập hoặc giá. Nhãn này **không** khẳng định bài chắc chắn mất phí: bài có thể đọc được qua thư viện/trường học, hoặc nguồn chưa cập nhật bản mở.

Bộ lọc **Truy cập** (Miễn phí / Chưa thấy bản miễn phí / Mọi truy cập) và ô thống kê “Có bản miễn phí” nằm ở phần kết quả. File xuất có thêm hai cột **Open Access URL** (ưu tiên PDF, nếu không thì trang đọc) và **License**.

Nguồn dữ liệu truy cập mở:

| Nguồn | Cách xác định |
| --- | --- |
| OpenAlex | `open_access.is_oa`, `best_oa_location` (link PDF, trang, giấy phép) |
| Europe PMC | Cờ `isOpenAccess` và các link toàn văn đánh dấu `OA`/`F` (link `S` = cần đăng ký thì bỏ qua) |
| DOAJ | Mọi bài là bản mở (DOAJ chỉ lập chỉ mục tạp chí truy cập mở); link toàn văn là trang bài báo |
| arXiv | Mọi bài đọc miễn phí; PDF ở địa chỉ chuẩn của arXiv |
| Semantic Scholar | `openAccessPdf` (chưa kiểm thử với API thật) |
| Crossref | Không suy đoán; trạng thái được bổ sung khi bài cũng xuất hiện ở nguồn khác |

Khi một bài có ở nhiều nguồn, chỉ cần một nguồn xác nhận là bản mở thì cả bài được gắn “Miễn phí”; URL và giấy phép chỉ lấy từ các bản ghi xác nhận là mở.

**Nút "Tải PDF"** tải file về máy trực tiếp. Link PDF của nhà xuất bản ở tên miền khác nên trình duyệt chỉ mở trong trình xem PDF (thuộc tính `download` bị bỏ qua), vì vậy máy chủ PaperFinder chuyển tiếp file qua `GET /api/download` (không lưu file, chỉ truyền thẳng). Các biện pháp an toàn:
- Chỉ chuyển tiếp link PDF do **chính máy chủ đã ký** (HMAC) trong kết quả tìm kiếm; không thể dùng làm proxy cho URL bất kỳ.
- Chặn truy cập địa chỉ nội bộ/đám mây (SSRF), kể cả IP viết dạng lạ (thập phân, hex, IPv6 nhúng IPv4) và chuyển hướng vào mạng nội bộ; chỉ http(s); kiểm tra lại ở mỗi chặng chuyển hướng.
- Chỉ nhận dữ liệu thực sự bắt đầu bằng `%PDF-`; giới hạn dung lượng (`DOWNLOAD_MAX_MB`), timeout, tối đa 4 lượt tải đồng thời và giới hạn tốc độ theo IP.
- Dùng `User-Agent` trung thực (`PaperFinder/1.0`), **không giả trình duyệt để vượt chặn bot**.

**Hạn chế:** dữ liệu truy cập mở không hoàn hảo. Thử với dữ liệu thật (26/10/2026), nhiều nhà xuất bản (ví dụ MDPI) trả HTTP 403 cho tải tự động từ máy chủ, một số link hỏng (404), lỗi kết nối hoặc dẫn tới trang HTML (có thể là trang đăng ký). Khi không tải trực tiếp được, giao diện báo lý do và tự mở link gốc ở tab mới để khách lưu từ trình xem PDF (Ctrl+S). Băng thông tải file đi qua máy chủ của bạn (cần tính khi dùng gói miễn phí). Ứng dụng không tích hợp các trang chia sẻ tài liệu vi phạm bản quyền (Sci-Hub, LibGen...).

## Sao chép tài liệu tham khảo

Nút **Trích dẫn** (mỗi bài) và dòng **Tài liệu tham khảo** phía trên bảng: chọn kiểu ghi rồi bấm sao chép các bài đã tick chọn (hoặc toàn bộ kết quả đang lọc nếu chưa chọn bài nào). Dòng này **mặc định thu gọn** (một dòng); bấm *Xem trước & tùy chọn* để xem ví dụ, bật Kèm DOI hoặc soạn mẫu riêng. Mục *Tài liệu tham khảo* trong ngăn Chi tiết dùng cùng kiểu đã chọn. Kiểu, mẫu tự soạn và trạng thái mở/thu gọn được nhớ lại ở lần mở sau (chỉ trong trình duyệt của người dùng):

| Kiểu | Bài tạp chí | Danh sách |
| --- | --- | --- |
| **IEEE** (mặc định) | `A. A. Author, “Title,” Journal Name, vol. x, no. x, pp. xx–xx, year, doi: DOI.` | đánh số [1], [2]... theo thứ tự đang hiển thị |
| **APA 7** | `Author, A. A. (Year). Title. Journal Name, volume(issue), pages. https://doi.org/xxx` | không đánh số, sắp xếp theo tên tác giả |
| **Mẫu cơ bản** | `Kumar S, Title, Journal (7), no. 2, 1987, pp. 313 - 325.` (tùy chọn Kèm DOI) | đánh số [1], [2]... |
| **Tùy chỉnh** | do bạn soạn (xem bên dưới) | theo mẫu và thứ tự bạn chọn |

**Kiểu Tùy chỉnh — tự soạn mẫu:** viết mẫu bằng các trường trong dấu `{ }`: `{authors}`, `{first_author}`, `{title}`, `{journal}`, `{volume}`, `{issue}`, `{volume_issue}`, `{pages}` (313-325), `{pages_en}` (313–325), `{first_page}`, `{last_page}`, `{year}`, `{doi}`, `{doi_url}`, `{url}`, `{publisher}`, `{place}`, `{type}`, `{retrieved}`, `{index}` (số thứ tự). Bấm các nút chèn trường thay vì gõ tay. Phần đặt trong **`[[ ]]` là nhóm tùy chọn**: nếu bài không có dữ liệu của bất kỳ trường nào bên trong thì cả nhóm biến mất, nên không bịa dữ liệu và không để lại dấu câu thừa. Ví dụ `{authors}, {title}, {journal}[[, tập {volume}]][[, {year}]].`. Ký tự khác (kể cả `[ ]` đơn như `[{index}]`) giữ nguyên. Còn chọn được: cách ghi tên tác giả (Kumar S / S. Kumar / Kumar, S. / như nguồn), cách nối (`,` / `and` / `&` / `;`), số tác giả tối đa rồi "et al.", và thứ tự (theo bảng hoặc A–Z). Có 5 mẫu có sẵn để sửa tiếp, trong đó "Giống IEEE" và "Giống APA 7" cho kết quả trùng khớp hai kiểu chính thức với bài tạp chí đủ dữ liệu. Tên trường gõ sai được cảnh báo ngay.

Hỗ trợ các loại: bài tạp chí, hội nghị, sách, chương sách, luận văn, báo cáo (mỗi kiểu có mẫu riêng cho từng loại, đã được đối chiếu bằng test với các mẫu IEEE/APA 7 của dự án). Ngăn Chi tiết của APA còn có **trích dẫn trong văn bản** (Nguyen & Tran, 2025). Với IEEE, trong văn bản dùng số thứ tự [n] theo danh sách.

**Không hỗ trợ:** website (ứng dụng chỉ tìm tài liệu học thuật). **Phần nào nguồn không có thì bị bỏ qua, không bịa:** biên tập viên của chương sách, lần xuất bản của sách, số báo cáo, bậc học và nơi của luận văn đều không có trong dữ liệu nên không xuất hiện (luận văn ghi chung là "thesis"). Tên tạp chí/sách không in nghiêng được ở dạng văn bản thuần; tiêu đề giữ nguyên chữ hoa/thường của nguồn (APA yêu cầu viết hoa kiểu câu, chưa tự chuyển đổi). Tên tác giả theo thứ tự họ phổ biến cho tên Việt Nam khi nguồn không tách họ/tên nên có thể sai ở vài trường hợp. Hãy đối chiếu với bài gốc trước khi dùng.

## Tài khoản, hạng và gói trả phí (tùy chọn)

Đặt `SESSION_SECRET` để bật đăng nhập bằng email + mật khẩu (băm bằng scrypt, đăng ký xong tự đăng nhập, phiên là cookie HttpOnly nhớ ~6 tháng và tự gia hạn). Có bốn hạng: **Khách** (chưa đăng nhập, giới hạn nhiều nhất), **Miễn phí** (đã đăng nhập), **Tiêu chuẩn** và **Pro** (mua 7 ngày / 1 tháng / 1 năm); mỗi hạng khác nhau về lượt tìm mỗi ngày, số kết quả mỗi nguồn, số dòng xuất file, thư viện cá nhân, lịch sử tìm kiếm và xuất BibTeX/RIS (bảng đầy đủ trong `DEPLOY.md` mục 7). Không đặt `SESSION_SECRET` thì mọi thứ chạy như trước (không đăng nhập, không giới hạn). Dữ liệu tài khoản lưu ở PostgreSQL (`DATABASE_URL`) hoặc file JSON khi chạy local; thanh toán chuyển khoản QR qua SePay, kích hoạt tự động và đúng một lần cho mỗi đơn. Cấu hình, webhook và cấp Pro thủ công: xem `DEPLOY.md` mục 7 và `.env.example`.

## Tín hiệu chất lượng và công cụ cho luận văn

- **Bài đã bị rút lại**: gắn nhãn đỏ và cảnh báo (dữ liệu Retraction Watch qua Crossref `updated-by`, và cờ `is_retracted` của OpenAlex); hiện ở mọi hạng.
- **Số trích dẫn**: cột "Trích dẫn" (số lớn nhất giữa các nguồn vì mỗi nguồn đếm khác nhau); hạng Tiêu chuẩn trở lên được sắp xếp và lọc theo trích dẫn.
- **Xếp hạng tạp chí Q1–Q4 (SJR)** và lọc theo hạng: ghép theo ISSN từ file CSV SCImago do chủ web tự nạp (`server/data/scimagojr.csv`, xem `DEPLOY.md` mục 7.5); không kèm sẵn dữ liệu.
- **Xuất tài liệu tham khảo ra Word (.docx)**: dàn trang sẵn (Times New Roman 13, thụt dòng treo, giãn dòng 1,5) theo kiểu trích dẫn đang chọn. Văn bản trích dẫn là chữ thường, chưa có chữ nghiêng.
- **Chuẩn hóa danh sách DOI**: dán DOI (hoặc cả đoạn tài liệu tham khảo, link doi.org) để lấy thông tin từng bài từ Crossref + OpenAlex rồi sao chép/xuất như kết quả tìm kiếm. DOI không có ở nguồn nào được liệt kê riêng; DOI tra lỗi tạm thời cũng báo riêng để thử lại.

## Trang quản trị (thống kê sử dụng)

Đặt `ADMIN_PASSWORD` (tối thiểu 8 ký tự) trong `.env` rồi mở `/admin` (ví dụ http://localhost:5173/admin) để xem:
- Số người dùng và số lượt tìm kiếm: hôm nay, 7 ngày, 30 ngày, toàn bộ; số lượt xuất file; số bài trung bình mỗi lượt tìm.
- Biểu đồ và bảng theo ngày (thành công, lỗi, hủy), bảng theo nguồn (số lần dùng, tỷ lệ lỗi).

Không đặt `ADMIN_PASSWORD` thì trang và API admin bị tắt (API trả 404). Đăng nhập sai quá 10 lần trong 15 phút sẽ bị chặn tạm thời.

**Quyền riêng tư:** chỉ lưu số đếm theo ngày và mã băm HMAC một chiều của (IP + trình duyệt) để đếm người dùng khác nhau. **Không lưu địa chỉ IP, từ khóa hay nội dung tìm kiếm.** “Người dùng” là thiết bị/mạng khác nhau nên có thể lệch nếu một người dùng nhiều thiết bị hoặc nhiều người chung một mạng. Các lần ping `/api/health` của bot giám sát không bị tính.

**Lưu trữ:** số liệu ghi vào `STATS_FILE` (mặc định `server/data/stats.json`, đã được `.gitignore`), giữ `STATS_RETENTION_DAYS` ngày (mặc định 365). Máy chủ có ổ đĩa tạm (ví dụ Render gói Free) sẽ **mất số liệu khi khởi động lại hoặc deploy lại**; với Docker hãy dùng volume (đã cấu hình sẵn trong `docker-compose.yml`).

## Cách xử lý dữ liệu

- **Adapter riêng** cho từng nguồn rồi chuẩn hóa về `PaperRecord`. Crossref: `query.bibliographic`, phân trang `rows/offset`, `select` các trường cần thiết, abstract dạng JATS được làm sạch. OpenAlex: `search.title_abstract_keywords` (tìm trong tiêu đề/abstract/từ khóa, không tìm toàn văn), phân trang `page/per_page`, abstract dựng từ *inverted index*. Europe PMC: `TITLE_ABS:(...)`, lọc `PUB_YEAR`/`HAS_DOI`, phân trang `cursorMark`. DOAJ: truy vấn trong đường dẫn + `bibjson.year`. arXiv: Atom XML, các từ khóa nối bằng `AND`, lọc `submittedDate`. Semantic Scholar: `/graph/v1/paper/search`.
- Mỗi adapter bỏ DOI lặp ngay trong một truy vấn (phân trang offset/cursor của vài nguồn có thể trả cùng một bài ở hai trang) rồi mới đến bước loại trùng giữa các nguồn.
- **DOI** được chuẩn hóa (chữ thường, bỏ `https://doi.org/`, `doi:`); DOI sai định dạng bị bỏ chứ không bị “sửa”. Không bao giờ tự tạo DOI, tác giả, năm hay tạp chí. Trường thiếu hiển thị “Chưa có dữ liệu” (để trống trong file xuất).
- **Loại trùng**:
  1. Cùng DOI chuẩn hóa → gộp.
  2. Không có DOI → chỉ gộp khi *tiêu đề chuẩn hóa trùng khớp* **và** có bằng chứng thêm (tác giả đầu khớp và năm không mâu thuẫn, hoặc năm khớp khi chưa biết tác giả) và xác định được duy nhất một đích.
  3. Tiêu đề giống nhau nhưng thiếu bằng chứng, hoặc **khác DOI** (ví dụ preprint và bản xuất bản) → **không gộp**, đưa vào danh sách “Nghi trùng” để người dùng xem và xử lý.
  4. Khi gộp: giữ mọi nguồn, từ khóa, tham chiếu bản ghi gốc; chỉ điền ô còn trống, không ghi đè dữ liệu hợp lệ bằng dữ liệu rỗng; abstract giữ bản dài hơn.
- **Preprint**: Crossref `posted-content` và OpenAlex `preprint` được gắn nhãn “Preprint”; loại tài liệu giữ đúng giá trị nguồn cung cấp.

## Độ ổn định

Timeout mỗi request; retry tối đa `MAX_RETRIES` lần với exponential backoff + jitter cho HTTP 429/5xx, lỗi mạng và timeout; tôn trọng `Retry-After` (nếu phải chờ quá lâu, ví dụ hết hạn mức ngày, báo lỗi ngay thay vì chờ); giới hạn số request đồng thời và khoảng cách giữa các request; cache trong bộ nhớ (mặc định 10 phút); hủy tác vụ khi người dùng bấm “Hủy” hoặc đóng trang. Một nguồn lỗi không làm hỏng nguồn còn lại. Log là JSON có cấu trúc và che các trường nhạy cảm; không lưu từ khóa hay dữ liệu cá nhân.

## Giới hạn sử dụng API và chi phí

Kiểm tra lại các trang chính sách của nhà cung cấp trước khi triển khai công khai vì chúng có thể thay đổi.

- **Crossref** (https://api.crossref.org): miễn phí, không cần key. Nên cung cấp email qua `CONTACT_EMAIL` để vào *polite pool*; khi khảo sát (25/10/2026) polite pool trả `x-rate-limit-limit: 3` req/giây và `x-concurrency-limit: 3`. Backend dùng mức thấp hơn (tối đa 2 đồng thời, cách nhau ≥ 400 ms).
- **OpenAlex** (https://api.openalex.org): dữ liệu miễn phí. Khi khảo sát, request **không có key** dùng chung ngân sách **0,10 USD/ngày theo IP** và mỗi request `search` tốn khoảng 0,001 USD (≈ 100 lần gọi/ngày; 500 kết quả = 5 lần gọi). Key miễn phí (https://openalex.org/settings/api) nâng lên 1 USD/ngày; đặt vào `OPENALEX_API_KEY` (chỉ ở backend). Khi hết hạn mức, OpenAlex trả HTTP 429 và PaperFinder báo rõ rồi vẫn trả kết quả từ nguồn còn lại.
- **Europe PMC, DOAJ, arXiv, Semantic Scholar**: khi khảo sát (25/10/2026) Europe PMC, DOAJ và arXiv dùng được không cần key; arXiv yêu cầu tối đa 1 request mỗi 3 giây nên tìm nhiều từ khóa với arXiv sẽ chậm hơn; Semantic Scholar cần key miễn phí. Hãy xem lại chính sách hiện hành của từng nguồn trước khi triển khai công khai.
- Backend có giới hạn `RATE_LIMIT_PER_MINUTE` request/IP để tránh bị lạm dụng khi deploy công khai.
- Hosting: nền tảng nào cũng có thể đổi gói miễn phí; hãy xem trang giá hiện hành, đừng giả định miễn phí vĩnh viễn. Nhiều nền tảng free tier “ngủ” khi không dùng nên lần gọi đầu có thể chậm.

## Triển khai

**Cách đơn giản nhất — một container (backend + frontend):**

```powershell
Copy-Item .env.example .env   # chỉnh nếu cần
docker compose up --build -d  # http://localhost:8787
```

Có thể đưa image lên các dịch vụ chạy container (Render, Railway, Fly.io, Google Cloud Run...). Đặt các biến của `.env.example` trong phần *Environment* của dịch vụ và `TRUST_PROXY=1`.

**Tách frontend và backend:**

1. Backend: deploy `server` (build `npm run build -w server`, chạy `npm start`) lên dịch vụ Node/container; đặt `CORS_ORIGIN=https://<địa-chỉ-frontend>`.
2. Frontend: build với `VITE_API_BASE_URL=https://<địa-chỉ-backend>` (`$env:VITE_API_BASE_URL='https://api.example.com'; npm run build -w web`) rồi đưa thư mục `web/dist` lên hosting tĩnh (Cloudflare Pages, Netlify, Vercel, GitHub Pages...).

Mở rộng sau này: backend không có trạng thái và không có đăng nhập; có thể thêm database/tài khoản (lưu bộ sưu tập, lịch sử tìm kiếm) bằng cách thêm một lớp lưu trữ phía `server/src/services`.

## Ghi chú xuất file

- CSV: UTF-8 có BOM (Excel đọc đúng tiếng Việt), dấu phân cách `,`. Ô văn bản bắt đầu bằng `= + - @` được thêm dấu nháy đơn phía trước để Excel không hiểu là công thức.
- XLSX: chuỗi luôn được lưu là văn bản, DOI/URL là hyperlink, có hàng tiêu đề cố định, bộ lọc và sheet “Ghi chú”.
- Cột: `STT, Title, DOI, Authors, Publication Year, Journal, Publisher, Document Type, Abstract, Source, Original URL, Search Keyword, Open Access URL, License`. Tác giả, nguồn và từ khóa nhiều giá trị được nối bằng `; `.
