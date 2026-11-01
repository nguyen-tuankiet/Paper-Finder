# Triển khai PaperFinder lên Render (miễn phí) + UptimeRobot

Một dịch vụ duy nhất phục vụ cả giao diện lẫn API, nên **không cần** `CORS_ORIGIN` hay `VITE_API_BASE_URL`.

> Gói miễn phí của các nền tảng thay đổi thường xuyên. Các số liệu dưới đây ghi nhận ngày 25/10/2026; hãy xem lại https://render.com/docs/free và https://uptimerobot.com/pricing trước khi triển khai.

## 1. Đưa mã nguồn lên GitHub

Render lấy mã từ GitHub. Mã đã được commit sẵn trong thư mục này (`git log` để xem). Bạn cần:

1. Tạo một repository **trống** trên GitHub (không thêm README/.gitignore).
2. Ở thư mục dự án, chạy (thay đường dẫn bằng repo của bạn; repo hiện tại là `https://github.com/nguyen-tuankiet/Paper-Finder.git`):

```powershell
git branch -M main
git remote add origin https://github.com/<tên-bạn>/<tên-repo>.git
git push -u origin main
```

File `.env` được `.gitignore` bỏ qua nên **key bí mật không bị đưa lên GitHub**. Nếu repo là public, mã nguồn sẽ công khai; chọn Private nếu bạn không muốn.

## 2. Lấy key OpenAlex (nên làm trước)

Render dùng chung địa chỉ IP gửi đi cho nhiều khách hàng, trong khi OpenAlex tính hạn mức không-key theo IP, nên nguồn OpenAlex có thể báo hết hạn mức ngay. Lấy key miễn phí tại https://openalex.org/settings/api (cần tài khoản).

## 3. Tạo dịch vụ trên Render

1. Đăng nhập https://dashboard.render.com (nên dùng "Sign in with GitHub").
2. Bấm **New → Blueprint**. Nếu chưa kết nối GitHub, Render yêu cầu cấp quyền cho repository (chọn đúng repo `Paper-Finder`, không cần cấp cho toàn bộ tài khoản).
3. Tìm repo `Paper-Finder` trong danh sách và bấm **Connect**.
4. Ở form: đặt tên Blueprint (tùy ý), chọn nhánh `main`, để trống **Blueprint Path** (mặc định là `render.yaml` ở thư mục gốc).
5. Điền giá trị cho các biến bí mật mà Render yêu cầu (đều khai báo `sync: false` trong `render.yaml`):
   - `OPENALEX_API_KEY`: key ở bước 2.
   - `CONTACT_EMAIL`: email liên hệ cho Crossref (tùy chọn, có thể để trống).
   - `SEMANTIC_SCHOLAR_API_KEY`: để trống nếu không có (nguồn Semantic Scholar sẽ không được bật).
   - `ADMIN_PASSWORD`: mật khẩu trang quản trị `/admin` (từ 8 ký tự, nên dài và khó đoán). Để trống thì trang admin bị tắt.
6. Xem lại danh sách thay đổi (nếu `render.yaml` có lỗi, Render hiện lỗi tại đây), rồi bấm **Deploy Blueprint**.
7. Mở dịch vụ `paperfinder` → tab **Logs** theo dõi build (vài phút). Khi thấy dòng `server_started` là xong. Địa chỉ nằm ở đầu trang dịch vụ, dạng `https://paperfinder-xxxx.onrender.com`.
8. Kiểm tra: mở `https://<địa-chỉ>/api/health` phải thấy `{"status":"ok"}`, rồi mở trang chủ và thử tìm kiếm.

Nếu quên điền hoặc muốn đổi biến sau này: vào dịch vụ → **Environment** → sửa → Render tự deploy lại.

## 4. UptimeRobot để dịch vụ không "ngủ"

Gói Free của Render ngủ sau 15 phút không có truy cập và mất khoảng 1 phút để thức dậy. Ping định kỳ giúp tránh việc này.

1. Đăng ký https://uptimerobot.com.
2. **Add New Monitor**:
   - Monitor Type: **HTTP(s)**
   - URL: `https://<địa-chỉ>/api/health`
   - Monitoring Interval: **5 minutes** (mức ngắn nhất của gói Free)
3. Thêm email nhận cảnh báo khi dịch vụ sập.

**Chỉ ping `/api/health`**: endpoint này không gọi tới Crossref/OpenAlex. Đừng ping `/api/sources` hoặc `/api/search`, vì chúng gọi API học thuật và tốn hạn mức.

### Lưu ý quan trọng

- **Giờ chạy miễn phí:** Render cho 750 giờ mỗi tháng. Chạy liên tục 24/7 trong tháng 31 ngày là 744 giờ, chỉ dư 6 giờ, và hạn mức tính theo cả workspace. Nếu bạn có thêm dịch vụ miễn phí khác trong cùng workspace, tổng giờ có thể vượt và **tất cả dịch vụ miễn phí bị tạm ngừng đến hết tháng**. Hãy chỉ chạy một dịch vụ miễn phí hoặc theo dõi mục Usage trên Render.
- **Băng thông:** gói Free có băng thông hằng tháng giới hạn; hết thì dịch vụ bị tạm ngừng nếu không có phương thức thanh toán. Mỗi lần xuất file hoặc tìm kiếm tốn băng thông.
- **UptimeRobot Free dành cho mục đích cá nhân, phi thương mại** (điều khoản từ 10/2024). Nếu bạn dùng cho mục đích kinh doanh, cần gói trả phí hoặc một dịch vụ ping khác.
- **Điều khoản nền tảng có thể thay đổi:** nếu Render hạn chế việc giữ dịch vụ miễn phí luôn thức bằng ping, cách này sẽ ngừng hiệu quả. Phương án thay thế là nâng lên gói trả phí nhỏ của Render (chạy liên tục, không ngủ).
- **Không có đăng nhập:** ai biết địa chỉ đều dùng được. Backend giới hạn số request theo IP (`RATE_LIMIT_PER_MINUTE`, mặc định 30/phút).

## 5. Trang quản trị `/admin` và giới hạn của gói Free

Mở `https://<địa-chỉ>/admin`, nhập `ADMIN_PASSWORD`: tab **Doanh thu** (doanh thu theo ngày/tháng, đơn hàng gần đây, tỷ lệ chuyển đổi; cần bật tài khoản) và tab **Lượt sử dụng** (số người dùng, lượt tìm).

**Lưu trữ:** nếu bạn đã đặt `DATABASE_URL` (mục 7.1) thì thống kê được lưu vào cùng PostgreSQL đó và **không mất khi khởi động lại hay deploy lại**; trang admin hiện thông báo màu xanh "lưu trong cơ sở dữ liệu". Nếu chưa có `DATABASE_URL`, thống kê ghi vào file trên ổ đĩa máy chủ; gói Free của Render dùng ổ đĩa tạm nên **số liệu bị xóa mỗi lần khởi động lại hoặc deploy lại** (trang admin hiện cảnh báo vàng). Số liệu cũ trong file không tự chuyển vào cơ sở dữ liệu. Doanh thu luôn lấy từ bảng đơn hàng nên chỉ cần có `DATABASE_URL` là bền.

## 6. Cập nhật sau này

Dịch vụ thường được bật tự động deploy khi bạn `git push` lên nhánh `main` (xem mục **Settings → Auto-Deploy** của dịch vụ để chắc chắn). Nếu không thấy deploy mới, bấm **Manual Deploy → Deploy latest commit** trong trang dịch vụ.

## 7. Tài khoản, hạng và thanh toán SePay (tùy chọn)

Mặc định tính năng này **tắt**: ai cũng dùng đầy đủ không giới hạn. Khi bật có bốn hạng:

| | Khách (chưa đăng nhập) | Miễn phí (đã đăng nhập) | Tiêu chuẩn | Pro |
|---|---|---|---|---|
| Lượt tìm mỗi ngày | `GUEST_DAILY_SEARCHES` (3) | `FREE_DAILY_SEARCHES` (10) | không giới hạn | không giới hạn |
| Kết quả tối đa mỗi nguồn | 20 | 50 | 200 | 500 |
| Xuất Excel/CSV | không | tối đa 50 dòng/file | không giới hạn | không giới hạn |
| Thư viện cá nhân | không | không | 200 bài | 5.000 bài |
| Lịch sử tìm kiếm | không | không | 20 lần | 50 lần |
| Xuất BibTeX/RIS | không | không | không | có |
| Xuất tài liệu tham khảo ra Word (.docx) | không | không | có | có |
| Dán danh sách DOI để lấy tài liệu tham khảo chuẩn | không | không | tối đa 100 DOI/lần | tối đa 500 DOI/lần |
| Sắp xếp/lọc theo số trích dẫn | không | không | có | có |
| Xếp hạng tạp chí Q1–Q4 (SJR) và lọc theo hạng | không | không | có | có |

Mọi hạng (kể cả khách) đều thấy **số trích dẫn** và **nhãn "đã bị rút lại"** trên từng bài, vì đây là thông tin giúp tránh trích nhầm. Hạng trả phí được thêm công cụ sắp xếp/lọc theo chúng. Việc khóa sắp xếp/lọc theo trích dẫn chỉ ở giao diện (dữ liệu đã nằm sẵn trong kết quả); xếp hạng Q, Word và tra DOI thì máy chủ kiểm tra quyền.

Hạng Tiêu chuẩn và Pro mua theo thời hạn 7 ngày, 1 tháng hoặc 1 năm (6 gói, giá ở `.env.example`). Mọi giới hạn nằm trong **một hàm** `buildEntitlements` ở `server/src/accounts/plans.ts`; sửa ở đó để đổi chính sách. Mỗi từ khóa trong một lần tìm tính một lượt; lần tìm mà không nguồn nào trả kết quả (hoặc bị hủy) được hoàn lại lượt. Khách được tính theo IP nên đổi mạng là có lượt mới; hãy coi đây là giới hạn mềm.

**Quy tắc khi mua nhiều gói:** mua thêm cùng hạng thì cộng dồn thời hạn. Mua Pro khi đang có Tiêu chuẩn: Pro dùng ngay, thời gian Tiêu chuẩn còn lại không bị mất mà được lùi thêm đúng bằng số ngày Pro vừa mua. Mua Tiêu chuẩn khi đang có Pro: bắt đầu tính sau khi Pro hết. Đăng nhập được nhớ khoảng 6 tháng trên mỗi trình duyệt và tự gia hạn khi còn dùng.

### 7.1. Cơ sở dữ liệu (bắt buộc khi chạy trên Render)

Render Free **xóa ổ đĩa mỗi lần khởi động lại**, nên không thể lưu tài khoản và đơn thanh toán ở đó (người dùng mất gói đã mua). Ứng dụng từ chối khởi động nếu bật tài khoản trên Render mà chưa có `DATABASE_URL`.

1. Tạo một PostgreSQL miễn phí ở [Neon](https://neon.tech) (hoặc Supabase). Chọn vùng gần Singapore.
2. Sao chép chuỗi kết nối (dạng `postgresql://user:pass@host/db?sslmode=require`).
3. Trên Render: **Environment** → thêm `DATABASE_URL` = chuỗi trên. Các bảng `pf_*` được tạo tự động ở lần khởi động đầu tiên.

### 7.2. Bật tài khoản

Trên Render, thêm biến môi trường:

| Biến | Giá trị |
|---|---|
| `SESSION_SECRET` | chuỗi ngẫu nhiên ≥ 32 ký tự: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DATABASE_URL` | xem 7.1 |
| `FREE_DAILY_SEARCHES`, `GUEST_DAILY_SEARCHES` | tùy chọn, mặc định 10 và 3 |
| `PRICE_STANDARD_WEEK/MONTH/YEAR`, `PRICE_PRO_WEEK/MONTH/YEAR` | tùy chọn, giá VND từng gói (mặc định 10.000 / 29.000 / 119.000 và 20.000 / 49.000 / 229.000) |

Đổi `SESSION_SECRET` sẽ đăng xuất mọi người. Nên bật `TRUST_PROXY=1` (đã có trong `render.yaml`) để cookie đăng nhập có cờ `Secure` và giới hạn theo IP đúng.

### 7.3. Thanh toán SePay (chuyển khoản QR)

Cách hoạt động: người dùng bấm mua, máy chủ tạo đơn với **mã 9 chữ số** và hiện mã VietQR (số tiền và nội dung `PF<mã đơn>` điền sẵn). Người dùng chuyển khoản như bình thường; [SePay](https://sepay.vn) theo dõi tài khoản ngân hàng của bạn và gọi **webhook** về máy chủ. Máy chủ đối chiếu nội dung chuyển khoản với đơn, kiểm tra đúng số tài khoản và số tiền, rồi kích hoạt gói. Trang thanh toán tự hỏi trạng thái mỗi 4 giây nên người dùng thấy gói bật ngay.

An toàn: webhook phải có header `Authorization: Apikey <SEPAY_API_KEY>` (sai thì bị từ chối 401); chỉ kích hoạt khi là **tiền vào**, đúng **số tài khoản** của bạn, số tiền **không thấp hơn** giá đơn (chuyển thừa vẫn kích hoạt, chuyển thiếu thì không); mỗi đơn chỉ cộng thời hạn **một lần** dù SePay gọi lặp. Đơn hiển thị 24 giờ; tiền về muộn hơn vẫn kích hoạt. Gói không tự động gia hạn.

Cài đặt:

1. Đăng ký [sepay.vn](https://sepay.vn), **liên kết tài khoản ngân hàng** nhận tiền (làm theo hướng dẫn của SePay cho ngân hàng của bạn).
2. Trên SePay: **Tích hợp → Webhooks → Thêm webhook**. Điền: URL gọi = `https://<địa-chỉ>/api/billing/sepay-webhook`; sự kiện = **có tiền vào**; kiểu chứng thực = **API Key**, giá trị là chuỗi bí mật bạn tự đặt (>= 8 ký tự).
3. Trên SePay: **Cấu hình công ty → Cấu trúc mã thanh toán**, đặt tiền tố trùng `SEPAY_CODE_PREFIX` (mặc định `PF`).
4. Trên Render thêm: `SEPAY_API_KEY` (đúng chuỗi ở bước 2), `SEPAY_BANK_ACCOUNT` (số tài khoản nhận; **BIDV và vài ngân hàng khác phải dùng số VA, xem bên dưới**), `SEPAY_BANK_NAME` (tên ngân hàng theo VietQR, vd. `MBBank`, `Vietcombank`, `ACB`; xem danh sách ở qr.sepay.vn), tùy chọn `SEPAY_ACCOUNT_NAME` (tên chủ tài khoản hiển thị) và `SEPAY_CODE_PREFIX`. Thiếu một trong ba biến đầu thì nút thanh toán bị tắt.
5. **Ngân hàng dùng tài khoản ảo (VA), điển hình là BIDV:** SePay chỉ nhận được thông báo khi tiền chuyển vào **đúng VA** (mở my.sepay.vn → Ngân hàng → chọn tài khoản → mục Tài khoản ảo → Xem chi tiết, xem dòng "Tài khoản nhận thanh toán"). Chuyển thẳng vào số tài khoản chính thì SePay không biết nên webhook không bao giờ được gọi. Khi đó đặt `SEPAY_BANK_ACCOUNT` = số **VA** (có thể có chữ cái, vd. `96247NJ49C`; mã QR sẽ dùng số này) và `SEPAY_ACCOUNT_ALIASES` = số tài khoản chính (nhiều số cách nhau bằng dấu phẩy), vì SePay có thể báo giao dịch theo số chính hoặc theo VA; ứng dụng chấp nhận cả hai. Giao dịch bị từ chối vì lệch tài khoản được ghi log `payment_needs_attention` kèm 4 ký tự cuối của số tài khoản SePay đã báo để bạn thêm vào `SEPAY_ACCOUNT_ALIASES`.
6. **Thử trước khi bán:** đặt tạm `PRICE_STANDARD_WEEK=2000`, mua một đơn và chuyển khoản thật số tiền đó, kiểm tra hạng tự bật, rồi trả giá về như cũ.

**Thử ở máy local, không cần tiền thật:** thêm vào `.env` giá trị bất kỳ cho `SEPAY_API_KEY`, `SEPAY_BANK_ACCOUNT`, `SEPAY_BANK_NAME`, chạy `npm run dev`, đăng ký tài khoản, bấm mua để hiện mã QR, rồi ở cửa sổ lệnh khác chạy:

```powershell
npm run sepay:simulate -- <mã đơn 9 chữ số> <số tiền>
```

Trang thanh toán sẽ tự chuyển sang "Thanh toán thành công". Thử thêm các trường hợp lỗi: `--key sai` (bị từ chối 401), số tiền thấp hơn giá đơn (không kích hoạt), `--account 111` (lệch tài khoản), `--id <số>` lặp lại cùng giá trị (không cộng lần hai), `--out` (tiền ra, bị bỏ qua). Mã QR thật vẫn hiện (ảnh do qr.sepay.vn dựng) nhưng quét chỉ có ý nghĩa với tài khoản thật.

Đối soát: khoản tiền vào **không khớp đơn nào** (sai nội dung, thiếu tiền, lệch tài khoản) được ghi log mức cảnh báo `payment_needs_attention` kèm mã giao dịch; hãy xem log định kỳ và cấp gói thủ công (mục 7.5) hoặc hoàn tiền. Giao diện SePay cũng liệt kê mọi giao dịch để đối chiếu.

> Phần SePay được viết theo tài liệu webhook công khai của SePay và kiểm thử bằng giao dịch giả lập (đúng định dạng payload) trong mã nguồn, **chưa được thử với SePay thật**. Hãy làm bước thử ở mục 7.3 (bước 6) và xem log `payment_needs_attention` nếu đơn không tự kích hoạt. Khi thử, phải **quét mã QR trên trang** (hoặc chuyển vào đúng số hiện trên trang); chuyển vào số khác thì SePay không báo về.

### 7.4. Gửi email quên mật khẩu (SMTP)

Nút "Quên mật khẩu?" ở hộp đăng nhập chỉ hiện khi máy chủ gửi được email. Cần một dịch vụ SMTP; cách nhanh và miễn phí nhất là dùng Gmail của bạn:

1. Bật xác minh 2 bước cho tài khoản Google, rồi vào [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) tạo **mật khẩu ứng dụng** (16 ký tự). Không dùng mật khẩu Gmail thật.
2. Trên Render thêm biến:

| Biến | Giá trị |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | địa chỉ Gmail của bạn |
| `SMTP_PASS` | mật khẩu ứng dụng ở bước 1 |
| `SMTP_FROM` | `PaperFinder <địa-chỉ-gmail>` |
| `PUBLIC_BASE_URL` | địa chỉ trang, vd. `https://paperfinder.onrender.com` (không có dấu `/` cuối) |

Gmail giới hạn khoảng 500 thư mỗi ngày và thư dễ vào hộp thư rác hơn gửi từ tên miền riêng. Khi có tên miền, nên chuyển sang Brevo, Mailgun hoặc Resend (đều có gói miễn phí và thông tin SMTP tương tự, chỉ cần đổi 4 biến `SMTP_*`).

Cách hoạt động và an toàn: liên kết có hiệu lực **1 giờ** và **chỉ dùng được một lần** (đổi mật khẩu xong, hoặc người dùng tự đổi bằng cách khác, là liên kết cũ vô hiệu); mọi phiên đăng nhập cũ bị đăng xuất. Hệ thống trả lời giống nhau dù email có tài khoản hay không (không lộ ai đã đăng ký), mỗi email chỉ nhận một thư mỗi phút và mỗi địa chỉ IP tối đa 5 yêu cầu mỗi giờ. Liên kết do máy chủ ký bằng `SESSION_SECRET`, không lưu trong cơ sở dữ liệu; đổi `SESSION_SECRET` sẽ làm các liên kết chưa dùng mất hiệu lực. Thư gửi lỗi được ghi log `password_reset_mail_failed`.

**Thử ở máy local không cần SMTP:** chạy `npm run dev`, bấm "Quên mật khẩu?" và nhập email đã đăng ký. Nội dung thư (kèm liên kết `http://localhost:5173/?reset=...`) được ghi vào cửa sổ chạy backend ở dòng `mail_console`; sao chép liên kết đó vào trình duyệt.

### 7.5. Cấp gói thủ công và xem thống kê tài khoản

Cần `ADMIN_PASSWORD`. Ví dụ cấp 30 ngày hạng Pro (`tier` là `standard` hoặc `pro`, mặc định `pro`) bằng PowerShell:

```powershell
$h = @{ Authorization = "Bearer <ADMIN_PASSWORD>"; "Content-Type" = "application/json" }
Invoke-RestMethod -Method Post -Uri https://<địa-chỉ>/api/admin/grant -Headers $h -Body '{"email":"nguoidung@example.com","tier":"pro","days":30}'
Invoke-RestMethod -Uri https://<địa-chỉ>/api/admin/accounts -Headers $h   # số người dùng, số người đang dùng từng hạng, doanh thu
```

### 7.5. Xếp hạng tạp chí Q1–Q4 (SJR) — cần bạn nạp dữ liệu

Ứng dụng **không kèm sẵn** dữ liệu xếp hạng vì nó thuộc SCImago (dựa trên dữ liệu Scopus của Elsevier) và điều khoản sử dụng/phân phối lại chưa được tôi xác nhận. Cách làm: bạn tự vào [scimagojr.com](https://www.scimagojr.com/journalrank.php), **đọc điều khoản sử dụng của họ**, chọn năm rồi bấm tải file CSV ("Download data"), và đặt vào `server/data/scimagojr.csv` (hoặc đường dẫn khác qua biến `SJR_CSV_PATH`). Khởi động lại máy chủ; log `server_started` sẽ có `journalRank` là số tạp chí đã nạp. Không có file thì tính năng tự tắt và không được quảng cáo trong hộp thoại chọn gói. Hạng được ghép theo **ISSN** nên tạp chí thiếu ISSN hoặc không có trong file sẽ không có hạng. Hạng thay đổi theo năm: hãy cập nhật file hằng năm và ghi rõ năm dữ liệu cho người dùng nếu cần. Trên Render, thư mục `server/data` bị xóa khi khởi động lại, nên cần đưa file vào bản deploy (ví dụ bỏ file khỏi `.gitignore` và commit nếu điều khoản cho phép) hoặc dùng ổ đĩa bền.

### 7.6. Việc cần làm ngoài mã nguồn

- Cập nhật **chính sách bảo mật** nếu bạn đổi cách xử lý dữ liệu (mặc định đã mô tả email, mật khẩu băm, cookie phiên, thư viện và lịch sử).
- Kinh doanh thu tiền cần tuân thủ quy định đăng ký kinh doanh và thuế tại Việt Nam; hãy hỏi kế toán hoặc cơ quan thuế.
- Chưa có chức năng **quên mật khẩu qua email** (cần dịch vụ gửi mail). Hiện người dùng đã đăng nhập đổi được mật khẩu trong menu tài khoản; người quên mật khẩu cần bạn hỗ trợ thủ công.
