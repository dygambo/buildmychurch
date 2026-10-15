/** An error whose message is safe and helpful to show the user. */
export class AppError extends Error {
  constructor(
    message: string,
    public fieldErrors?: Record<string, string>,
    public code: string = "app_error",
  ) {
    super(message);
  }
}
export const notFound = (what = "That record") =>
  new AppError(`${what} doesn't exist or you don't have access to it.`, undefined, "not_found");
export const forbidden = (what = "do that") =>
  new AppError(`Your role doesn't allow you to ${what}. Ask a Super Admin if you need access.`, undefined, "forbidden");
