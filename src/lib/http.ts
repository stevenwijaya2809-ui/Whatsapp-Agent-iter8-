/** JSON error response for API routes. Accepts an Error (its message is used) or a message string. */
export function errorResponse(error: unknown, status = 500): Response {
  if (status >= 500) console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, { status });
}
