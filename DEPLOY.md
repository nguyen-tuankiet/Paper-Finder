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

Mở `https://<địa-chỉ>/admin`, nhập `ADMIN_PASSWORD` để xem số người dùng và số lượt tìm.

**Quan trọng:** thống kê được ghi vào một file trên ổ đĩa của máy chủ. Gói Free của Render dùng ổ đĩa tạm, nên **số liệu bị xóa mỗi khi dịch vụ khởi động lại hoặc deploy lại** (Render có thể khởi động lại dịch vụ bất cứ lúc nào, và mỗi lần bạn `git push` cũng deploy lại). Hãy xem số liệu như "từ lần khởi động gần nhất". Muốn giữ lâu dài cần ổ đĩa bền (gói trả phí của Render có Persistent Disk) hoặc lưu thống kê ra một dịch vụ bên ngoài; hiện ứng dụng chưa hỗ trợ cách thứ hai.

## 6. Cập nhật sau này

Dịch vụ thường được bật tự động deploy khi bạn `git push` lên nhánh `main` (xem mục **Settings → Auto-Deploy** của dịch vụ để chắc chắn). Nếu không thấy deploy mới, bấm **Manual Deploy → Deploy latest commit** trong trang dịch vụ.

## 7. Tài khoản, hạng và thanh toán PayOS (tùy chọn)

Mặc định tính năng này **tắt**: ai cũng dùng đầy đủ không giới hạn. Khi bật có bốn hạng:

| | Khách (chưa đăng nhập) | Miễn phí (đã đăng nhập) | Tiêu chuẩn | Pro |
|---|---|---|---|---|
| Lượt tìm mỗi ngày | `GUEST_DAILY_SEARCHES` (3) | `FREE_DAILY_SEARCHES` (10) | không giới hạn | không giới hạn |
| Kết quả tối đa mỗi nguồn | 20 | 50 | 200 | 500 |
| Xuất Excel/CSV | không | tối đa 50 dòng/file | không giới hạn | không giới hạn |
| Thư viện cá nhân | không | không | 200 bài | 5.000 bài |
| Lịch sử tìm kiếm | không | không | 20 lần | 50 lần |
| Xuất BibTeX/RIS | không | không | không | có |

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
| `PRICE_STANDARD_WEEK/MONTH/YEAR`, `PRICE_PRO_WEEK/MONTH/YEAR` | tùy chọn, giá VND từng gói (mặc định 15.000 / 39.000 / 299.000 và 29.000 / 79.000 / 599.000) |

Đổi `SESSION_SECRET` sẽ đăng xuất mọi người. Nên bật `TRUST_PROXY=1` (đã có trong `render.yaml`) để cookie đăng nhập có cờ `Secure` và giới hạn theo IP đúng.

### 7.3. Thanh toán PayOS

1. Đăng ký tài khoản và tạo **kênh thanh toán** tại [payos.vn](https://payos.vn), liên kết tài khoản ngân hàng nhận tiền.
2. Lấy **Client ID**, **API Key**, **Checksum Key** của kênh.
3. Trên Render thêm: `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` và `PUBLIC_BASE_URL` (địa chỉ công khai, vd. `https://paperfinder.onrender.com`, không có dấu `/` cuối). Thiếu một trong bốn thì nút thanh toán bị tắt.
4. Trong cài đặt kênh PayOS, đặt **Webhook URL** = `https://<địa-chỉ>/api/billing/payos-webhook`.
5. **Thử trước khi bán:** tạo một đơn nhỏ (có thể đặt tạm `PRICE_STANDARD_WEEK=2000`), thanh toán thật, kiểm tra hạng tự bật, rồi trả giá về như cũ.

Cách hoạt động và an toàn: khi người dùng bấm thanh toán, máy chủ tạo đơn và link PayOS. Sau khi trả tiền, PayOS gọi webhook và đưa người dùng về trang. **Máy chủ không tin nội dung webhook**: nó chỉ lấy mã đơn rồi hỏi lại PayOS trạng thái thật và số tiền đã nhận, chỉ kích hoạt khi đã trả đủ, và chỉ cộng thời hạn **một lần** cho mỗi đơn (webhook gọi lặp hay trang quay lại gọi cùng lúc đều an toàn). Gói không tự động gia hạn.

> Phần tích hợp PayOS được viết theo tài liệu công khai của PayOS và kiểm thử bằng PayOS giả trong mã nguồn, **chưa được thử với PayOS thật**. Hãy làm bước thử ở mục 7.3.5 và xem log `checkout_failed` / `confirm_failed` nếu có lỗi.

### 7.4. Cấp gói thủ công và xem thống kê tài khoản

Cần `ADMIN_PASSWORD`. Ví dụ cấp 30 ngày hạng Pro (`tier` là `standard` hoặc `pro`, mặc định `pro`) bằng PowerShell:

```powershell
$h = @{ Authorization = "Bearer <ADMIN_PASSWORD>"; "Content-Type" = "application/json" }
Invoke-RestMethod -Method Post -Uri https://<địa-chỉ>/api/admin/grant -Headers $h -Body '{"email":"nguoidung@example.com","tier":"pro","days":30}'
Invoke-RestMethod -Uri https://<địa-chỉ>/api/admin/accounts -Headers $h   # số người dùng, số người đang dùng từng hạng, doanh thu
```

### 7.5. Việc cần làm ngoài mã nguồn

- Cập nhật **chính sách bảo mật** nếu bạn đổi cách xử lý dữ liệu (mặc định đã mô tả email, mật khẩu băm, cookie phiên, thư viện và lịch sử).
- Kinh doanh thu tiền cần tuân thủ quy định đăng ký kinh doanh và thuế tại Việt Nam; hãy hỏi kế toán hoặc cơ quan thuế.
- Chưa có chức năng **quên mật khẩu qua email** (cần dịch vụ gửi mail). Hiện người dùng đã đăng nhập đổi được mật khẩu trong menu tài khoản; người quên mật khẩu cần bạn hỗ trợ thủ công.
