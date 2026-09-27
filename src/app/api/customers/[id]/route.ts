import { isUuid } from "@/lib/conversations";
import { addCustomerTag, updateCustomer } from "@/lib/customers";
import { errorResponse } from "@/lib/http";
import type { CustomerStatus } from "@/lib/types";

const STATUSES: CustomerStatus[] = [
  "NEW",
  "LEAD",
  "QUALIFIED",
  "BOOKED",
  "ACTIVE_CUSTOMER",
  "RETURNING_CUSTOMER",
  "INACTIVE",
];

const MAX_TAG_LENGTH = 40;

/** Updates a customer from the dashboard: `{ "status": ... }` and/or `{ "tag": "..." }` to add one. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Customer not found", 404);

  const body = await request.json().catch(() => null);
  const status = body?.status;
  const tag = typeof body?.tag === "string" ? body.tag.trim() : "";

  if (status !== undefined && !STATUSES.includes(status)) {
    return errorResponse(`status must be one of: ${STATUSES.join(", ")}`, 400);
  }
  if (tag.length > MAX_TAG_LENGTH) return errorResponse(`A tag can be at most ${MAX_TAG_LENGTH} characters`, 400);
  if (status === undefined && !tag) {
    return errorResponse('Nothing to update: send "status" and/or "tag"', 400);
  }

  try {
    const updated = status === undefined ? null : await updateCustomer(id, { status });
    const customer = tag ? await addCustomerTag(id, tag) : updated;
    return customer ? Response.json(customer) : errorResponse("Customer not found", 404);
  } catch (error) {
    return errorResponse(error);
  }
}
