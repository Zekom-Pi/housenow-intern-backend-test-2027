import type { Selectable } from "kysely";
import type {
  AppDatabase,
  BookingTable,
} from "../db";
import { jsonError } from "../errors";

interface CreateBookingRequest {
  userId?: unknown;
  slotId?: unknown;
  idempotencyKey?: unknown;
}

type Booking = Selectable<BookingTable>;

// Kết quả trả về.
// Nếu thành công sẽ có booking.
// Nếu thất bại sẽ trả về status, mã lỗi và thông báo lỗi.
type BookingResult =
  | {
      status: 200 | 201;
      booking: Booking;
    }
  | {
      status: 404 | 409;
      errorCode:
        | "USER_NOT_FOUND"
        | "SLOT_NOT_FOUND"
        | "SLOT_FULL"
        | "ALREADY_BOOKED";
      message: string;
    };

function mapBookingResponse(booking: Booking) {
  return {
    id: booking.id,
    userId: booking.user_id,
    slotId: booking.slot_id,
    status: booking.status,
  };
}

//đọc request body, yêu cần là JSON
async function parseRequestBody(
  request: Request,
): Promise<CreateBookingRequest | null> {
  try {
    return (await request.json()) as CreateBookingRequest;
  } catch {
    return null;
  }
}


// Kiểm tra lỗi trùng dữ liệu trong database. (idempotency_key, user_id + slot_id )
function isUniqueConstraintError(
  error: unknown,
  ...columns: string[]
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  if (!message.includes("unique")) {
    return false;
  }

  return columns.every((column) =>
    message.includes(column.toLowerCase()),
  );
}

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

// Kiểm tra dữ liệu request trước khi xử lý booking.

function validateCreateBookingRequest(
  body: unknown,
): { userId: number; slotId: number; idempotencyKey: string } | null {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    return null;
  }

  const { userId, slotId, idempotencyKey } =
    body as CreateBookingRequest;

  const isPositiveInteger = (
    value: unknown,
  ): value is number =>
    Number.isInteger(value) && (value as number) > 0;

  if (
    !isPositiveInteger(userId) ||
    !isPositiveInteger(slotId)
  ) {
    return null; //userId và slotId là số nguyên dương
  }

  if (
    typeof idempotencyKey !== "string" ||idempotencyKey.trim().length === 0 ||idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    return null; // idempot=dencyKey có độ dài không quá 200
  }

  return {userId,slotId,idempotencyKey,};
}

// controller xử lí api booking
export async function handleCreateBookingRequest(
  request: Request,
  db: AppDatabase,
): Promise<Response> {
  const requestBody = await parseRequestBody(request);  //đọc request body

  const validatedRequest =
    validateCreateBookingRequest(requestBody);  // kiểm tra dữ liệu ok không

  if (!validatedRequest) {
    return jsonError(
      400,
      "VALIDATION_ERROR",
      "userId, slotId and idempotencyKey are required",  // nếu không trả về lỗi 
    );
  }

  const {userId,slotId,idempotencyKey, } = validatedRequest; // ok thì gán 3 gtri

  let bookingResult: BookingResult;

  // Thực hiện toàn bộ quá trình booking trong một transaction.
  // Nếu xảy ra lỗi sẽ rollback toàn bộ thay đổi.
  try {
    bookingResult =
      await db.transaction().execute<BookingResult>(
        async (trx) => {
          // Kiểm tra idempotency key
          const existingBooking = await trx
            .selectFrom("bookings")
            .selectAll()
            .where(
              "idempotency_key", "=", idempotencyKey
            )
            .executeTakeFirst();

          if (existingBooking) {
            return {
              status: 200,
              booking: existingBooking,
            };
          }

          // Kiểm tra user 
          const user = await trx
            .selectFrom("users")
            .select("id")
            .where("id", "=", userId)
            .executeTakeFirst();

          if (!user) {
            return {
              status: 404,
              errorCode: "USER_NOT_FOUND",
              message: "User was not found",
            };
          }

          // Kiểm tra slot còn không
          const slot = await trx
            .selectFrom("slots")
            .select("id")
            .where("id", "=", slotId)
            .executeTakeFirst();

          if (!slot) {
            return {
              status: 404,
              errorCode: "SLOT_NOT_FOUND",
              message: "Slot was not found",
            };
          }

          // Giảm remaining theo cách atomic
          const updateResult = await trx
            .updateTable("slots")
            .set(({ eb }) => ({
              remaining: eb("remaining", "-", 1),
            }))
            .where("id", "=", slotId)
            .where("remaining", ">", 0)
            .executeTakeFirst();

          if (
            Number(updateResult.numUpdatedRows) === 0
          ) {
            return {
              status: 409,
              errorCode: "SLOT_FULL",
              message: "Slot is fully booked",
            };
          }

          try {
            const booking = await trx
              .insertInto("bookings")
              .values({
                user_id: userId,
                slot_id: slotId,
                idempotency_key:
                  idempotencyKey,
              })
              .returningAll()
              .executeTakeFirstOrThrow();

            return {
              status: 201,
              booking,
            };
          } catch (error) {
            // Hai request cùng idempotency key
            if (
              isUniqueConstraintError(
                error,
                "bookings.idempotency_key",
              )
            ) {

              // Một request khác đã insert thành công trước.
              // Lấy booking đã tạo và trả lại cho client.
              const replayBooking =
                await trx
                  .selectFrom("bookings")
                  .selectAll()
                  .where("idempotency_key","=",idempotencyKey)
                  .executeTakeFirst();

              if (replayBooking) {
                return {
                  status: 200,
                  booking: replayBooking,
                };
              }
            }

            // User đã booking slot này
            if (
              isUniqueConstraintError(
                error,
                "bookings.user_id",
                "bookings.slot_id",
              )
            ) {
              return {
                status: 409,
                errorCode:
                  "ALREADY_BOOKED",
                message:
                  "User already booked this slot",
              };
            }

            throw error;
          }
        },
      );
  } catch {
    return jsonError(
      500,
      "INTERNAL_ERROR",
      "Unexpected booking error", // Lỗi ngoài dự kiến trong transaction.
    );
  }

  if ("booking" in bookingResult) {
    return Response.json(
      mapBookingResponse(
        bookingResult.booking,
      ),
      {
        status: bookingResult.status,
      },
    );
  }

  return jsonError(
    bookingResult.status,
    bookingResult.errorCode,
    bookingResult.message,
  );
}
