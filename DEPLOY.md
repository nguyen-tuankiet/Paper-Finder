# Triển khai PaperFinder lên Render (miễn phí) + UptimeRobot

Một dịch vụ duy nhất phục vụ cả giao diện lẫn API, nên **không cần** `CORS_ORIGIN` hay `VITE_API_BASE_URL`.

> Gói miễn phí của các nền tảng thay đổi thường xuyên. Các số liệu dưới đây ghi nhận ngày 25/10/2026; hãy xem lại https://render.com/docs/free và https://uptimerobot.com/pricing trước khi triển khai.

## 1. Đưa mã nguồn lên GitHub

Render lấy mã từ GitHub. Mã đã được commit sẵn trong thư mục này (`git log` để xem). Bạn cần:

1. Tạo một repository **trống** trên GitHub (ví dụ `paperfinder`, không thêm README/.gitignore).
2. Ở thư mục dự án, chạy (thay `<tên-bạn>`):

```powershell
git branch -M main
git remote add origin https://github.com/<tên-bạn>/paperfinder.git
git push -u origin main
```

File `.env` được `.gitignore` bỏ qua nên **key bí mật không bị đưa lên GitHub**. Nếu repo là public, mã nguồn sẽ công khai; chọn Private nếu bạn không muốn.

## 2. Lấy key OpenAlex (nên làm trước)

Render dùng chung địa chỉ IP gửi đi cho nhiều khách hàng, trong khi OpenAlex tính hạn mức không-key theo IP, nên nguồn OpenAlex có thể báo hết hạn mức ngay. Lấy key miễn phí tại https://openalex.org/settings/api (cần tài khoản).

## 3. Tạo dịch vụ trên Render

1. Đăng nhập https://dashboard.render.com bằng GitHub.
2. **New → Blueprint**, chọn repository `paperfinder`. Render đọc file `render.yaml` và tạo sẵn dịch vụ.
3. Khi được hỏi các biến bí mật, điền:
   - `OPENALEX_API_KEY`: key ở bước 2.
   - `CONTACT_EMAIL`: email liên hệ cho Crossref (tùy chọn, có thể để trống).
   - `SEMANTIC_SCHOLAR_API_KEY`: để trống nếu không có (nguồn Semantic Scholar sẽ không được bật).
4. Bấm **Apply** và chờ build xong (vài phút). Địa chỉ có dạng `https://paperfinder-xxxx.onrender.com`.
5. Kiểm tra: mở `https://<địa-chỉ>/api/health` phải thấy `{"status":"ok"}`, rồi mở trang chủ và thử tìm kiếm.

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

## 5. Cập nhật sau này

Mỗi lần bạn `git push` lên nhánh `main`, Render tự build và deploy lại.
