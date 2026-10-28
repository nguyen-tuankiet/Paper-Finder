import { Collapse, Modal, Typography } from 'antd';
import type { ReactNode } from 'react';
import { AUTHOR } from '../lib/author';

export type InfoKind = 'guide' | 'faq' | 'privacy';

const TITLES: Record<InfoKind, string> = {
  guide: 'Hướng dẫn sử dụng',
  faq: 'Câu hỏi thường gặp',
  privacy: 'Chính sách bảo mật',
};

const GUIDE_STEPS: { title: string; body: ReactNode }[] = [
  {
    title: 'Nhập từ khóa và chọn nguồn',
    body: 'Gõ một từ khóa, hoặc chuyển sang “Nhiều từ khóa” và nhập mỗi dòng một từ khóa (tối đa 10). Chọn nguồn dữ liệu (mặc định là tất cả), số kết quả tối đa cho mỗi từ khóa trên mỗi nguồn, khoảng năm xuất bản, và có chỉ lấy bài có DOI hay không. Bấm “Tìm bài báo”; có thể bấm “Hủy tìm kiếm” bất cứ lúc nào.',
  },
  {
    title: 'Xem và lọc kết quả',
    body: 'Phần thống kê cho biết tổng số bài, bài có DOI, bài có bản miễn phí và số bài trùng đã được loại. Nhấp tên bài để mở trang gốc, nhấp DOI để mở doi.org. Dùng ô tìm trong kết quả và các bộ lọc (DOI, nguồn, truy cập, loại tài liệu); bấm tiêu đề cột “Năm” để sắp xếp.',
  },
  {
    title: 'Đọc miễn phí hoặc tới trang nhà xuất bản',
    body: 'Cột “Truy cập” cho biết bài có bản đọc miễn phí hợp pháp (truy cập mở) hay chưa. Bài miễn phí có nút “Tải PDF” hoặc “Đọc toàn văn”; bài chưa thấy bản miễn phí có nút “Trang nhà xuất bản” để xem quyền truy cập hoặc giá.',
  },
  {
    title: 'Sao chép tài liệu tham khảo',
    body: 'Ở dòng “Tài liệu tham khảo” phía trên bảng, chọn kiểu IEEE, APA 7, Mẫu cơ bản hoặc Tùy chỉnh (tự soạn mẫu) rồi bấm sao chép. Tick chọn bài để chỉ lấy các bài đó, hoặc để trống để lấy toàn bộ kết quả đang lọc. Mỗi dòng có nút “Trích dẫn” cho từng bài.',
  },
  {
    title: 'Xuất danh sách',
    body: 'Trong khung “Xuất danh sách”, chọn xuất kết quả đang lọc, bài đã chọn hoặc tất cả (có thể chỉ lấy bài có DOI) rồi bấm “Xuất Excel” hoặc “Xuất CSV”. File gồm đầy đủ mọi dòng, không chỉ trang đang xem.',
  },
  {
    title: 'Tài khoản và các hạng (nếu trang bật tính năng này)',
    body: 'Khách (chưa đăng nhập) bị giới hạn nhiều nhất: ít lượt tìm mỗi ngày, ít kết quả mỗi nguồn và không xuất được file. Tạo tài khoản miễn phí (chỉ cần email và mật khẩu, xong là đăng nhập luôn) để có thêm lượt và xuất file (tối đa 50 dòng). Hạng Tiêu chuẩn và Pro bỏ giới hạn lượt tìm, lấy nhiều kết quả hơn, xuất không giới hạn dòng; có thêm thư viện cá nhân (nút “Lưu” ở mỗi bài) và lịch sử tìm kiếm; riêng Pro có xuất BibTeX/RIS cho Zotero, Mendeley, EndNote.',
  },
  {
    title: 'Số trích dẫn, bài bị rút lại, xếp hạng tạp chí',
    body: 'Mỗi bài có cột “Trích dẫn” (số lớn nhất giữa các nguồn; mỗi nguồn đếm khác nhau nên có thể lệch so với Google Scholar). Bài đã bị rút lại được gắn nhãn đỏ “Đã bị rút lại” và có cảnh báo phía trên bảng; nên tránh trích dẫn. Nếu trang có dữ liệu xếp hạng, tạp chí được gắn nhãn Q1–Q4 theo SCImago (SJR) và có thể lọc. Từ hạng Tiêu chuẩn có thể sắp xếp và lọc theo trích dẫn và hạng tạp chí.',
  },
  {
    title: 'Chuẩn hóa danh sách DOI và xuất file Word',
    body: 'Ở khung “Chuẩn hóa danh sách DOI” (hạng Tiêu chuẩn trở lên), dán mỗi dòng một DOI hoặc link doi.org, hoặc cả đoạn tài liệu tham khảo; hệ thống lấy thông tin từng bài và trả về như một kết quả tìm kiếm để bạn sao chép trích dẫn hoặc xuất. Nút “Tài liệu tham khảo (.docx)” trong khung xuất tạo file Word đã dàn trang theo kiểu trích dẫn bạn đang chọn (IEEE, APA 7, mẫu cơ bản hoặc tự soạn).',
  },
  {
    title: 'Xử lý bài nghi trùng',
    body: 'Các bài cùng tiêu đề nhưng chưa đủ bằng chứng để tự gộp sẽ nằm ở mục “Nghi trùng cần xem”. Bấm “Xử lý” ngay trên ô đó để giữ cả hai hoặc loại bỏ một bản khỏi danh sách và file xuất.',
  },
];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: 'Dữ liệu lấy từ đâu?',
    a: 'Từ metadata công khai của Crossref, OpenAlex, Europe PMC, DOAJ và arXiv (cùng Semantic Scholar nếu máy chủ được cấu hình). Kết quả không bao phủ toàn bộ tài liệu khoa học trên thế giới.',
  },
  {
    q: 'Vì sao một số bài thiếu tác giả, abstract, tập, số hoặc trang?',
    a: 'Do nguồn không cung cấp. Ứng dụng không tự suy đoán hay bịa dữ liệu; phần nào thiếu sẽ để trống hoặc bỏ qua khi ghi trích dẫn.',
  },
  {
    q: 'Vì sao chọn arXiv và “Chỉ lấy bài có DOI” lại ít kết quả?',
    a: 'Nhiều bài trên arXiv là preprint chưa có DOI. Bỏ chọn “Chỉ lấy bài có DOI” để lấy đầy đủ hơn.',
  },
  {
    q: '“Miễn phí” nghĩa là gì? “Chưa thấy bản miễn phí” có phải là mất phí?',
    a: '“Miễn phí” nghĩa là có ít nhất một nguồn xác nhận bài có bản truy cập mở hợp pháp. “Chưa thấy bản miễn phí” chỉ nghĩa là các nguồn chưa cho biết có bản mở; bài vẫn có thể đọc được qua thư viện, trường học, hoặc nguồn chưa cập nhật.',
  },
  {
    q: 'Bấm “Tải PDF” mà file không tải về, chỉ mở một tab mới?',
    a: 'Một số nhà xuất bản chặn tải tự động từ máy chủ (HTTP 403) nên PaperFinder phải mở link gốc. Hãy lưu từ trình xem PDF (nút lưu hoặc Ctrl+S), hoặc bật cài đặt “Luôn tải xuống tệp PDF” trong trình duyệt để mọi link PDF tải thẳng về máy.',
  },
  {
    q: 'Tài liệu tham khảo sao chép ra có chính xác tuyệt đối không?',
    a: 'Chúng được dựng từ metadata của nguồn nên có thể thiếu hoặc sai ở vài trường hợp (ví dụ tên tác giả Việt Nam không tách được họ và tên, tiêu đề chưa viết hoa theo kiểu APA). Hãy đối chiếu với bài gốc trước khi đưa vào báo cáo.',
  },
  {
    q: 'Vì sao tôi bị giới hạn? Mua gói thế nào?',
    a: 'Để duy trì chi phí máy chủ và tôn trọng giới hạn của các nguồn dữ liệu, khách và thành viên miễn phí có số lượt tìm cố định mỗi ngày, đặt lại vào 0 giờ (giờ Việt Nam). Lần tìm không có nguồn nào trả kết quả hoặc bị hủy sẽ được hoàn lại lượt. Có hai hạng trả phí là Tiêu chuẩn và Pro, mỗi hạng mua 7 ngày, 1 tháng hoặc 1 năm bằng chuyển khoản QR qua PayOS; gói tự kích hoạt sau khi nhận tiền và không tự động gia hạn. Mua thêm cùng hạng thì cộng dồn; mua Pro khi đang có Tiêu chuẩn thì Pro dùng ngay và thời gian Tiêu chuẩn còn lại được giữ để dùng tiếp sau đó. Khi gói hết hạn, dữ liệu thư viện và lịch sử vẫn được giữ và xem lại được khi bạn mua lại.',
  },
  {
    q: 'Có một nguồn báo lỗi hoặc hết hạn mức thì sao?',
    a: 'Mỗi nguồn được truy vấn độc lập. Nguồn lỗi sẽ có cảnh báo riêng, kết quả từ các nguồn còn lại vẫn hiển thị.',
  },
];

function GuideContent() {
  return (
    <ol className="pf-info-steps">
      {GUIDE_STEPS.map((s) => (
        <li key={s.title}>
          <Typography.Text strong>{s.title}</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ margin: '2px 0 0' }}>
            {s.body}
          </Typography.Paragraph>
        </li>
      ))}
    </ol>
  );
}

function PrivacyContent() {
  return (
    <div className="pf-info-text">
      <Typography.Paragraph>PaperFinder được thiết kế để thu thập dữ liệu ở mức tối thiểu.</Typography.Paragraph>
      <Typography.Title level={5}>Dữ liệu tìm kiếm</Typography.Title>
      <Typography.Paragraph>
        Từ khóa và bộ lọc bạn nhập chỉ được dùng để gửi truy vấn tới các nguồn học thuật (Crossref, OpenAlex, Europe PMC, DOAJ, arXiv...) thông qua máy chủ của PaperFinder. Máy chủ <b>không ghi từ khóa vào nhật ký, không lưu thành lịch sử tìm kiếm</b>. Nội dung truy vấn và kết quả chỉ được giữ tạm trong bộ nhớ (bộ nhớ đệm, mặc định khoảng 10 phút) để tăng tốc cho các lần tìm trùng, rồi tự xóa.
      </Typography.Paragraph>
      <Typography.Paragraph>
        Khi bạn xuất file hoặc bấm “Tải PDF”, danh sách bài hoặc file PDF chỉ đi qua máy chủ để tạo file hay chuyển tiếp, và <b>không được lưu lại</b>. Địa chỉ IP được dùng tạm trong bộ nhớ để giới hạn tốc độ truy cập, không lưu lâu dài.
      </Typography.Paragraph>
      <Typography.Title level={5}>Thống kê sử dụng ẩn danh</Typography.Title>
      <Typography.Paragraph>
        Để biết ứng dụng có người dùng hay không, máy chủ chỉ ghi <b>số đếm theo ngày</b> (số lượt tìm, lượt xuất file, nguồn được dùng) và một <b>mã băm một chiều</b> của địa chỉ IP kết hợp trình duyệt để đếm số người khác nhau. Địa chỉ IP gốc không được lưu và không thể suy ngược từ mã băm.
      </Typography.Paragraph>
      <Typography.Title level={5}>Tài khoản và gói trả phí (khi trang bật tính năng này)</Typography.Title>
      <Typography.Paragraph>
        Nếu bạn tạo tài khoản, PaperFinder lưu <b>email</b>, <b>mật khẩu đã băm một chiều</b> (không lưu mật khẩu gốc), thời hạn gói đã mua và số lượt tìm đã dùng trong ngày. Một <b>cookie phiên đăng nhập</b> (HttpOnly, nhớ khoảng 6 tháng và tự gia hạn khi bạn còn dùng) được đặt để bạn không phải đăng nhập lại; cookie này chỉ dùng để đăng nhập, không dùng để theo dõi. Đăng xuất sẽ xóa nó. Khách chưa đăng nhập được tính lượt theo mã băm một chiều của địa chỉ IP, giữ tạm trong bộ nhớ.
      </Typography.Paragraph>
      <Typography.Paragraph>
        Từ hạng Tiêu chuẩn, <b>thư viện</b> (các bài bạn bấm “Lưu”) và <b>lịch sử tìm kiếm</b> (điều kiện tìm: từ khóa, nguồn, khoảng năm — không gồm kết quả; giữ 20 lần gần nhất với Tiêu chuẩn, 50 với Pro) được lưu gắn với tài khoản để bạn xem lại; bạn xóa được bất cứ lúc nào. Đây là ngoại lệ của câu “không lưu từ khóa thành lịch sử” ở trên, và chỉ áp dụng cho tài khoản trả phí.
      </Typography.Paragraph>
      <Typography.Paragraph>
        Thanh toán do <b>PayOS</b> xử lý trên trang của họ; PaperFinder không nhận hay lưu số thẻ/tài khoản ngân hàng của bạn, chỉ lưu mã đơn, số tiền và trạng thái thanh toán để kích hoạt gói.
      </Typography.Paragraph>
      <Typography.Title level={5}>Dữ liệu trên trình duyệt của bạn</Typography.Title>
      <Typography.Paragraph>
        Ứng dụng lưu vài lựa chọn giao diện (kiểu trích dẫn, mẫu bạn tự soạn, trạng thái đóng/mở khung tham khảo) trong bộ nhớ cục bộ của trình duyệt. Dữ liệu này nằm trên máy bạn và không gửi đi đâu. Ứng dụng không dùng cookie theo dõi hay công cụ phân tích của bên thứ ba.
      </Typography.Paragraph>
      <Typography.Title level={5}>Liên kết bên ngoài</Typography.Title>
      <Typography.Paragraph>
        Khi bạn bấm vào bài báo, DOI, PDF hoặc các liên kết ở chân trang, bạn sẽ rời PaperFinder và chịu chính sách của trang đích. Dịch vụ lưu trữ máy chủ có thể ghi nhật ký truy cập theo chính sách riêng của họ.
      </Typography.Paragraph>
      <Typography.Title level={5}>Liên hệ</Typography.Title>
      <Typography.Paragraph>
        Mọi thắc mắc về dữ liệu, vui lòng liên hệ tác giả qua{' '}
        <a href={AUTHOR.github} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        .
      </Typography.Paragraph>
    </div>
  );
}

/** Hộp thoại nội dung tĩnh của chân trang (hướng dẫn, câu hỏi thường gặp, chính sách bảo mật). */
export function InfoModal({ kind, onClose }: { kind: InfoKind | null; onClose: () => void }) {
  return (
    <Modal
      open={kind !== null}
      onCancel={onClose}
      footer={null}
      centered
      width={720}
      title={kind ? TITLES[kind] : ''}
      destroyOnHidden
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto', paddingRight: 8 } }}
    >
      {kind === 'guide' && <GuideContent />}
      {kind === 'faq' && <Collapse accordion bordered={false} items={FAQ.map((f, i) => ({ key: String(i), label: f.q, children: <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{f.a}</Typography.Paragraph> }))} />}
      {kind === 'privacy' && <PrivacyContent />}
    </Modal>
  );
}
