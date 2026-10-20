export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found`);
export const badRequest = (msg: string, details?: unknown) => new ApiError(400, 'bad_request', msg, details);
export const conflict = (msg: string) => new ApiError(409, 'conflict', msg);
