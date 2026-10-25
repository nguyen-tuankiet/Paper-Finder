# PaperFinder

Tìm kiếm và quản lý tài liệu khoa học: nhập từ khóa → lấy bài báo **thật** từ nhiều nguồn học thuật → chuẩn hóa, loại trùng → lọc/sắp xếp/chọn → xuất **Excel (.xlsx)** hoặc **CSV**.

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
| POST | `/api/export` | `{format: "xlsx"\|"csv", records: [...]}` → file tải về |
| GET | `/api/sources` | Danh sách nguồn đang bật và trạng thái kết nối của từng nguồn (cache 60 giây) |
| GET | `/api/health` | Kiểm tra backend |

Ví dụ yêu cầu tìm kiếm:

```json
{ "keywords": ["Artificial intelligence in education", "Machine learning in healthcare"],
  "sources": ["crossref", "openalex", "europepmc", "doaj", "arxiv"], "maxResults": 50,
  "yearFrom": 2020, "yearTo": 2025, "onlyWithDoi": true }
```

`maxResults` (20/50/100/200/500) áp dụng cho **mỗi từ khóa trên mỗi nguồn**; tối đa 10 từ khóa mỗi lần.

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
- Cột: `STT, Title, DOI, Authors, Publication Year, Journal, Publisher, Document Type, Abstract, Source, Original URL, Search Keyword`. Tác giả, nguồn và từ khóa nhiều giá trị được nối bằng `; `.
