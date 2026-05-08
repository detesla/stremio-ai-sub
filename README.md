# Stremio AI Subtitles Add-on

Add-on Stremio giúp tạo phụ đề tiếng Việt bằng AI (Gemini Pro & Groq Llama 3) hoàn toàn miễn phí.

## Tính năng
- Dịch phụ đề từ tiếng Anh sang tiếng Việt bằng AI.
- Hỗ trợ 2 model AI mạnh nhất hiện nay: **Gemini 1.5 Pro** và **Llama 3 (70B)** qua Groq.
- Cho phép chuyển đổi linh hoạt giữa 2 model ngay trong lúc xem phim.
- Có hệ thống cache để tiết kiệm API Quota.

## Cách cài đặt

### 1. Chuẩn bị API Keys (Tất cả đều miễn phí)
- **Gemini API Key**: Lấy tại [Google AI Studio](https://aistudio.google.com/).
- **Groq API Key**: Lấy tại [Groq Console](https://console.groq.com/).
- **OpenSubtitles API Key**: Lấy tại [OpenSubtitles.com API](https://www.opensubtitles.com/en/consumers).

### 2. Cấu hình
- Tạo file `.env` từ file `.env.example`.
- Điền các API Keys bạn vừa lấy được vào.

### 3. Chạy Add-on
Mở terminal tại thư mục này và chạy:
```bash
npm start
```
Add-on sẽ chạy mặc định tại `http://localhost:7000/manifest.json`.

### 4. Thêm vào Stremio
- Mở Stremio.
- Vào phần **Add-ons**.
- Dán link `http://localhost:7000/manifest.json` vào ô tìm kiếm và nhấn **Install**.

## Lưu ý
- Lần đầu chọn phụ đề AI sẽ mất khoảng 30-60 giây để AI dịch. Các lần sau sẽ load ngay lập tức nhờ bộ nhớ đệm (cache).
- Gemini 1.5 Pro có chất lượng dịch tốt hơn nhưng giới hạn 2 lần gọi/phút. Groq Llama 3 nhanh hơn và quota thoải mái hơn.
