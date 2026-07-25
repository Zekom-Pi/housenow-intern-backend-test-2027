Đã kiểm thử endpoint `POST /api/bookings` với các trường hợp sau:

- **201 Created** – Tạo booking thành công.
  - Request:
    ```json
    {
      "userId": 1,
      "slotId": 10,
      "idempotencyKey": "booking-user1-slot10"
    }
    ```
  - Response:
    ```json
    {
      "id": 1,
      "userId": 1,
      "slotId": 10,
      "status": "CONFIRMED"
    }
    ```

- **200 OK** – Retry cùng `idempotencyKey`, không tạo booking mới.
  - Request:
    ```json
    {
      "userId": 2,
      "slotId": 12,
      "idempotencyKey": "retry-test"
    }
    ```
  - Kết quả:
    - Lần 1: `201 Created`
    - Lần 2: `200 OK`, trả về booking đã tạo ở lần đầu.

- **400 Bad Request** – Dữ liệu đầu vào không hợp lệ.
  - Ví dụ:
    ```json
    {
      "userId": "1",
      "slotId": 10,
      "idempotencyKey": "k1"
    }
    ```
  - Response:
    ```json
    {
      "code": "VALIDATION_ERROR",
      "message": "userId, slotId and idempotencyKey are required"
    }
    ```

- **404 Not Found** – Người dùng không tồn tại.
  - Request:
    ```json
    {
      "userId": 999,
      "slotId": 10,
      "idempotencyKey": "k2"
    }
    ```
  - Response:
    ```json
    {
      "code": "USER_NOT_FOUND",
      "message": "User was not found"
    }
    ```

- **404 Not Found** – Slot không tồn tại.
  - Request:
    ```json
    {
      "userId": 1,
      "slotId": 999,
      "idempotencyKey": "k3"
    }
    ```
  - Response:
    ```json
    {
      "code": "SLOT_NOT_FOUND",
      "message": "Slot was not found"
    }
    ```

- **409 Conflict** – Slot đã hết chỗ.
  - Request:
    ```json
    {
      "userId": 1,
      "slotId": 11,
      "idempotencyKey": "k4"
    }
    ```
  - Response:
    ```json
    {
      "code": "SLOT_FULL",
      "message": "Slot is fully booked"
    }
    ```

- **409 Conflict** – Người dùng đã đặt slot này trước đó.
  - Lần 1:
    ```json
    {
      "userId": 1,
      "slotId": 12,
      "idempotencyKey": "booking-1"
    }
    ```
    → `201 Created`

  - Lần 2:
    ```json
    {
      "userId": 1,
      "slotId": 12,
      "idempotencyKey": "booking-2"
    }
    ```
    → Response:
    ```json
    {
      "code": "ALREADY_BOOKED",
      "message": "User already booked this slot"
    }
    ```

- **500 Internal Server Error** – Các lỗi ngoài dự kiến trong transaction hoặc cơ sở dữ liệu.
  - Response:
    ```json
    {
      "code": "INTERNAL_ERROR",
      "message": "Unexpected booking error"
    }

# HouseNow Backend Intern Mini Test 2027

Hoàn thiện endpoint đặt chỗ trong starter project này.

## Phạm vi

- Thời gian đề xuất: **90 phút**.
- Stack bắt buộc: **Node.js 22.12+**, **TypeScript**, **TanStack Start/Router**
  và **Kysely**.
- Được sử dụng tài liệu và công cụ AI.
- Không thay framework, query builder, database schema, tests hoặc API contract.
- Không cần làm frontend, authentication, Docker hay cloud deployment.

## Chạy project

```bash
npm ci
npm test
npm run dev
```

Public tests chỉ kiểm tra project có thể chạy và một số hành vi cơ bản; không
đại diện cho toàn bộ tiêu chí đánh giá.

## API

### `POST /api/bookings`

Request:

```json
{
  "userId": 1,
  "slotId": 10,
  "idempotencyKey": "booking-user1-slot10"
}
```

Successful response:

```json
{
  "id": 1,
  "userId": 1,
  "slotId": 10,
  "status": "CONFIRMED"
}
```

Database có sẵn users `1`, `2`, `3` và slots `10`, `11`, `12`.

## Yêu cầu

- Validate request và trả lỗi nghiệp vụ nhất quán dưới dạng
  `{ "code": "...", "message": "..." }`.
- Không tạo booking cho resource không tồn tại hoặc không còn khả dụng.
- Giữ booking và số chỗ còn lại nhất quán khi request bị retry, trùng lặp hoặc
  được xử lý đồng thời.
- Request thất bại không được để lại thay đổi dữ liệu dở dang.
- Không hard-code dữ liệu seed trong xử lý nghiệp vụ.

Chỉ sửa code trong `src/`. Không cần viết tài liệu dài.

## Nộp bài

1. Fork repository vào tài khoản GitHub cá nhân.
2. Implement trên một branch mới.
3. Gửi link repository hoặc Pull Request theo hướng dẫn của HR.
